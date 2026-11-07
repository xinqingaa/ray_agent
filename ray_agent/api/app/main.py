#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.infrastructure.logging import setup_logging
from app.interfaces.endpoints.routes import router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.instance_access import InstanceAccessMiddleware
from app.interfaces.schemas import ErrorResponse
from app.interfaces.schemas.core import PROTOCOL_VERSION
from core.config import get_settings

settings = get_settings()
setup_logging()
logger = logging.getLogger()

# 停止时先等正在启动的运行，再停活动运行；两段加上 HTTP 收尾要短于核心的自退期限与宿主的退出等待
PENDING_START_STOP_SECONDS = 4
RUN_STOP_SECONDS = 8

openapi_tags = [
    {
        "name": "状态模块",
        "description": "包含 **状态监测** 等API 接口，用于监测系统的运行状态。"
    }
]


async def start_core():
    """打开数据根：实例锁、业务库迁移与连接、默认配置、启动扫描与后台任务。返回关闭时需要的资源。"""
    from app.application.services.background_jobs import BackgroundJobRunner, cleanup_handler, set_job_runner
    from app.domain.models.operation import OperationKind
    from app.domain.services.approvals import interrupt_waiting_approvals
    from app.infrastructure.storage.sqlite import InstanceLock, migrate, open_database, set_database, get_uow, \
        get_read_uow
    from app.interfaces.core_descriptor import INSTANCE, set_storage_revision
    from app.interfaces.service_dependencies import get_app_config_repository, get_file_storage, get_run_ledger, \
        get_skill_service, get_workdirs
    from core.paths import data_root

    root = data_root()
    root.prepare()
    lock = InstanceLock(root.lock)
    lock.acquire()
    database = None
    try:
        revision = await asyncio.to_thread(migrate, root.database)
        # alembic 的日志配置会改动根日志，迁移后恢复业务日志
        setup_logging()
        database = open_database(root.database)
        await database.init()
        set_database(database)
        set_storage_revision(revision)
        logger.info(f"业务库就绪 schema={revision} 数据根={root.root}")

        await get_app_config_repository().seed()
        await get_skill_service().initialize()

        storage, workdirs = get_file_storage(), get_workdirs()
        jobs = BackgroundJobRunner(get_uow, INSTANCE.instance_id, concurrency=settings.background_job_concurrency,
                                   poll_seconds=settings.background_job_poll_seconds, read_uow_factory=get_read_uow)
        jobs.register(OperationKind.DATA_CLEANUP, cleanup_handler(storage.remove_key, workdirs.remove),
                      requeue_on_restart=True)
        set_job_runner(jobs)

        # 启动扫描：执行协程只存在于本进程，上次遗留的 running 运行置为 interrupted，其未消费输入保持可见；
        # 等待审批的运行同样中断并使审批失效；等待提问的运行保持 waiting，回复后沿原运行续接。
        ledger = get_run_ledger()
        interrupted = await ledger.interrupt_running()
        interrupted += await interrupt_waiting_approvals(get_uow, ledger)
        if interrupted:
            logger.info(f"启动扫描将 {len(interrupted)} 个运行置为 interrupted: {[run.id for run in interrupted]}")
        recovered = await jobs.recover()
        if recovered:
            logger.info(f"启动扫描接管 {len(recovered)} 个后台任务")
        jobs.start()
        return lock, database, jobs
    except BaseException:
        if database is not None:
            await database.shutdown()
            set_database(None)
        lock.release()
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("RayAgent正在初始化")
    from app.application.services.background_jobs import set_job_runner
    from app.application.services.visual_artifacts import expire_visual_artifacts
    from app.infrastructure.external.task.local_task import LocalRunTask
    from app.infrastructure.storage.sqlite import get_uow, set_database
    from app.interfaces.service_dependencies import get_file_storage, get_skill_service

    try:
        lock, database, jobs = await start_core()
    except BaseException as exc:
        from app.interfaces.core_descriptor import record_startup_failure
        record_startup_failure(exc)
        raise
    await expire_visual_artifacts(get_uow, get_file_storage())

    async def sweep():
        while True:
            await asyncio.sleep(30)
            try:
                await get_skill_service().collect()
                await expire_visual_artifacts(get_uow, get_file_storage())
            except Exception:
                logger.exception('定期回收失败，将在下一轮重试')
    sweeper = asyncio.create_task(sweep())

    try:
        yield
    finally:
        sweeper.cancel()
        try:
            await sweeper
        except asyncio.CancelledError:
            pass
        try:
            logger.info("RayAgent正在关闭")
            from app.application.services.agent_service import pending_starts
            owners = list(pending_starts().values())
            for owner in owners:
                owner.cancelled = True
            await asyncio.wait_for(asyncio.gather(
                *(owner.worker for owner in owners if owner.worker is not None), return_exceptions=True),
                timeout=PENDING_START_STOP_SECONDS)
            await asyncio.wait_for(LocalRunTask.destroy(), timeout=RUN_STOP_SECONDS)
            logger.info("运行任务已停止")
        except asyncio.TimeoutError:
            logger.warning("运行任务停止超时，遗留运行由下次启动扫描处理")
        except Exception as e:
            logger.error(f"停止运行任务期间出现错误: {str(e)}")
        await jobs.stop()
        set_job_runner(None)
        await database.shutdown()
        set_database(None)
        lock.release()
        logger.info("RayAgent应用关闭成功")


app = FastAPI(
    title="RayAgent通用智能体",
    description="RayAgent 本机核心：会话、运行与事件保存在本机业务库，经 MCP 与 A2A 连接外部工具与远程 Agent",
    lifespan=lifespan,
    openapi_tags=openapi_tags,
    version=str(PROTOCOL_VERSION),
)

# 实例令牌走请求头，不用 Cookie；CORS 在最外层，令牌被拒绝的响应也带跨域头，界面能读到结构化错误
app.add_middleware(InstanceAccessMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-RayAgent-Download-Warning"],
)

register_exception_handlers(app)

app.include_router(router, prefix="/api", responses={"default": {"model": ErrorResponse, "description": "结构化错误"}})
