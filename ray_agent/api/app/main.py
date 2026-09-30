#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.domain.services.approvals import interrupt_waiting_approvals
from app.infrastructure.external.project.managed_storage import get_managed_storage
from app.infrastructure.logging import setup_logging
from app.infrastructure.storage.cos import get_cos
from app.infrastructure.storage.postgres import get_postgres, get_uow
from app.infrastructure.storage.redis import get_redis
from app.interfaces.endpoints.routes import router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_agent_service, get_run_ledger
from core.config import get_settings

# 1.加载配置信息
settings = get_settings()

# 2.初始化日志系统
setup_logging()
logger = logging.getLogger()

# 3.定义FastAPI路由tags标签
openapi_tags = [
    {
        "name": "状态模块",
        "description": "包含 **状态监测** 等API 接口，用于监测系统的运行状态。"
    }
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """创建FastAPI应用生命周期上下文管理器"""
    # 0.重新初始化日志系统(uvicorn启动时dictConfig会影响根日志处理器，需要在此重新配置)
    setup_logging()

    # 1.日志打印代码已经开始执行了
    logger.info("RayAgent正在初始化")

    # 2.运行数据库迁移(将数据同步到生产环境)
    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")
    # alembic.ini 的 dictConfig 会把根日志改成 WARNING，迁移后恢复业务日志
    setup_logging()

    # 3.初始化Redis/Postgres，按配置决定是否初始化COS
    await get_redis().init()
    await get_postgres().init()
    if settings.file_storage_backend == "cos":
        await get_cos().init()
    else:
        Path(settings.file_storage_local_dir).mkdir(parents=True, exist_ok=True)
        logger.info(f"文件存储使用本地磁盘: {settings.file_storage_local_dir}")

    # 项目功能单独自检，不因项目卷不可用阻止独立对话。
    storage = await asyncio.to_thread(get_managed_storage)
    if storage.reason:
        logger.warning(storage.reason)
    else:
        logger.info("托管项目存储可用")

    # 4.启动扫描：执行协程只存在于本进程，上次进程留下的 running 运行不会再推进，置为 interrupted；
    # 等待审批的运行同样置为 interrupted，待审批的调用补为未执行；等待提问的运行保持 waiting
    ledger = get_run_ledger()
    interrupted = await ledger.interrupt_running()
    interrupted += await interrupt_waiting_approvals(get_uow, ledger)
    if interrupted:
        logger.info(f"启动扫描将 {len(interrupted)} 个运行置为 interrupted: {[run.id for run in interrupted]}")

    try:
        # 4.lifespan分界点
        yield
    finally:
        try:
            # 5.等待agent服务关闭
            logger.info("RayAgent正在关闭")
            await asyncio.wait_for(get_agent_service().shutdown(), timeout=30.0)
            logger.info("Agent服务成功关闭")
        except asyncio.TimeoutError:
            logger.warning("Agent服务关闭超时, 强制关闭, 部分任务将被释放")
        except Exception as e:
            logger.error(f"Agent服务关闭期间出现错误: {str(e)}")

        # 6.关闭其他应用
        await get_redis().shutdown()
        await get_postgres().shutdown()
        if settings.file_storage_backend == "cos":
            await get_cos().shutdown()

        logger.info("RayAgent应用关闭成功")


# 4.创建RayAgent应用实例
app = FastAPI(
    title="RayAgent通用智能体",
    description="RayAgent是一个通用的AI Agent系统，可以完全私有部署，使用A2A+MCP连接Agent/Tool，同时支持在沙箱中运行各种内置工具和操作",
    lifespan=lifespan,
    openapi_tags=openapi_tags,
    version="1.0.0",
)

# 5.配置CORS中间件，解决跨域问题
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 6.注册错误处理器
register_exception_handlers(app)

# 7.集成路由
app.include_router(router, prefix="/api")
