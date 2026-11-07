"""业务库连接在取消下的收尾：工作单元被任务取消、anyio 取消范围或 SSE 断开打断后，连接全部归还，
aiosqlite 线程不增长，连接池不报终止或重置错误，写协调器不被卡住，之后的写入照常进行。

慢查询让取消落在进行中的数据库调用上；每个用例使用 pytest 临时目录里的独立数据根。
"""
import asyncio
import logging
import sqlite3

import aiosqlite
import anyio
import pytest
from sqlalchemy import text
from sse_starlette import EventSourceResponse

from app.application.services.agent_service import AgentService
from app.domain.models.event import MessageEvent
from app.domain.models.session import Session
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.repositories.db_event_repository import DBEventRepository
from tests.support.loop_harness import MemoryNotifier
from tests.support.sqlite_db import with_database

SLOW_QUERY = text("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1500000) "
                  "SELECT count(*) FROM c")


@pytest.fixture
def connections(monkeypatch):
    """记录本用例建立的 aiosqlite 连接：(数据库文件, 连接)。"""
    created = []
    original = aiosqlite.connect

    def connect(database, *args, **kwargs):
        connection = original(database, *args, **kwargs)
        created.append((str(database), connection))
        return connection

    monkeypatch.setattr(aiosqlite, "connect", connect)
    return created


def alive_threads(connections, database) -> int:
    return sum(1 for path, connection in connections
               if path == str(database.path) and connection._thread.is_alive())


def opened(connections, database) -> int:
    return sum(1 for path, _ in connections if path == str(database.path))


def pool_errors(caplog):
    return [record for record in caplog.records
            if record.name.startswith("sqlalchemy.pool") and record.levelno >= logging.ERROR]


async def warm_up(uow_factory, read_factory) -> None:
    """建好写连接与全部读连接，之后的线程数以此为基线。"""
    async with uow_factory() as uow:
        await uow.session.save(Session(id="warm-up"))

    async def read():
        async with read_factory() as uow:
            await uow.db_session.execute(text("SELECT 1"))
            await asyncio.sleep(0.05)
    await asyncio.gather(*(read() for _ in range(4)))


async def settled(database, connections, baseline: int, timeout: float = 5.0) -> None:
    """等被替换连接的工作线程退出：签出数归零，存活线程不多于基线。"""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while database.checked_out() != (0, 0) or alive_threads(connections, database) > baseline:
        if loop.time() > deadline:
            raise AssertionError(f"签出 {database.checked_out()}，存活线程 {alive_threads(connections, database)}，"
                                 f"基线 {baseline}")
        await asyncio.sleep(0.02)


async def write_still_works(uow_factory, read_factory, session_id: str) -> None:
    async def write():
        async with uow_factory() as uow:
            await uow.session.save(Session(id=session_id))
    await asyncio.wait_for(write(), 2)
    async with read_factory() as uow:
        assert await uow.session.get_by_id(session_id) is not None


def external_writer_can_lock(database) -> bool:
    """另一条连接能立即拿到写锁：被取消的写事务没有遗留 RESERVED 锁。"""
    connection = sqlite3.connect(database.path, timeout=0, isolation_level=None)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
        return True
    except sqlite3.OperationalError:
        return False
    finally:
        connection.close()


async def cancel_midway(work, cancel: str, delay: float = 0.03) -> None:
    """在 work 进行中取消：task 为任务取消，anyio 为取消外层取消范围（与 SSE 断开同一机制）。"""
    if cancel == "task":
        task = asyncio.create_task(work())
        await asyncio.sleep(delay)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return
    async with anyio.create_task_group() as group:
        group.start_soon(work)
        await asyncio.sleep(delay)
        group.cancel_scope.cancel()


# 读工作单元 ---------------------------------------------------------------------

@pytest.mark.parametrize("cancel", ["task", "anyio"])
def test_cancelled_read_returns_connection_without_pool_errors(tmp_path, caplog, connections, cancel):
    async def scenario(uow_factory, read_factory, database):
        await warm_up(uow_factory, read_factory)
        baseline, before = alive_threads(connections, database), opened(connections, database)
        counted = []

        async def read():
            async with read_factory() as uow:
                counted.append((await uow.db_session.execute(SLOW_QUERY)).scalar_one())
            await asyncio.sleep(10)

        for _ in range(12):
            await cancel_midway(read, cancel)
            assert database.checked_out() == (0, 0)
        await settled(database, connections, baseline)
        # 进行中的查询读完、会话照常关闭后取消才生效；连接没有被当作断线替换
        assert counted == [1500000] * 12
        assert opened(connections, database) == before
        assert pool_errors(caplog) == []
        await write_still_works(uow_factory, read_factory, f"after-{cancel}-read")
    with_database(tmp_path, scenario)


