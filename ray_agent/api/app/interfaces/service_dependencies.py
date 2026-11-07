#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""依赖组装：业务库、内容对象、会话工作目录与通知都在本进程内，核心不连接外部存储或容器。"""
import logging

from app.application.services.agent_service import AgentService
from app.application.services.app_config_service import AppConfigService
from app.application.services.capability_service import CapabilityService
from app.application.services.file_service import FileService
from app.application.services.session_service import SessionService
from app.application.services.title_service import TitleService
from app.application.services.status_service import StatusService
from app.domain.external.file_storage import FileStorage
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from app.infrastructure.external.health_checker.sqlite_health_checker import SQLiteHealthChecker
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.notification.local_notifier import event_notifier
from app.infrastructure.external.search.bing_search import BingSearchEngine
from app.infrastructure.external.task.local_task import LocalRunTask
from app.infrastructure.external.web.public_page import PublicWebReader
from app.infrastructure.external.workdir.session_workdir import SessionWorkdirs
from app.infrastructure.repositories.db_app_config_repository import DBAppConfigRepository
from app.infrastructure.storage.sqlite import get_database, get_read_uow, get_uow
from core.config import get_settings
from core.paths import data_root

logger = logging.getLogger(__name__)


def get_app_config_repository() -> DBAppConfigRepository:
    return DBAppConfigRepository(get_uow, get_read_uow)


def get_app_config_service() -> AppConfigService:
    return AppConfigService(app_config_repository=get_app_config_repository())


def get_status_service() -> StatusService:
    return StatusService(checkers=[SQLiteHealthChecker(get_database())])


def get_capability_service() -> CapabilityService:
    async def command_probe():
        from app.infrastructure.external.execution.runtime import command_available
        return await command_available()

    async def browser_probe():
        from app.infrastructure.external.execution.runtime import browser_available
        return await browser_available()

    async def standalone_enabled() -> bool:
        config = await get_app_config_repository().load()
        return bool(config.agent_config.standalone_execution_enabled)

    async def workspace_settings(workspace_id: str) -> dict | None:
        async with get_read_uow() as uow:
            workspace = await uow.workspace.get(workspace_id)
        return None if workspace is None else dict(workspace.settings or {})

    return CapabilityService(
        command_probe=command_probe,
        browser_probe=browser_probe,
        standalone_enabled=standalone_enabled,
        workspace_settings=workspace_settings,
    )


def get_file_storage() -> FileStorage:
    root = data_root()
    return LocalFileStorage(objects_dir=root.objects, tmp_dir=root.tmp, uow_factory=get_uow)


def get_workdirs() -> SessionWorkdirs:
    return SessionWorkdirs(data_root().root)


def get_file_service() -> FileService:
    return FileService(uow_factory=get_uow, file_storage=get_file_storage())


def get_session_service() -> SessionService:
    from app.application.services.background_jobs import get_job_runner
    return SessionService(uow_factory=get_uow, read_uow_factory=get_read_uow, task_cls=LocalRunTask,
                          workdirs=get_workdirs(), jobs=get_job_runner())


def get_data_service():
    from app.application.services.background_jobs import get_job_runner
    from app.application.services.data_service import DataService
    return DataService(get_uow, get_job_runner(), data_root().install_id())


def get_file_limits():
    from app.domain.external.workspace_files import FileLimits
    current = get_settings()
    return FileLimits(
        read_bytes=current.file_read_bytes, list_entries=current.file_list_entries,
        scan_entries=current.file_scan_entries, scan_depth=current.file_scan_depth,
        write_bytes=current.file_write_bytes, search_matches=current.file_search_matches,
        find_results=current.file_find_results, find_entries=current.file_find_entries)


def get_folder_access():
    from app.infrastructure.external.workspace_files.folders import PosixFolderAccess
    return PosixFolderAccess(get_file_limits())


def _root_bindings():
    from app.application.services.root_access import RootBindings
    return RootBindings(get_read_uow, data_root().root)


def _files_factory(resolve, limits):
    from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
    return PosixWorkspaceFiles(resolve, limits)


def get_root_files():
    return _files_factory(_root_bindings(), get_file_limits())


def get_workspace_objects():
    from app.infrastructure.external.file_storage.workspace_objects import LocalWorkspaceObjects
    root = data_root()
    return LocalWorkspaceObjects(root.objects, root.tmp, get_uow, get_settings().backup_free_reserve_bytes)


