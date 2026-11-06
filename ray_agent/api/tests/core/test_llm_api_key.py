#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""应用配置保存在业务库；LLM 密钥只从环境变量注入，不写入业务库。"""
import asyncio

from sqlalchemy import select

from app.domain.models.app_config import LLMConfig
from app.infrastructure.models import AppConfigModel
from app.infrastructure.repositories.db_app_config_repository import DBAppConfigRepository
from app.interfaces.schemas.app_config import LLMConfigPublic
from tests.support.sqlite_db import with_database

STORED_LLM = {"base_url": "https://api.deepseek.com/", "api_key": "sk-stored", "model_name": "deepseek-chat",
              "temperature": 0.7, "max_tokens": 8192}


def _patch_settings(monkeypatch, deepseek_api_key: str = "", deepseek_url: str = ""):
    monkeypatch.setenv("DEEPSEEK_API_KEY", deepseek_api_key)
    monkeypatch.setenv("DEEPSEEK_URL", deepseek_url)


async def _store_llm(uow_factory, data: dict) -> None:
    async with uow_factory() as uow:
        uow.db_session.add(AppConfigModel(key="llm_config", data=data, version=1))


async def _raw(read_factory, key: str) -> AppConfigModel:
    async with read_factory() as uow:
        return (await uow.db_session.execute(select(AppConfigModel).where(AppConfigModel.key == key))).scalar_one()


def test_load_injects_env_api_key_and_ignores_stored_key(tmp_path, monkeypatch):
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, STORED_LLM)
        config = await DBAppConfigRepository(uow_factory, read_factory).load()
        assert config.llm_config.api_key == "sk-from-env"
        assert config.llm_config.model_name == "deepseek-chat"
    with_database(tmp_path, scenario)


def test_deepseek_url_overrides_stored_address(tmp_path, monkeypatch):
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env", deepseek_url="https://api.deepseek.com/v1")

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, STORED_LLM)
        config = await DBAppConfigRepository(uow_factory, read_factory).load()
        assert str(config.llm_config.base_url).rstrip("/") == "https://api.deepseek.com/v1"
        assert config.llm_config.api_key == "sk-from-env"
    with_database(tmp_path, scenario)


def test_load_ignores_stored_api_key_when_env_empty(tmp_path, monkeypatch):
    _patch_settings(monkeypatch)

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, STORED_LLM)
        assert (await DBAppConfigRepository(uow_factory, read_factory).load()).llm_config.api_key == ""
    with_database(tmp_path, scenario)


def test_seed_save_omit_api_key_and_bump_version(tmp_path, monkeypatch):
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")

    async def scenario(uow_factory, read_factory, database):
        repository = DBAppConfigRepository(uow_factory, read_factory)
        await repository.seed()
        await repository.seed()
        seeded = await _raw(read_factory, "llm_config")
        assert seeded.version == 1 and "api_key" not in seeded.data
        config = await repository.load()
        assert config.llm_config.api_key == "sk-from-env"
        config.llm_config = config.llm_config.model_copy(update={"model_name": "glm-4", "base_url": "https://example.test/v1"})
        await repository.save(config)
        await repository.save(config)
        persisted = await _raw(read_factory, "llm_config")
        assert "api_key" not in persisted.data and persisted.version == 2
        assert persisted.data["model_name"] == "glm-4" and persisted.data["base_url"] == "https://example.test/v1"
        assert (await _raw(read_factory, "agent_config")).version == 1
    with_database(tmp_path, scenario)


def test_streaming_survives_settings_update_and_defaults_when_omitted(tmp_path, monkeypatch):
    from app.application.services.app_config_service import AppConfigService
    from app.interfaces.schemas.app_config import LLMConfigUpdate
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")

    async def scenario(uow_factory, read_factory, database):
        await _store_llm(uow_factory, {**STORED_LLM, "streaming": False, "request_timeout": 30})
        repository = DBAppConfigRepository(uow_factory, read_factory)
        update = LLMConfigUpdate(base_url="https://example.test/v1", model_name="glm-4")
        await AppConfigService(repository).update_llm_config(update.model_dump(mode="json", exclude_unset=True))
        persisted = await _raw(read_factory, "llm_config")
        assert persisted.data["streaming"] is False and persisted.data["request_timeout"] == 30
        loaded = await repository.load()
        assert loaded.llm_config.streaming is False and loaded.llm_config.request_timeout == 30
        assert loaded.llm_config.model_name == "glm-4"
        async with uow_factory() as uow:
            row = await uow.db_session.get(AppConfigModel, "llm_config")
            row.data = dict(STORED_LLM)
        omitted = await repository.load()
        assert omitted.llm_config.streaming is True and omitted.llm_config.request_timeout == 3600
    with_database(tmp_path, scenario)


def test_public_schema_never_includes_api_key():
    public = LLMConfigPublic.from_llm(LLMConfig(
        base_url="https://api.deepseek.com/",
        api_key="sk-secret",
        model_name="deepseek-chat",
    ))
    dumped = public.model_dump()
    assert "api_key" not in dumped
    assert dumped["has_api_key"] is True
    assert dumped["model_name"] == "deepseek-chat"


def test_internal_endpoints_survive_settings_save_without_persisting_secrets(tmp_path, monkeypatch):
    from app.application.services.app_config_service import AppConfigService
    from app.domain.models.model_catalog import client_config
    monkeypatch.setenv("XIAOYI_URL", "https://gpt.test/v1")
    monkeypatch.setenv("XIAOYI_API_KEY", "sk-gpt-secret")
    _patch_settings(monkeypatch, deepseek_api_key="sk-env-secret")

    async def scenario(uow_factory, read_factory, database):
        repository = DBAppConfigRepository(uow_factory, read_factory)
        await repository.seed()
        updated = await AppConfigService(repository).update_llm_config({"temperature": .4})
        assert client_config(updated, "gpt-6-luna").api_key == "sk-gpt-secret"
        assert client_config((await repository.load()).llm_config, "gpt-6-luna").api_key == "sk-gpt-secret"
        async with read_factory() as uow:
            rows = (await uow.db_session.execute(select(AppConfigModel))).scalars().all()
        persisted = str([row.data for row in rows])
        assert "sk-gpt-secret" not in persisted and "sk-env-secret" not in persisted
        assert "resolved_endpoints" not in persisted
        public = LLMConfigPublic.from_llm(updated).model_dump()
        assert "llm_endpoints" not in public and "model_endpoints" not in public
    with_database(tmp_path, scenario)
