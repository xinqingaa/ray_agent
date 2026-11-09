"""Shell 写入者的准入与收尾：在启动进程前持久占用，确认子树静止后释放。"""
from app.domain.models.write_lease import LeaseState, WriterKind
from app.domain.services.file_scope import WriteOwner


class ShellWriteLease:
    def __init__(self, leases, workspace_id, session_id, run_id, *, changes=None, scope=None):
        self.leases, self.workspace_id = leases, workspace_id
        self.owner = WriteOwner(session_id, run_id)
        self.acquired = False
        self.changes, self.scope = changes, scope
        self.observing = False

    async def acquire(self):
        if self.workspace_id and self.leases and not self.acquired:
            lease_id = await self.leases.acquire(self.workspace_id, self.owner, 'Shell 与脚本执行', kind=WriterKind.PROCESS)
            self.acquired = True
            await self.leases.mark(lease_id, LeaseState.HELD)
        if self.changes and not self.observing:
            await self.changes.begin(self.owner.run_id, self.scope)
            self.observing = True

    async def settle(self, confirmed):
        if self.changes and self.observing:
            await self.changes.finish(self.owner.run_id, self.scope, confirmed)
        if self.leases and self.acquired:
            await self.leases.finish_settle(self.owner.run_id, confirmed=confirmed)
            if confirmed:
                self.acquired = False
