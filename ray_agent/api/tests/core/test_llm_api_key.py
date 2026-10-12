#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LLM 密钥只从环境变量注入，不读写 yaml。"""
from pathlib import Path

import yaml

from app.domain.models.app_config import LLMConfig
from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository
from app.interfaces.schemas.app_config import LLMConfigPublic

SAMPLE_CONFIG = """
llm_config:
  base_url: https://api.deepseek.com/
  api_key: sk-from-yaml
  model_name: deepseek-chat
  temperature: 0.7
  max_tokens: 8192
agent_config:
  max_iterations: 100
  max_retries: 3
  max_search_results: 10
mcp_config:
  mcpServers: {}
a2a_config:
  a2a_servers: []
"""


def _patch_settings(monkeypatch, deepseek_api_key: str = "", deepseek_url: str = ""):
    monkeypatch.setenv("DEEPSEEK_API_KEY", deepseek_api_key)
    monkeypatch.setenv("DEEPSEEK_URL", deepseek_url)


def test_load_injects_env_api_key_and_ignores_yaml_key(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == "sk-from-env"
    assert app_config.llm_config.model_name == "deepseek-chat"


def test_deepseek_url_overrides_yaml_address(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env", deepseek_url="https://api.deepseek.com/v1")

    app_config = FileAppConfigRepository("config.yaml").load()
    assert str(app_config.llm_config.base_url).rstrip("/") == "https://api.deepseek.com/v1"
    assert app_config.llm_config.api_key == "sk-from-env"


def test_load_ignores_yaml_api_key_when_env_empty(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch)

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == ""


def test_save_omits_api_key_and_keeps_model_fields(tmp_path: Path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")

    repository = FileAppConfigRepository("config.yaml")
    app_config = repository.load()
    app_config.llm_config = app_config.llm_config.model_copy(
        update={"model_name": "glm-4", "base_url": "https://example.test/v1"}
    )
    repository.save(app_config)

    persisted = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert "api_key" not in persisted["llm_config"]
    assert persisted["llm_config"]["model_name"] == "glm-4"
    assert persisted["llm_config"]["base_url"] == "https://example.test/v1"


def test_yaml_streaming_survives_settings_update_and_defaults_when_omitted(tmp_path: Path, monkeypatch):
    import asyncio

    from app.application.services.app_config_service import AppConfigService
    from app.interfaces.schemas.app_config import LLMConfigUpdate

    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        SAMPLE_CONFIG.replace(
            "  max_tokens: 8192\n",
            "  max_tokens: 8192\n  streaming: false\n  request_timeout: 30\n",
        ),
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, deepseek_api_key="sk-from-env")
    repository = FileAppConfigRepository("config.yaml")
    service = AppConfigService(repository)
    update = LLMConfigUpdate(base_url="https://example.test/v1", model_name="glm-4")
    asyncio.run(service.update_llm_config(update.model_dump(mode="json", exclude_unset=True)))

    persisted = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert persisted["llm_config"]["streaming"] is False
    assert persisted["llm_config"]["request_timeout"] == 30
    loaded = repository.load()
    assert loaded.llm_config.streaming is False
    assert loaded.llm_config.request_timeout == 30
    assert loaded.llm_config.model_name == "glm-4"

    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    omitted = FileAppConfigRepository("config.yaml").load()
    assert omitted.llm_config.streaming is True
    assert omitted.llm_config.request_timeout == 3600


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
    import asyncio
    from app.application.services.app_config_service import AppConfigService
    from app.domain.models.model_catalog import client_config
    config_path = tmp_path / "config.yaml"
    config_path.write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XIAOYI_URL", "https://gpt.test/v1")
    monkeypatch.setenv("XIAOYI_API_KEY", "sk-gpt-secret")
    _patch_settings(monkeypatch, deepseek_api_key="sk-env-secret")
    repository = FileAppConfigRepository("config.yaml")
    updated = asyncio.run(AppConfigService(repository).update_llm_config({"temperature": .4}))
    assert client_config(updated, "gpt-6-luna").api_key == "sk-gpt-secret"
    assert client_config(repository.load().llm_config, "gpt-6-luna").api_key == "sk-gpt-secret"
    persisted = config_path.read_text()
    assert "sk-gpt-secret" not in persisted and "sk-env-secret" not in persisted
    assert "resolved_endpoints" not in persisted
    public = LLMConfigPublic.from_llm(updated).model_dump()
    assert "llm_endpoints" not in public and "model_endpoints" not in public
