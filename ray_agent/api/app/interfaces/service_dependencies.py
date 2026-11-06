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
    return CapabilityService()


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
    return DataService(get_uow, get_job_runner())


def get_file_preview_service():
    from app.application.services.file_preview_service import FilePreviewService
    return FilePreviewService(get_file_service())


def get_run_ledger() -> RunLedger:
    """运行与事件的写入入口：提交后经进程内通知唤醒订阅方"""
    return RunLedger(uow_factory=get_uow, notifier=event_notifier())


def get_title_service() -> TitleService:
    return TitleService(uow_factory=get_uow, ledger=get_run_ledger())


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
    )


def get_skill_service():
    from app.application.services.skill_service import SkillService
    from app.infrastructure.repositories.db_skill_repository import DBSkillRepository
    from app.infrastructure.external.skills.storage import SkillStorage
    from app.infrastructure.external.skills.github import GitHubSkills
    current = get_settings()
    return SkillService(DBSkillRepository(get_database()), SkillStorage(data_root().skills, current),
                        GitHubSkills(current), current)
