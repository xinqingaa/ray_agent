"""宿主退出前的活动运行数：只读计数运行中与等待中的运行，终态不计；真实 SQLite 业务库。"""
from app.application.services.session_service import SessionService
from app.domain.models.run import RunStatus
from app.domain.models.session import Session
from app.domain.services.run_ledger import RunLedger
from tests.support.sqlite_db import with_database


def test_active_run_count_follows_running_and_waiting_runs(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        async with uow_factory() as uow:
            await uow.session.save(Session(id="activity-a"))
            await uow.session.save(Session(id="activity-b"))
        service = SessionService(uow_factory=uow_factory, read_uow_factory=read_factory)
        ledger = RunLedger(uow_factory)
        assert await service.active_run_count() == 0
        first = await ledger.start("activity-a")
        assert await service.active_run_count() == 1
        await ledger.transition("activity-a", first.id, RunStatus.WAITING)
        assert await service.active_run_count() == 1
        second = await ledger.start("activity-b")
        assert await service.active_run_count() == 2
        await ledger.transition("activity-a", first.id, RunStatus.COMPLETED)
        await ledger.transition("activity-b", second.id, RunStatus.CANCELLED)
        assert await service.active_run_count() == 0
    with_database(tmp_path, scenario)
