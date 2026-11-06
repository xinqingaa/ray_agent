"""应用配置的业务库实现：按分区一行保存，每次保存递增版本；模型密钥只从环境读取，不写入业务库。"""
from typing import Callable, Optional

from sqlalchemy import select

from app.domain.models.app_config import AppConfig, LLMConfig, AgentConfig, MCPConfig, A2AConfig, ToolPolicyConfig
from app.domain.models.clock import utc_now
from app.domain.repositories.app_config_repository import AppConfigRepository
from app.domain.repositories.uow import IUnitOfWork
from app.infrastructure.external.llm.endpoint_settings import load_llm_endpoints
from app.infrastructure.models import AppConfigModel

SECTIONS = {
    "llm_config": LLMConfig,
    "agent_config": AgentConfig,
    "mcp_config": MCPConfig,
    "a2a_config": A2AConfig,
    "tool_policy": ToolPolicyConfig,
}


def default_app_config() -> AppConfig:
    return AppConfig(llm_config=LLMConfig(), agent_config=AgentConfig(), mcp_config=MCPConfig(),
                     a2a_config=A2AConfig())


def apply_llm_env(app_config: AppConfig) -> AppConfig:
    """统一解析端点密钥，并保留旧全局兼容客户端需要的默认连接字段。"""
    llm = app_config.llm_config
    endpoints = load_llm_endpoints(llm)
    legacy = endpoints.get("deepseek")
    updates = {"resolved_endpoints": endpoints, "api_key": legacy.api_key if legacy else ""}
    if legacy is not None:
        updates["base_url"] = legacy.base_url
    app_config.llm_config = llm.model_copy(update=updates)
    return app_config


def section_data(app_config: AppConfig, key: str) -> dict:
    data = getattr(app_config, key).model_dump(mode="json")
    if key == "llm_config":
        data.pop("api_key", None)
    return data


class DBAppConfigRepository(AppConfigRepository):

    def __init__(self, uow_factory: Callable[[], IUnitOfWork],
                 read_uow_factory: Optional[Callable[[], IUnitOfWork]] = None) -> None:
        self._uow_factory = uow_factory
        self._read_uow_factory = read_uow_factory or uow_factory

    async def load(self) -> AppConfig:
        async with self._read_uow_factory() as uow:
            rows = {row.key: row.data for row in (await uow.db_session.execute(select(AppConfigModel))).scalars()}
        defaults = default_app_config()
        values = {key: model.model_validate(rows[key]) if key in rows else getattr(defaults, key)
                  for key, model in SECTIONS.items()}
        return apply_llm_env(AppConfig(**values))

    async def save(self, app_config: AppConfig) -> None:
        async with self._uow_factory() as uow:
            await self._write(uow, app_config)

    @staticmethod
    async def _write(uow, app_config: AppConfig) -> None:
        for key in SECTIONS:
            row = await uow.db_session.get(AppConfigModel, key)
            data = section_data(app_config, key)
            if row is None:
                uow.db_session.add(AppConfigModel(key=key, data=data, version=1, updated_at=utc_now()))
            elif row.data != data:
                row.data, row.version, row.updated_at = data, row.version + 1, utc_now()
        await uow.db_session.flush()

    async def seed(self) -> None:
        """首次启动写入默认配置；已有分区不覆盖。"""
        async with self._uow_factory() as uow:
            existing = set((await uow.db_session.execute(select(AppConfigModel.key))).scalars())
            defaults = default_app_config()
            for key in SECTIONS:
                if key not in existing:
                    uow.db_session.add(AppConfigModel(key=key, data=section_data(defaults, key), version=1,
                                                      updated_at=utc_now()))
