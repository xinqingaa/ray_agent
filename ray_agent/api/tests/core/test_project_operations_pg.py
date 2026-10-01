"""真实 PG 的跨请求所有权、终态占用、故障收敛和回滚；Docker 用受控替身。"""
import asyncio
import pytest
from app.domain.services.project_operations import claim, finish
from app.domain.services.project_file_coordinator import ProjectFileCoordinator, register_writer, retire_writer
from app.domain.services.project_transactions import ProjectRunConflict
from app.domain.services.run_ledger import RunLedger
from app.domain.models.run import RunStatus
from tests.core.test_run_events_pg import PG_URI, fresh_schema, with_db
from tests.core.test_w11_projects_pg import projects
pytestmark = pytest.mark.skipif(not PG_URI, reason='需要独立临时 PostgreSQL')


class Stopped:
    calls = []
    @classmethod
    async def stop_project_writers(cls, project_id):
        cls.calls.append(project_id)


def test_operation_admission_identity_and_transaction_rollback(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('操作所有权')
        session = await service.create_session(project.id)
        async def begin():
            async with factory() as uow:
                return await claim(uow, project.id, 'upload')
        results = await asyncio.gather(begin(), begin(), return_exceptions=True)
        winners = [r for r in results if not isinstance(r, Exception)]
        assert len(winners) == 1
        assert isinstance(next(r for r in results if isinstance(r, Exception)), ProjectRunConflict)
        owner = winners[0]
        with pytest.raises(ProjectRunConflict):
            await RunLedger(factory).start(session.id)
        with pytest.raises(ProjectRunConflict):
            await service.archive(project.id, True)
        async with factory() as uow:
            assert not await finish(uow, project.id, 'old-callback')
        assert (await service.get(project.id)).file_operation.operation_id == owner.operation_id
        with pytest.raises(RuntimeError):
            async with factory() as uow:
                await finish(uow, project.id, owner.operation_id)
                raise RuntimeError('提交前失败')
        assert len(await service.events(project.id)) == 1
        async with factory() as uow:
            assert await finish(uow, project.id, owner.operation_id)
        assert (await service.get(project.id)).file_operation is None
        assert [e['payload'].get('result') for e in await service.events(project.id)] == [None, 'completed']
    with_db(scenario)


def test_terminal_still_blocks_until_writer_exits_and_docker_confirms(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('收尾失败')
        session, next_session = await service.create_session(project.id), await service.create_session(project.id)
        ledger = RunLedger(factory)
        run = await ledger.start(session.id)
        token = register_writer(project.id)
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED)
        op = (await service.get(project.id)).file_operation
        assert op.run_id == run.id and op.kind == 'settling'
        coordinator = ProjectFileCoordinator(factory, Stopped)
        assert not await coordinator.settle(project.id)
        with pytest.raises(ProjectRunConflict):
            await ledger.start(next_session.id)
        retire_writer(project.id, token)
        class Broken:
            @classmethod
            async def stop_project_writers(cls, project_id):
                raise RuntimeError('Docker 不可达')
        assert not await ProjectFileCoordinator(factory, Broken).settle(project.id)
        assert (await service.get(project.id)).file_operation.state == 'failed'
        with pytest.raises(ProjectRunConflict):
            await service.archive(project.id, True)
        assert await coordinator.settle(project.id)
        assert (await service.get(project.id)).file_operation is None
        assert (await ledger.start(next_session.id)).status == RunStatus.RUNNING
    with_db(scenario)


def test_waiting_preserved_startup_independent_projects_and_cancelled_io(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        waiting, stopped = await service.create('等待保留'), await service.create('遗留收尾')
        a, b = await service.create_session(waiting.id), await service.create_session(stopped.id)
        ledger = RunLedger(factory)
        run_a, run_b = await ledger.start(a.id), await ledger.start(b.id)
        await ledger.transition(a.id, run_a.id, RunStatus.WAITING)
        await ledger.transition(b.id, run_b.id, RunStatus.INTERRUPTED)
        Stopped.calls = []
        await ProjectFileCoordinator(factory, Stopped).reconcile_startup()
        assert Stopped.calls == [stopped.id]
        entered, release = asyncio.Event(), asyncio.Event()
        class Slow:
            @classmethod
            async def stop_project_writers(cls, project_id):
                entered.set()
                await release.wait()
        work = asyncio.create_task(ProjectFileCoordinator(factory, Slow).settle(stopped.id))
        await entered.wait()
        work.cancel()
        await asyncio.sleep(0)
        assert not work.done()
        assert (await service.get(stopped.id)).file_operation is not None
        with pytest.raises(ProjectRunConflict):
            await ledger.start(b.id)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await work
        assert (await service.get(stopped.id)).file_operation.state == 'failed'
        assert await ProjectFileCoordinator(factory, Stopped).settle(stopped.id)
        assert (await service.get(stopped.id)).file_operation is None
    with_db(scenario)


def test_late_project_creation_keeps_terminal_ownership_until_cleanup(tmp_path):
    from unittest.mock import AsyncMock
    from types import SimpleNamespace
    from tests.core.test_task_execution_control import make_service
    from tests.support.loop_harness import make_loop, input_task
    from app.application.services.agent_service import pending_starts
    from app.domain.models.event import MessageEvent
    async def scenario(factory, engine):
        project_service = projects(factory, tmp_path)
        project = await project_service.create('迟到启动')
        session = await project_service.create_session(project.id)
        ledger = RunLedger(factory)
        run = await ledger.start(session.id)
        service = make_service(make_loop([]))
        service._uow_factory, service._ledger = factory, ledger
        service._sandbox_cls = Stopped
        entered, release = asyncio.Event(), asyncio.Event()
        box = SimpleNamespace(id='late-project-box', destroy=AsyncMock())
        task = input_task()
        task.invoke = AsyncMock()
        task.task_runner = SimpleNamespace(_sandbox=box)
        async def create(session, run_id, prior):
            entered.set()
            await release.wait()
            session.sandbox_id = box.id
            return task
        service._create_task = create
        service._schedule_start(session, run.id, None, MessageEvent(role='user', message='开始'))
        owner = pending_starts()[run.id]
        await entered.wait()
        owner.cancelled = True
        await ledger.transition(session.id, run.id, RunStatus.CANCELLED)
        coordinator = ProjectFileCoordinator(factory, Stopped)
        assert not await coordinator.settle(project.id)
        with pytest.raises(ProjectRunConflict):
            await ledger.start(session.id)
        release.set()
        await owner.worker
        task.invoke.assert_not_awaited()
        box.destroy.assert_awaited_once()
        assert (await project_service.get(project.id)).file_operation is None
        async with factory() as uow:
            persisted = await uow.session.get_by_id(session.id)
        assert persisted.sandbox_id is None and persisted.task_id is None
        assert (await ledger.start(session.id)).status == RunStatus.RUNNING
    with_db(scenario)


def test_startup_waiting_keeps_only_its_container_and_failure_blocks_resume(tmp_path):
    async def scenario(factory, engine):
        service = projects(factory, tmp_path)
        project = await service.create('等待启动核对')
        session = await service.create_session(project.id)
        async with factory() as uow:
            await uow.session.update_sandbox_id(session.id, 'waiting-box')
        ledger = RunLedger(factory)
        run = await ledger.start(session.id)
        await ledger.transition(session.id, run.id, RunStatus.WAITING)
        class StartupSandbox:
            fail = True
            kept = []
            @classmethod
            async def stop_other_project_writers(cls, project_id, keep_id):
                cls.kept.append(keep_id)
                if cls.fail:
                    raise RuntimeError('Docker 断连')
        coordinator = ProjectFileCoordinator(factory, StartupSandbox)
        await coordinator.reconcile_startup()
        assert StartupSandbox.kept == ['waiting-box']
        with pytest.raises(ProjectRunConflict):
            await ledger.transition(session.id, run.id, RunStatus.RUNNING)
        StartupSandbox.fail = False
        assert await coordinator.settle(project.id)
        assert StartupSandbox.kept == ['waiting-box', 'waiting-box']
        assert (await ledger.transition(session.id, run.id, RunStatus.RUNNING)).status == RunStatus.RUNNING
    with_db(scenario)
