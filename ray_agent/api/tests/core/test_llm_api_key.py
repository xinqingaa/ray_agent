#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""应用配置保存在业务库；模型连接只来自配置文件，不写入业务库，也不以明文返回给页面。"""
from sqlalchemy import select

from app.domain.models.app_config import LLMConfig
from app.infrastructure.models import AppConfigModel
from app.infrastructure.repositories.db_app_config_repository import DBAppConfigRepository
from app.interfaces.schemas.app_config import LLMConfigPublic
from tests.support.model_connections import providers, write_connections
from tests.support.sqlite_db import with_database

STORED_LLM = {"base_url": "https://stored.test/", "api_key": "sk-stored", "model_name": "deepseek-chat",
              "temperature": 0.7, "max_tokens": 8192,
              "llm_endpoints": {"deepseek": {"url_env": "DEEPSEEK_URL", "key_env": "DEEPSEEK_API_KEY"}}}


async def _store_llm(uow_factory, data: dict) -> None:
    async with uow_factory() as uow:
        uow.db_session.add(AppConfigModel(key="llm_config", data=data, version=1))


async def _raw(read_factory, key: str) -> AppConfigModel:
    async with read_factory() as uow:
        return (await uow.db_session.execute(select(AppConfigModel).where(AppConfigModel.key == key))).scalar_one()


def test_load_uses_file_connections_and_ignores_stored_ones(tmp_path, isolated_model_connections):
    write_connections(isolated_model_connections, providers(deepseek_key="sk-from-file"))

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, STORED_LLM)
        config = await DBAppConfigRepository(uow_factory, read_factory).load()
        assert config.llm_config.api_key == "sk-from-file"
        assert str(config.llm_config.base_url).rstrip("/") == "https://api.deepseek.com"
        assert config.llm_config.model_name == "deepseek-chat"
    with_database(tmp_path, scenario)


def test_load_without_file_has_no_key_and_no_models(tmp_path):
    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, STORED_LLM)
        llm = (await DBAppConfigRepository(uow_factory, read_factory).load()).llm_config
        assert llm.api_key == "" and llm.connections.exists is False
        assert LLMConfigPublic.from_llm(llm).model_profiles == {}
    with_database(tmp_path, scenario)


def test_seed_and_save_never_persist_connections(tmp_path, isolated_model_connections):
    write_connections(isolated_model_connections, providers(deepseek_key="sk-env-secret", gpt_key="sk-gpt-secret"))

    async def scenario(uow_factory, read_factory, database):
        repository = DBAppConfigRepository(uow_factory, read_factory)
        await repository.seed()
        await repository.seed()
        seeded = await _raw(read_factory, "llm_config")
        assert seeded.version == 1
        config = await repository.load()
        config.llm_config = config.llm_config.model_copy(update={"model_name": "glm-4"})
        await repository.save(config)
        await repository.save(config)
        persisted = await _raw(read_factory, "llm_config")
        assert persisted.version == 2 and persisted.data["model_name"] == "glm-4"
        assert (await _raw(read_factory, "agent_config")).version == 1
        async with read_factory() as uow:
            rows = (await uow.db_session.execute(select(AppConfigModel))).scalars().all()
        stored = str([row.data for row in rows])
        for absent in ("sk-gpt-secret", "sk-env-secret", "api_key", "base_url", "model_endpoints",
                       "resolved_endpoints", "connections", "gpt.test"):
            assert absent not in stored
    with_database(tmp_path, scenario)


def test_streaming_survives_settings_update_and_defaults_when_omitted(tmp_path, isolated_model_connections):
    from app.application.services.app_config_service import AppConfigService
    from app.domain.models.model_catalog import client_config
    from app.interfaces.schemas.app_config import LLMConfigUpdate
    write_connections(isolated_model_connections, providers())

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, {**STORED_LLM, "streaming": False, "request_timeout": 30})
        repository = DBAppConfigRepository(uow_factory, read_factory)
        update = LLMConfigUpdate(model_name="glm-4")
        updated = await AppConfigService(repository).update_llm_config(
            {**update.model_dump(mode="json", exclude_unset=True), "base_url": "https://ignored.test/v1",
             "api_key": "sk-ignored"})
        assert client_config(updated, "gpt-6-luna").api_key == "sk-gpt"
        persisted = await _raw(read_factory, "llm_config")
        assert persisted.data["streaming"] is False and persisted.data["request_timeout"] == 30
        assert "sk-ignored" not in str(persisted.data) and "ignored.test" not in str(persisted.data)
        loaded = await repository.load()
        assert loaded.llm_config.streaming is False and loaded.llm_config.request_timeout == 30
        assert loaded.llm_config.model_name == "glm-4"
        async with uow_factory() as uow:
            row = await uow.db_session.get(AppConfigModel, "llm_config")
            row.data = dict(STORED_LLM)
        omitted = await repository.load()
        assert omitted.llm_config.streaming is True and omitted.llm_config.request_timeout == 3600
    with_database(tmp_path, scenario)


def test_public_schema_has_masks_but_never_keys(isolated_model_connections):
    from tests.support.model_connections import connect
    llm = connect(LLMConfig(model_name="deepseek-chat"), isolated_model_connections,
                  providers(deepseek_key="sk-secret-value-0042"))
    public = LLMConfigPublic.from_llm(llm).model_dump(mode="json")
    text = str(public)
    assert "sk-secret-value-0042" not in text and "api_key" not in text
    assert "llm_endpoints" not in public and "model_endpoints" not in public
    deepseek = next(item for item in public["connections"]["providers"] if item["name"] == "deepseek")
    assert deepseek["has_key"] is True and deepseek["key_hint"] == "••••0042"
    assert public["model_name"] == "deepseek-chat" and "gpt-6-luna" in public["model_profiles"]
