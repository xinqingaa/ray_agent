"""第十二章：真实 PostgreSQL 事务与本地存储核对，不调用模型或产品沙箱。

所有数据库写入包在外层回滚事务内，文件写入临时目录。连接条件见 API 指南。
"""
import asyncio
import io
import logging
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.domain.models.event import MessageEvent
from app.domain.models.session import Session
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from app.infrastructure.models import SessionModel
from app.infrastructure.repositories.db_session_repository import DBSessionRepository
from app.infrastructure.repositories.db_uow import DBUnitOfWork
from core.config import get_settings


async def check():
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, echo=False)
    session = Session(title="ch12-transaction-check")
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                # 保留生产使用的 autoflush=False，UoW 提交只释放保存点。
                factory = async_sessionmaker(bind=connection, autoflush=False,
                    expire_on_commit=False, join_transaction_mode="create_savepoint")
                def uow_factory():
                    return DBUnitOfWork(factory)
                async with uow_factory() as uow:
                    await uow.session.save(session)
                with TemporaryDirectory(prefix="ch12-files-") as directory:
                    storage = LocalFileStorage(directory, uow_factory)
                    sandbox = SimpleNamespace(content=b"v1")
                    sandbox.download_file = AsyncMock(side_effect=lambda _: io.BytesIO(sandbox.content))
                    runner = AgentTaskRunner.__new__(AgentTaskRunner)
                    runner._session_id = session.id
                    runner._sandbox = sandbox
                    runner._file_storage = storage
                    runner._uow = uow_factory()
                    async def current():
                        async with uow_factory() as uow:
                            return await uow.session.get_by_id(session.id)
                    first = await runner._sync_file_to_storage("/a.txt")
                    async with uow_factory() as uow:
                        await uow.session.add_event(session.id, MessageEvent(attachments=[first]))
                    sandbox.content = b"v2"
                    second = await runner._sync_file_to_storage("/a.txt")
                    saved = await current()
                    assert [f.id for f in saved.files] == [second.id]
                    assert saved.events[0].attachments[0].id == first.id
                    data, _ = await storage.download_file(first.id)
                    with data:
                        assert data.read() == b"v1"
                    data, _ = await storage.download_file(second.id)
                    with data:
                        assert data.read() == b"v2"
                    print("PASS: 同事务替换只留新条目；历史附件读 v1，新副本读 v2")
                    with patch.object(storage, "upload_file", AsyncMock(side_effect=OSError("受控上传失败"))):
                        assert await runner._sync_file_to_storage("/a.txt") is None
                    assert [f.id for f in (await current()).files] == [second.id]
                    print("PASS: 上传失败保留旧条目")
                    with patch.object(DBSessionRepository, "add_file", AsyncMock(side_effect=RuntimeError("受控关联失败"))):
                        assert await runner._sync_file_to_storage("/a.txt") is None
                    assert [f.id for f in (await current()).files] == [second.id]
                    print("PASS: 关联写入失败，真实数据库回滚保留旧条目")
            finally:
                await transaction.rollback()
        async with engine.connect() as connection:
            assert (await connection.execute(select(SessionModel.id).where(SessionModel.id == session.id))).scalar_one_or_none() is None
        print("PASS: 实验数据库记录已回滚，临时文件已清理")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.CRITICAL)
    asyncio.run(check())
