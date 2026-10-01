#!/usr/bin/env python
# -*- coding: utf-8 -*-
import logging

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.agent_service import AgentService
from app.application.services.app_config_service import AppConfigService
from app.application.services.file_service import FileService
from app.application.services.project_service import ProjectService
from app.application.services.project_file_service import ProjectFileService
from app.application.services.session_service import SessionService
from app.application.services.title_service import TitleService
from app.application.services.status_service import StatusService
from app.domain.external.file_storage import FileStorage
from app.domain.services.run_ledger import RunLedger
from app.domain.services.project_file_coordinator import ProjectFileCoordinator
from app.infrastructure.external.file_storage.cos_file_storage import CosFileStorage
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from app.infrastructure.external.health_checker.postgres_health_checker import PostgresHealthChecker
from app.infrastructure.external.health_checker.redis_health_checker import RedisHealthChecker
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.message_queue.redis_event_notifier import RedisEventNotifier
from app.infrastructure.external.project.local_project_files import LocalProjectFiles
from app.infrastructure.external.project.managed_storage import get_managed_storage
from app.infrastructure.external.sandbox.docker_sandbox import DockerSandbox
from app.infrastructure.external.search.bing_search import BingSearchEngine
from app.infrastructure.external.task.redis_stream_task import RedisStreamTask
from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository
from app.infrastructure.storage.cos import get_cos
from app.infrastructure.storage.postgres import get_db_session, get_uow
from app.infrastructure.storage.redis import RedisClient, get_redis
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def get_app_config_service() -> AppConfigService:
    """获取应用配置服务"""
    # 1.获取数据仓库并打印日志
    logger.info("加载获取AppConfigService")
    file_app_config_repository = FileAppConfigRepository(settings.app_config_filepath)

    # 2.实例化AppConfigService
    return AppConfigService(app_config_repository=file_app_config_repository)


def get_status_service(
        db_session: AsyncSession = Depends(get_db_session),
        redis_client: RedisClient = Depends(get_redis),
) -> StatusService:
    """获取状态服务"""
    # 1.初始化postgres和redis健康检查
    postgres_checker = PostgresHealthChecker(db_session)
    redis_checker = RedisHealthChecker(redis_client)

    # 2.创建服务并返回
    logger.debug("加载获取StatusService")
    return StatusService(checkers=[postgres_checker, redis_checker])


def get_file_storage() -> FileStorage:
    """按配置组装本地磁盘或腾讯云 COS 文件存储"""
    if settings.file_storage_backend == "cos":
        return CosFileStorage(
            bucket=settings.cos_bucket,
            cos=get_cos(),
            uow_factory=get_uow,
        )
    return LocalFileStorage(
        root_dir=settings.file_storage_local_dir,
        uow_factory=get_uow,
    )


def get_file_service() -> FileService:
    return FileService(
        uow_factory=get_uow,
        file_storage=get_file_storage(),
        project_files=get_project_file_service(),
    )


def get_session_service() -> SessionService:
    return SessionService(uow_factory=get_uow, sandbox_cls=DockerSandbox)


def get_project_service() -> ProjectService:
    """每次请求按当前配置组装。文件读取走 API 容器内的只读挂载，不访问沙箱。"""
    current = get_settings()
    return ProjectService(
        uow_factory=get_uow,
        files=LocalProjectFiles(),
        storage=get_managed_storage(),
        sandbox_address=current.sandbox_address,
        coordinator=ProjectFileCoordinator(get_uow, DockerSandbox, get_project_file_service().measure_size),
    )


def get_run_ledger() -> RunLedger:
    """运行与事件的写入入口：提交后经 Redis pub/sub 通知订阅方"""
    return RunLedger(uow_factory=get_uow, notifier=RedisEventNotifier())


def get_title_service() -> TitleService:
    return TitleService(uow_factory=get_uow, ledger=get_run_ledger())


def get_agent_service() -> AgentService:
    # 1.获取应用配置信息(读取配置需要实时获取,所以不配置缓存)
    app_config_repository = FileAppConfigRepository(config_path=settings.app_config_filepath)
    app_config = app_config_repository.load()

    # 2.构建依赖实例
    llm = OpenAILLM(app_config.llm_config)
    file_storage = get_file_storage()

    # 3.实例Agent服务并返回
    return AgentService(
        uow_factory=get_uow,
        llm=llm,
        agent_config=app_config.agent_config,
        mcp_config=app_config.mcp_config,
        a2a_config=app_config.a2a_config,
        sandbox_cls=DockerSandbox,
        task_cls=RedisStreamTask,
        search_engine=BingSearchEngine(),
        file_storage=file_storage,
        ledger=get_run_ledger(),
        notifier=RedisEventNotifier(),
        tool_policy=app_config.tool_policy,
        project_validator=get_project_service().validate_start,
        project_prepare=get_project_service().prepare_snapshot,
        project_file_prepare=get_project_file_service().prepare_run,
        project_attachments=get_project_file_service().attachments,
        project_delivery=get_project_file_service().delivery,
        project_file_coordinator=ProjectFileCoordinator(get_uow, DockerSandbox, get_project_file_service().measure_size),
    )


def get_project_file_service() -> ProjectFileService:
    current = get_settings()
    def retention():
        return FileAppConfigRepository(current.app_config_filepath).load().agent_config.project_snapshot_retention
    from app.application.services.project_attachment_service import ProjectAttachmentService
    from app.application.services.project_delivery_service import ProjectDeliveryService
    service = ProjectFileService(get_uow, get_managed_storage(), DockerSandbox,
        max_bytes=current.project_max_bytes, retention=retention, ledger=get_run_ledger(), settings=current)
    service.attachments = ProjectAttachmentService(service, get_file_storage())
    service.delivery = ProjectDeliveryService(service, get_file_storage())
    return service