async def confirm_run_quiescent(run_id: str) -> bool:
    """再次取消并等待运行的执行协程退出；仍未退出返回 False。供停止后转为 blocked 的租约重试收尾。"""
    import asyncio
    from app.domain.services.agent_task_runner import STOP_SETTLE_SECONDS
    execution = LocalRunTask.executing(run_id)
    if execution is None:
        return True
    execution.cancel()
    done, _ = await asyncio.wait({execution}, timeout=STOP_SETTLE_SECONDS)
    return bool(done)


_write_leases = None


def get_write_leases():
    """进程内唯一的租约服务：它记着本进程仍持有租约的写入者，用来识别业务库里残留的租约。"""
    global _write_leases
    if _write_leases is None:
        from app.application.services.write_leases import WriteLeaseService
        from app.interfaces.core_descriptor import INSTANCE
        _write_leases = WriteLeaseService(get_uow, get_read_uow, INSTANCE.instance_id, confirm_run_quiescent)
    return _write_leases


def _writer_factory(files):
    from app.application.services.workspace_writer import WorkspaceWriter
    return WorkspaceWriter(files, get_uow, get_read_uow, get_write_leases(), get_workspace_objects())


def get_file_history():
    from app.application.services.file_history import FileHistoryService
    from app.application.services.workspace_writer import WorkspaceWriter
    files = get_root_files()
    leases = get_write_leases()
    objects = get_workspace_objects()
    current = get_settings()
    writer = WorkspaceWriter(files, get_uow, get_read_uow, leases, objects)
    return FileHistoryService(get_uow, get_read_uow, files, writer, objects, leases,
                              preview_bytes=current.change_preview_bytes, preview_lines=current.change_preview_lines,
                              default_runs=current.change_runs_default)


_change_feed = None


def get_change_feed():
    """外部变更推送：进程内单例，同一文件夹的监视任务由订阅者共享。"""
    global _change_feed
    if _change_feed is None:
        from app.application.services.workspace_changes import WorkspaceChangeFeed
        from app.infrastructure.external.workspace_files.watcher import WatchfilesFolderWatcher
        current = get_settings()
        quiet_ms = int(current.workspace_probe_seconds * 1000)
        _change_feed = WorkspaceChangeFeed(
            get_uow, get_read_uow, get_folder_access(), get_root_files(),
            WatchfilesFolderWatcher(current.watch_debounce_ms, quiet_ms), probe_seconds=current.workspace_probe_seconds,
            rescan_seconds=current.workspace_rescan_seconds, paths_per_event=current.change_paths_per_event)
    return _change_feed


async def close_change_feed() -> None:
    global _change_feed
    feed, _change_feed = _change_feed, None
    if feed is not None:
        await feed.shutdown()


def get_root_file_service():
    from app.application.services.root_access import RootFileService
    files = get_root_files()
    return RootFileService(_root_bindings(), files, _writer_factory(files))


def get_run_file_access():
    from app.application.services.root_access import RunFileAccess
    return RunFileAccess(get_read_uow, get_workdirs(), get_file_limits(), get_folder_access(), _files_factory,
                         _writer_factory)


_workspace_runtime = None


def get_workspace_runtime():
    """授权凭证、复制冲突与生命周期锁在请求之间共享。"""
    global _workspace_runtime
    if _workspace_runtime is None:
        from app.application.services.folder_grants import folder_grants
        from app.application.services.workspace_service import WorkspaceRuntime
        _workspace_runtime = WorkspaceRuntime(grants=folder_grants(),
                                              conflict_seconds=get_settings().marker_conflict_seconds)
    return _workspace_runtime


def get_workspace_service():
    import os
    from pathlib import Path
    from app.application.services.background_jobs import get_job_runner
    from app.application.services.folder_policy import FolderPolicy
    from app.application.services.workspace_service import WorkspaceService
    current = get_settings()
    root = data_root()
    policy = FolderPolicy(blocked=current.workspace_blocked_paths, data_root=str(root.root), home=str(Path.home()))
    return WorkspaceService(
        uow_factory=get_uow, read_uow_factory=get_read_uow, folders=get_folder_access(), policy=policy,
        runtime=get_workspace_runtime(), install_id=root.install_id(),
        default_location=os.path.expanduser(current.workspace_default_location),
        jobs=get_job_runner(), task_cls=LocalRunTask)


