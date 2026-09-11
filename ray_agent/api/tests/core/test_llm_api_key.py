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


class _FakeSettings:
    def __init__(self, llm_api_key: str = "") -> None:
        self.llm_api_key = llm_api_key


def _patch_settings(monkeypatch, llm_api_key: str = ""):
    monkeypatch.setattr(
        "app.infrastructure.repositories.file_app_config_repository.get_settings",
        lambda: _FakeSettings(llm_api_key=llm_api_key),
    )


def test_load_injects_env_api_key_and_ignores_yaml_key(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, llm_api_key="sk-from-env")

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == "sk-from-env"
    assert app_config.llm_config.model_name == "deepseek-chat"


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
    _patch_settings(monkeypatch, llm_api_key="sk-from-env")

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
