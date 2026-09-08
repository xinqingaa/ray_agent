#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/5/16 10:46
@Author  : thezehui@gmail.com
@File    : logging.py
"""
import logging
import sys
from contextvars import ContextVar

from core.config import get_settings

_session_id_var: ContextVar[str] = ContextVar("ray_agent_session_id", default="")


def set_log_session_id(session_id: str) -> None:
    """把当前会话 id 写入日志上下文，供后续 LLM / Flow 日志使用。"""
    _session_id_var.set(session_id or "")


def log_session_prefix() -> str:
    """有会话 id 时返回 `会话[id] ` 前缀，否则空字符串。"""
    session_id = _session_id_var.get()
    return f"会话[{session_id}] " if session_id else ""


def setup_logging():
    """配置项目日志：控制台输出、等级，并压低 SQLAlchemy 噪音。"""
    # 1.获取项目配置
    settings = get_settings()

    # 2.获取根日志处理器
    root_logger = logging.getLogger()

    # 3.清除已有的handlers，避免uvicorn的dictConfig重配置后产生冲突或重复
    root_logger.handlers.clear()

    # 4.设置根日志处理器等级
    level_name = (settings.log_level or "INFO").upper()
    log_level = getattr(logging, level_name, logging.INFO)
    root_logger.setLevel(log_level)

    # 5.日志输出格式定义
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # 6.创建控制台日志输出处理器(使用stderr，stderr在Python中始终无缓冲，Docker中更可靠)
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    # 7.将控制台日志处理器添加到根日志处理器中
    root_logger.addHandler(console_handler)

    # 8.uvicorn 可能 disable_existing_loggers，恢复业务 logger 传播
    for name in list(logging.Logger.manager.loggerDict):
        if name == "sqlalchemy" or name.startswith("sqlalchemy."):
            continue
        if name.startswith("app") or name.startswith("core"):
            child = logging.getLogger(name)
            child.disabled = False
            child.propagate = True
            if child.level == logging.NOTSET or child.level > log_level:
                child.setLevel(log_level)

    # 9.SQL 回显默认关闭；需要时由 SQLALCHEMY_ECHO 打开
    sqlalchemy_level = logging.INFO if settings.sqlalchemy_echo else logging.WARNING
    logging.getLogger("sqlalchemy").setLevel(sqlalchemy_level)
    logging.getLogger("sqlalchemy.engine").setLevel(sqlalchemy_level)
    logging.getLogger("sqlalchemy.engine.Engine").setLevel(sqlalchemy_level)

    # 10.HTTP 客户端帧日志即使在 DEBUG 下也压到 WARNING，避免盖住任务链路
    for noisy in ("httpcore", "httpx", "openai", "openai._base_client"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    root_logger.info(
        f"日志系统初始化完成 log_level={level_name} sqlalchemy_echo={settings.sqlalchemy_echo}"
    )