def get_file_preview_service():
    from app.application.services.file_preview_service import FilePreviewService
    return FilePreviewService(get_file_service(), get_root_files())


def get_run_ledger() -> RunLedger:
    """运行与事件的写入入口：提交后经进程内通知唤醒订阅方"""
    return RunLedger(uow_factory=get_uow, notifier=event_notifier())


def get_title_service() -> TitleService:
    return TitleService(uow_factory=get_uow, ledger=get_run_ledger(), read_uow_factory=get_read_uow)


def get_retrieval_service():
    from app.application.services.retrieval_service import RetrievalService
    return RetrievalService(get_uow, get_read_uow)


def get_memory_service():
    from app.application.services.memory_service import MemoryService
    return MemoryService(get_uow, get_read_uow, get_retrieval_service())


def get_working_style_service():
    from app.application.services.working_style_service import WorkingStyleService
    return WorkingStyleService(get_uow, get_read_uow)


def get_context_assembly():
    from app.application.services.context_assembly import ContextAssembly
    return ContextAssembly(get_uow, get_read_uow, get_retrieval_service(), get_memory_service())


async def load_llm_config():
    """后台任务调用辅助模型时读取当前的模型配置。"""
    return (await get_app_config_repository().load()).llm_config


async def get_memory_extractor():
    from app.application.services.memory_extractor import LLMMemoryExtractor
    return LLMMemoryExtractor(await load_llm_config())


def get_workspace_memory_runtime():
    """工作区会话的背景装配、记忆工具端口与运行结束后的任务登记；唤醒后台执行器在它启动后才有意义。"""
    from app.application.services.background_jobs import get_job_runner
    from app.application.services.workspace_memory_runtime import WorkspaceMemoryRuntime

    def wake() -> None:
        try:
            get_job_runner().wake()
        except RuntimeError:
            pass  # 执行器未启动（测试或启动阶段）：任务仍已登记，启动后会被领取

    retrieval, memory = get_retrieval_service(), get_memory_service()
    return WorkspaceMemoryRuntime(memory, retrieval, get_working_style_service(), get_context_assembly(), wake=wake)


async def get_agent_service() -> AgentService:
    """每个请求按当前配置组装；配置读取自业务库，模型密钥仍从环境解析。"""
    app_config = await get_app_config_repository().load()
    return AgentService(
        uow_factory=get_uow,
        read_uow_factory=get_read_uow,
        llm=OpenAILLM(app_config.llm_config),
        llm_config=app_config.llm_config,
        agent_config=app_config.agent_config,
        mcp_config=app_config.mcp_config,
        a2a_config=app_config.a2a_config,
        task_cls=LocalRunTask,
        search_engine=BingSearchEngine(),
        file_storage=get_file_storage(),
        ledger=get_run_ledger(),
        notifier=event_notifier(),
        tool_policy=app_config.tool_policy,
        skill_service=get_skill_service(),
        workdirs=get_workdirs(),
        web_reader=PublicWebReader(),
        capabilities=get_capability_service(),
        file_access=get_run_file_access(),
        write_leases=get_write_leases(),
        workspace_memory=get_workspace_memory_runtime(),
    )


def get_skill_service():
    from app.application.services.skill_service import SkillService
    from app.infrastructure.repositories.db_skill_repository import DBSkillRepository
    from app.infrastructure.external.skills.storage import SkillStorage
    from app.infrastructure.external.skills.github import GitHubSkills
    from sqlalchemy import select
    from app.infrastructure.models.session import SessionModel
    from app.infrastructure.models.root import RootModel

    current = get_settings()

    async def config_loader():
        return (await get_app_config_repository().load()).skill_config

    async def workspace_locator(workspace_id: str = "", session_id: str | None = None):
        async with get_read_uow() as uow:
            wid = workspace_id or None
            if not wid and session_id:
                session = await uow.db_session.get(SessionModel, session_id)
                wid = session.workspace_id if session else None
            if not wid:
                return None, None
            rows = await uow.db_session.scalars(
                select(RootModel).where(RootModel.workspace_id == wid, RootModel.kind == "workspace_folder"))
            root = rows.first()
            return (root.location if root else None), wid

    return SkillService(
        DBSkillRepository(get_database()), SkillStorage(data_root().skills, current),
        GitHubSkills(current), current,
        config_loader=config_loader, workspace_locator=workspace_locator,
    )
