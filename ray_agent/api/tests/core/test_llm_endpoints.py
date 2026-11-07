import asyncio
import os

import pytest

from app.domain.external.llm import LLMRequestError
from app.domain.models.app_config import LLMConfig
from app.domain.models.model_catalog import active_models, auxiliary_call, client_config, model_request, public_capabilities, resolve_active
from app.infrastructure.external.llm.model_connections import load_model_connections
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from tests.support.model_connections import connect, providers, write_connections


def test_file_maps_models_to_providers_and_reloads_after_edit(isolated_model_connections):
    path = isolated_model_connections
    text = '''
[providers.extra]
base_url = "https://other.test/v1"
api_key = "sk-first"
models = ["gpt-6-luna"]
'''
    config = connect(LLMConfig(), path, text)
    bound = client_config(config, "gpt-6-luna")
    assert str(bound.base_url) == "https://other.test/v1" and bound.api_key == "sk-first"
    assert [item.id for item in active_models(config)] == ["gpt-6-luna"]
    spec = active_models(config)[0]
    assert public_capabilities(spec)["vendor"] == "openai"
    assert "extra" not in str(public_capabilities(spec))
    config = connect(LLMConfig(), path, text.replace("sk-first", "sk-second-longer").replace("other", "replacement"))
    assert client_config(config, spec.id).api_key == "sk-second-longer"
    assert str(client_config(config, spec.id).base_url) == "https://replacement.test/v1"


def test_missing_file_means_no_models_and_no_global_fallback(isolated_model_connections):
    config = connect(LLMConfig(api_key="sk-default"), isolated_model_connections, '[providers]\n')
    assert active_models(config) == ()
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, "deepseek-flash")
    os.remove(isolated_model_connections)
    source = load_model_connections().source
    assert source.exists is False and source.providers == [] and source.path == str(isolated_model_connections)


@pytest.mark.parametrize("effort", ["high", "none"])
def test_gpt_snapshot_restores_exact_effort_even_with_proxy_default(effort):
    config = LLMConfig(base_url="https://proxy.test/v1")
    restored = model_request(config, model_id="deepseek-flash", reasoning="disabled", snapshot={
        "model_name": "gpt-6-luna", "thinking": None, "reasoning": effort,
        "reasoning_effort": effort, "keep_reasoning": False,
    })
    assert restored.model_name == "gpt-6-luna"
    assert restored.reasoning_effort == effort
    llm = OpenAILLM(config.model_copy(update={"model_name": restored.model_name}),
                    thinking=restored.thinking, reasoning_effort=restored.reasoning_effort)
    kwargs = llm._request_kwargs([{"role": "user", "content": "hello"}], None, None, None, stream=False)
    assert kwargs["reasoning_effort"] == effort and "extra_body" not in kwargs


def test_proxy_preserves_default_and_auxiliary_model():
    config = LLMConfig(base_url="https://proxy.test/v1", api_key="sk")
    assert resolve_active(config, None, None)[0].id == "deepseek-flash"
    short, thinking, effort = auxiliary_call(config, max_tokens=256, temperature=.2, timeout=20)
    assert str(short.base_url) == "https://proxy.test/v1"
    assert (short.model_name, thinking, effort) == ("deepseek-flash", "disabled", None)


def test_removed_endpoint_or_mapping_never_falls_back():
    config = LLMConfig(api_key="sk-default")
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, "gpt-6-luna")
    config.model_endpoints["deepseek-flash"] = "missing"
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, "deepseek-flash")


def test_global_client_follows_the_default_model_provider(isolated_model_connections):
    config = connect(LLMConfig(model_name="gpt-6-luna"), isolated_model_connections, providers(protocol="chat_completions"))
    assert (str(config.base_url).rstrip("/"), config.api_key, config.api_protocol) == (
        "https://gpt.test/v1", "sk-gpt", "chat_completions")
    config = connect(LLMConfig(model_name="custom"), isolated_model_connections, providers())
    assert str(config.base_url).rstrip("/") == "https://api.deepseek.com" and config.api_key == "sk-deepseek"


@pytest.mark.parametrize("protocol", ["responses", "chat_completions"])
def test_waiting_agent_restores_gpt_client_without_default_host_detection(isolated_model_connections, protocol):
    from types import SimpleNamespace
    from app.application.services.agent_service import AgentService
    from app.domain.models.session import Session, SessionStatus
    config = connect(LLMConfig(), isolated_model_connections, providers())
    class Uow:
        async def __aenter__(self):
            async def get(_):
                return SimpleNamespace(config_snapshot={"model_name": "gpt-6-luna", "thinking": None,
                    "reasoning": "high", "reasoning_effort": "high", "keep_reasoning": False, "api_protocol": protocol})
            self.run = SimpleNamespace(get=get)
            return self
        async def __aexit__(self, *args):
            pass
    service = AgentService.__new__(AgentService)
    service._llm_config, service._uow, service._llm = config, Uow(), object()
    llm = asyncio.run(service._llm_for_run(Session(model_id="deepseek-flash", reasoning="disabled"),
                                         SessionStatus.WAITING, "run"))
    assert (llm.model_name, llm.reasoning_effort) == ("gpt-6-luna", "high")
    assert llm.api_protocol == protocol
    assert str(llm._client.base_url).rstrip("/") == "https://gpt.test/v1"


