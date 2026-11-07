"""工作方式与记忆测试的公共环境：真实 SQLite 业务库上的服务装配与造数。

工作区不绑定文件夹（记忆与检索与文件夹无关），会话与消息事件直接写库，模型端用注入的替身。
"""
from types import SimpleNamespace
from typing import Optional

from app.application.services.context_assembly import ContextAssembly
from app.application.services.memory_service import MemoryService
from app.application.services.retrieval_service import RetrievalService
from app.application.services.working_style_service import WorkingStyleService
from app.application.services.workspace_memory_runtime import WorkspaceMemoryRuntime
from app.domain.models.event import MessageEvent
from app.domain.models.session import Session
from app.domain.models.workspace import Workspace


class JobStub:
    """后台任务上下文替身：处理函数只用到 job、progress 与 check_cancel。"""

    def __init__(self, job) -> None:
        self.job = job
        self.phases: list[str] = []

    async def progress(self, **values) -> None:
        if values.get("phase"):
            self.phases.append(values["phase"])

    async def check_cancel(self) -> None:
        return None


class MemEnv:

    def __init__(self, uow_factory, read_factory) -> None:
        self.uow_factory, self.read_factory = uow_factory, read_factory
        self.retrieval = RetrievalService(uow_factory, read_factory)
        self.memory = MemoryService(uow_factory, read_factory, self.retrieval)
        self.style = WorkingStyleService(uow_factory, read_factory)
        self.assembly = ContextAssembly(uow_factory, read_factory, self.retrieval, self.memory)
        self.runtime = WorkspaceMemoryRuntime(self.memory, self.retrieval, self.style, self.assembly)

    async def workspace(self, name: str = "工作区", **settings) -> Workspace:
        workspace = Workspace(name=name, settings=dict(settings))
        async with self.uow_factory() as uow:
            await uow.workspace.add(workspace)
        return workspace

    async def session(self, workspace_id: Optional[str], *, participate: Optional[bool] = None) -> Session:
        session = Session(title="会话", workspace_id=workspace_id,
                          participate_in_memory=bool(workspace_id) if participate is None else participate)
        async with self.uow_factory() as uow:
            await uow.session.save(session)
        return session

    async def say(self, session_id: str, text: str, role: str = "user") -> int:
        """写一条消息事件并返回它的序号。"""
        event = MessageEvent(role=role, message=text)
        async with self.uow_factory() as uow:
            return await uow.event.add(session_id, event)

    async def fresh(self, workspace_id: str) -> Workspace:
        async with self.read_factory() as uow:
            return await uow.workspace.get(workspace_id)

    def job(self, **payload):
        """只带 operation_id 与载荷的任务替身。"""
        return SimpleNamespace(operation_id=payload.pop("operation_id", "op-test"), payload=payload, progress=None,
                               generation=1)