def test_sse_disconnects_during_catch_up_leave_no_connection_behind(tmp_path, caplog, connections, monkeypatch):
    original = DBEventRepository.list

    async def slow_list(self, *args, **kwargs):
        await self.db_session.execute(SLOW_QUERY)
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(DBEventRepository, "list", slow_list)

    async def scenario(uow_factory, read_factory, database):
        await warm_up(uow_factory, read_factory)
        notifier = MemoryNotifier()
        session = Session(id="sse-disconnect")
        async with uow_factory() as uow:
            await uow.session.save(session)
        ledger = RunLedger(uow_factory, notifier)
        run = await ledger.start(session.id)
        await ledger.append(session.id, [MessageEvent(message=f"历史{i}") for i in range(3)], run_id=run.id)
        service = AgentService.__new__(AgentService)
        service._uow_factory, service._read_uow_factory = uow_factory, read_factory
        service._uow, service._ledger, service._notifier = uow_factory(), ledger, notifier
        baseline, before = alive_threads(connections, database), opened(connections, database)

        async def disconnect_after(delay: float) -> list:
            sent = []
            stream = service.stream_events(session.id, after_seq=0)

            async def body():
                async for item in stream:
                    yield {"id": str(item.seq), "data": item.type}

            async def receive():
                await asyncio.sleep(delay)
                return {"type": "http.disconnect"}

            async def send(message):
                sent.append(message)

            iterator = body()
            await EventSourceResponse(iterator, ping=600)({"type": "http", "method": "GET"}, receive, send)
            await iterator.aclose()
            await stream.aclose()
            return sent

        delays = [0.005, 0.02, 0.06, 0.12, 0.2, 0.3] * 4
        for delay in delays:
            await disconnect_after(delay)
            assert database.checked_out() == (0, 0)
        await settled(database, connections, baseline)
        assert pool_errors(caplog) == []
        assert opened(connections, database) == before
        written = await asyncio.wait_for(
            ledger.append(session.id, [MessageEvent(message="断开之后")], run_id=run.id), 2)
        assert written[0].seq == 5
    with_database(tmp_path, scenario)


# 写工作单元 ---------------------------------------------------------------------

@pytest.mark.parametrize("cancel", ["task", "anyio"])
@pytest.mark.parametrize("body", ["interrupted", "database_only"])
def test_cancelled_write_never_blocks_later_writes(tmp_path, caplog, connections, cancel, body):
    async def scenario(uow_factory, read_factory, database):
        await warm_up(uow_factory, read_factory)
        baseline, before = alive_threads(connections, database), opened(connections, database)

        async def write():
            async with uow_factory() as uow:
                await uow.session.save(Session(id=f"{cancel}-first"))
                await uow.db_session.execute(SLOW_QUERY)
                if body == "interrupted":
                    await asyncio.sleep(0)
                await uow.session.save(Session(id=f"{cancel}-second"))
            await asyncio.sleep(10)

        await cancel_midway(write, cancel)
        assert not database.write_locked() and database.checked_out() == (0, 0)
        assert external_writer_can_lock(database)
        async with read_factory() as uow:
            saved = [await uow.session.get_by_id(f"{cancel}-{name}") for name in ("first", "second")]
        if body == "interrupted":
            # 取消在主体里第一个不访问数据库的等待点生效：整笔回滚
            assert saved == [None, None]
        else:
            # 主体只剩数据库操作：整笔提交后再交出取消
            assert all(saved)
        await settled(database, connections, baseline)
        assert opened(connections, database) == before
        assert pool_errors(caplog) == []
        await write_still_works(uow_factory, read_factory, f"after-{cancel}-{body}-write")
    with_database(tmp_path, scenario)


def test_cancelled_while_waiting_for_write_turn_does_not_disturb_coordinator(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        release = asyncio.Event()

        async def holder():
            async with uow_factory() as uow:
                await uow.session.save(Session(id="holder"))
                await release.wait()

        async def waiter():
            async with uow_factory() as uow:
                await uow.session.save(Session(id="waiter"))

        holding = asyncio.create_task(holder())
        await asyncio.sleep(0.05)
        waiting = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        release.set()
        await holding
        assert not database.write_locked()
        await write_still_works(uow_factory, read_factory, "after-waiter")
        async with read_factory() as uow:
            assert await uow.session.get_by_id("holder") is not None
            assert await uow.session.get_by_id("waiter") is None
    with_database(tmp_path, scenario)