def test_missing_key_fails_before_network_and_other_models_still_work(isolated_model_connections):
    config = connect(LLMConfig(), isolated_model_connections, providers(gpt_key=""))
    status = {item.name: item for item in config.connections.providers}
    assert status["gpt"].has_key is False and status["gpt"].key_hint is None
    assert status["deepseek"].has_key is True and status["deepseek"].key_hint == "••••"
    bound = client_config(config, "gpt-6-luna")
    llm = OpenAILLM(bound.model_copy(update={"model_name": "gpt-6-luna"}))
    async def unexpected(*args, **kwargs):
        raise AssertionError("missing key must not call network")
    llm._client.chat.completions.create = unexpected
    with pytest.raises(LLMRequestError, match="未配置 API Key"):
        asyncio.run(llm.invoke([{"role": "user", "content": "hello"}]))
    assert client_config(config, "deepseek-flash").api_key == "sk-deepseek"
    dumped = str(config.model_dump())
    assert "sk-deepseek" not in dumped and "resolved_endpoints" not in dumped and "connections" not in dumped
    assert "sk-deepseek" not in repr(config.resolved_endpoints)


def test_key_hint_shows_only_the_tail_of_long_keys(isolated_model_connections):
    config = connect(LLMConfig(), isolated_model_connections, providers(deepseek_key="sk-abcdefghijkl1234"))
    hint = next(item.key_hint for item in config.connections.providers if item.name == "deepseek")
    assert hint == "••••1234"


@pytest.mark.parametrize("field,text", [
    ("base_url", 'base_url = "invalid-address-with-secret"\napi_key = "sk-secret"\nmodels = ["gpt-6-luna"]'),
    ("protocol", 'base_url = "https://gpt.test/v1"\napi_key = "sk-secret"\nprotocol = "sk-secret"\nmodels = ["gpt-6-luna"]'),
    ("models", 'base_url = "https://gpt.test/v1"\napi_key = "sk-secret"\nmodels = []'),
    ("token", 'base_url = "https://gpt.test/v1"\ntoken = "sk-secret"\nmodels = ["gpt-6-luna"]'),
])
def test_invalid_provider_is_isolated_and_never_echoes_values(isolated_model_connections, caplog, field, text):
    good = '[providers.deepseek]\nbase_url = "https://ds.test/v1"\napi_key = "sk-ds"\nmodels = ["deepseek-flash"]\n'
    config = connect(LLMConfig(), isolated_model_connections, good + "[providers.gpt]\n" + text + "\n")
    assert config.resolved_endpoints["gpt"] is None and config.resolved_endpoints["deepseek"] is not None
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, "gpt-6-luna")
    assert client_config(config, "deepseek-flash").api_key == "sk-ds"
    issue = next(item.issue for item in config.connections.providers if item.name == "gpt")
    assert field in issue
    public = config.connections.model_dump_json()
    for secret in ("invalid-address-with-secret", "sk-secret"):
        assert secret not in public and secret not in caplog.text


def test_unparsable_file_reports_position_without_values(isolated_model_connections):
    config = connect(LLMConfig(), isolated_model_connections, '[providers.gpt]\napi_key = "sk-secret\n')
    assert config.connections.exists and config.connections.issue.startswith("配置文件格式错误")
    assert "sk-secret" not in config.connections.issue
    assert active_models(config) == ()


def test_unknown_and_duplicate_models_are_ignored_with_reasons(isolated_model_connections):
    text = providers() + '''
[providers.backup]
base_url = "https://backup.test/v1"
api_key = "sk-backup"
models = ["deepseek-flash", "no-such-model"]
'''
    config = connect(LLMConfig(), isolated_model_connections, 'unexpected = 1\n' + text)
    backup = next(item for item in config.connections.providers if item.name == "backup")
    assert backup.models == [] and "no-such-model" in backup.issue and "deepseek-flash 已由 deepseek 提供" in backup.issue
    assert client_config(config, "deepseek-flash").api_key == "sk-deepseek"
    assert config.connections.notices == ["不认识的配置项 unexpected，已忽略"]


def test_readable_by_others_adds_a_notice(isolated_model_connections, caplog):
    write_connections(isolated_model_connections, providers(), mode=0o644)
    source = load_model_connections().source
    assert any("chmod 600" in notice for notice in source.notices)
    write_connections(isolated_model_connections, providers(), mode=0o600)
    assert load_model_connections().source.notices == []
