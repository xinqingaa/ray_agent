"""应用配置的业务库实现：按分区一行保存，每次保存递增版本；模型连接来自用户配置文件，不写入业务库。"""
from typing import Callable, Optional

from sqlalchemy import select

from app.domain.models.app_config import (
    AppConfig, LLMConfig, AgentConfig, MCPConfig, A2AConfig, ToolPolicyConfig, SkillConfig,
)
from app.domain.models.clock import utc_now
from app.domain.repositories.app_config_repository import AppConfigRepository
from app.domain.repositories.uow import IUnitOfWork
from app.infrastructure.external.llm.model_connections import load_model_connections
from app.infrastructure.models import AppConfigModel

SECTIONS = {
    "llm_config": LLMConfig,
    "agent_config": AgentConfig,
    "mcp_config": MCPConfig,
    "a2a_config": A2AConfig,
    "tool_policy": ToolPolicyConfig,
    "skill_config": SkillConfig,
}


def default_app_config() -> AppConfig:
    return AppConfig(llm_config=LLMConfig(), agent_config=AgentConfig(), mcp_config=MCPConfig(),
                     a2a_config=A2AConfig(), skill_config=SkillConfig())


def apply_model_connections(app_config: AppConfig) -> AppConfig:
    """接上配置文件中的模型连接；全局兼容客户端用默认模型所在的提供商，没有时用第一个可用提供商。"""
    from app.domain.models.model_catalog import default_model
    llm = app_config.llm_config
    connections = load_model_connections()
    llm = llm.model_copy(update={"resolved_endpoints": connections.endpoints,
                                 "model_endpoints": connections.model_endpoints,
                                 "connections": connections.source})
    spec = default_model(llm)
    legacy = connections.endpoints.get(connections.model_endpoints.get(spec.id, "")) if spec else None
    legacy = legacy or next((endpoint for endpoint in connections.endpoints.values() if endpoint), None)
    updates = {"api_key": legacy.api_key if legacy else ""}
    if legacy is not None:
        updates.update(base_url=legacy.base_url, api_protocol=legacy.api_protocol)
    app_config.llm_config = llm.model_copy(update=updates)
    return app_config


def section_data(app_config: AppConfig, key: str) -> dict:
    return getattr(app_config, key).model_dump(mode="json")


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
        return apply_model_connections(AppConfig(**values))

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
