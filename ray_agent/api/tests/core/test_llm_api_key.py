#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LLM 配置从环境变量注入，且不会写回 yaml。"""
from pathlib import Path

import yaml

from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository

SAMPLE_CONFIG = """
llm_config:
  base_url: https://api.deepseek.com/
  api_key: xxxx
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
    def __init__(
            self,
            llm_api_key: str = "",
            llm_model_name: str = "",
            llm_base_url: str = "",
            llm_temperature=None,
            llm_max_tokens=None,
    ) -> None:
        self.llm_api_key = llm_api_key
        self.llm_model_name = llm_model_name
        self.llm_base_url = llm_base_url
        self.llm_temperature = llm_temperature
        self.llm_max_tokens = llm_max_tokens


def _patch_settings(monkeypatch, **kwargs):
    monkeypatch.setattr(
        "app.infrastructure.repositories.file_app_config_repository.get_settings",
        lambda: _FakeSettings(**kwargs),
    )


def test_load_prefers_env_api_key(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, llm_api_key="sk-from-env")

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == "sk-from-env"


def test_load_treats_placeholder_as_empty(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch)

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == ""


def test_save_does_not_persist_env_api_key(tmp_path: Path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(monkeypatch, llm_api_key="sk-from-env")

    repository = FileAppConfigRepository("config.yaml")
    repository.save(repository.load())

    persisted = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert persisted["llm_config"]["api_key"] == ""


def test_load_prefers_all_llm_env_fields(tmp_path: Path, monkeypatch):
    (tmp_path / "config.yaml").write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(
        monkeypatch,
        llm_api_key="sk-from-env",
        llm_model_name="gpt-4o-mini",
        llm_base_url="https://api.openai.com/v1",
        llm_temperature=0.2,
        llm_max_tokens=1024,
    )

    app_config = FileAppConfigRepository("config.yaml").load()
    assert app_config.llm_config.api_key == "sk-from-env"
    assert app_config.llm_config.model_name == "gpt-4o-mini"
    assert str(app_config.llm_config.base_url) == "https://api.openai.com/v1"
    assert app_config.llm_config.temperature == 0.2
    assert app_config.llm_config.max_tokens == 1024


def test_save_does_not_persist_env_llm_fields(tmp_path: Path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(SAMPLE_CONFIG, encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    _patch_settings(
        monkeypatch,
        llm_api_key="sk-from-env",
        llm_model_name="gpt-4o-mini",
        llm_base_url="https://api.openai.com/v1",
        llm_temperature=0.2,
        llm_max_tokens=1024,
    )

    repository = FileAppConfigRepository("config.yaml")
    repository.save(repository.load())

    persisted = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert persisted["llm_config"]["api_key"] == ""
    assert persisted["llm_config"]["model_name"] == "deepseek-chat"
    assert persisted["llm_config"]["base_url"] == "https://api.deepseek.com/"
    assert persisted["llm_config"]["temperature"] == 0.7
    assert persisted["llm_config"]["max_tokens"] == 8192
