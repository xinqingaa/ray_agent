import asyncio

import pytest

from app.domain.external.llm import LLMRequestError
from app.domain.models.app_config import LLMConfig
from app.domain.models.llm_endpoints import LlmEndpointConfig
from app.domain.models.model_catalog import active_models, auxiliary_call, client_config, model_request, public_capabilities, resolve_active
from app.infrastructure.external.llm.endpoint_settings import load_llm_endpoints
from app.infrastructure.external.llm.openai_llm import OpenAILLM


def test_third_endpoint_remaps_existing_models_without_changing_catalog(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EXTRA_URL", "https://other.test/v1")
    monkeypatch.setenv("EXTRA_KEY", "sk-first")
    config = LLMConfig(api_key="sk-default")
    config.llm_endpoints["extra"] = LlmEndpointConfig(url_env="EXTRA_URL", key_env="EXTRA_KEY")
    config.model_endpoints["gpt-6-luna"] = "extra"
    config.resolved_endpoints = load_llm_endpoints(config)
    bound = client_config(config, "gpt-6-luna")
    assert str(bound.base_url) == "https://other.test/v1"
    assert bound.api_key == "sk-first"
    spec = next(item for item in active_models(config) if item.id == "gpt-6-luna")
    assert public_capabilities(spec)["vendor"] == "openai"
    assert "extra" not in str(public_capabilities(spec))
    monkeypatch.setenv("EXTRA_URL", "https://replacement.test/v1")
    monkeypatch.setenv("EXTRA_KEY", "sk-second")
    config.resolved_endpoints = load_llm_endpoints(config)
    assert client_config(config, spec.id).api_key == "sk-second"
    assert str(client_config(config, spec.id).base_url) == "https://replacement.test/v1"


def test_dotenv_uses_standard_parsing_and_process_environment_wins(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("XIAOYI_API_KEY", raising=False)
    (tmp_path / ".env").write_text('XIAOYI_URL="https://dotenv.test/v1" # comment\nXIAOYI_API_KEY="sk-local"\n')
    monkeypatch.setenv("XIAOYI_URL", "https://process.test/v1")
    endpoints = load_llm_endpoints(LLMConfig())
    assert str(endpoints["gpt"].base_url) == "https://process.test/v1"
    assert endpoints["gpt"].api_key == "sk-local"


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


def test_custom_environment_reference_cannot_use_legacy_fallback(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CUSTOM_URL", raising=False)
    config = LLMConfig(api_key="sk-default")
    config.llm_endpoints["deepseek"] = LlmEndpointConfig(url_env="CUSTOM_URL", key_env="CUSTOM_KEY")
    config.resolved_endpoints = load_llm_endpoints(config)
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, "deepseek-flash")


def test_waiting_agent_restores_gpt_client_without_default_host_detection(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from app.application.services.agent_service import AgentService
    from app.domain.models.session import Session, SessionStatus
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XIAOYI_URL", "https://gpt.test/v1")
    monkeypatch.setenv("XIAOYI_API_KEY", "sk-gpt")
    config = LLMConfig(base_url="https://proxy.test/v1", api_key="sk-default")
    config.resolved_endpoints = load_llm_endpoints(config)
    class Uow:
        async def __aenter__(self):
            async def get(_):
                return SimpleNamespace(config_snapshot={"model_name": "gpt-6-luna", "thinking": None,
                    "reasoning": "high", "reasoning_effort": "high", "keep_reasoning": False})
            self.run = SimpleNamespace(get=get)
            return self
        async def __aexit__(self, *args):
            pass
    service = AgentService.__new__(AgentService)
    service._llm_config, service._uow, service._llm = config, Uow(), object()
    llm = asyncio.run(service._llm_for_run(Session(model_id="deepseek-flash", reasoning="disabled"),
                                         SessionStatus.WAITING, "run"))
    assert (llm.model_name, llm.reasoning_effort) == ("gpt-6-luna", "high")
    assert str(llm._client.base_url).rstrip("/") == "https://gpt.test/v1"


def test_missing_key_fails_before_network_and_other_models_still_work(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("XIAOYI_URL", "https://upstream.test/v1")
    monkeypatch.setenv("XIAOYI_API_KEY", "")
    config = LLMConfig(api_key="sk-default")
    config.resolved_endpoints = load_llm_endpoints(config)
    bound = client_config(config, "gpt-6-luna")
    llm = OpenAILLM(bound.model_copy(update={"model_name": "gpt-6-luna"}))
    async def unexpected(*args, **kwargs):
        raise AssertionError("missing key must not call network")
    llm._client.chat.completions.create = unexpected
    with pytest.raises(LLMRequestError, match="未配置 API Key"):
        asyncio.run(llm.invoke([{"role": "user", "content": "hello"}]))
    assert client_config(config, "deepseek-flash").api_key == "sk-default"
    assert "resolved_endpoints" not in config.model_dump()
    assert "sk-default" not in repr(config.resolved_endpoints)


def test_explicit_empty_key_does_not_reuse_old_value(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    config = LLMConfig(api_key="sk-old")
    assert load_llm_endpoints(config)["deepseek"].api_key == ""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-new")
    assert load_llm_endpoints(config)["deepseek"].api_key == "sk-new"


@pytest.mark.parametrize("endpoint,url_env,key_env,model", [
    ("gpt", "XIAOYI_URL", "XIAOYI_API_KEY", "gpt-6-luna"),
    ("deepseek", "DEEPSEEK_URL", "DEEPSEEK_API_KEY", "deepseek-flash"),
])
def test_invalid_url_isolated_and_never_uses_legacy_fallback(tmp_path, monkeypatch, caplog, endpoint, url_env, key_env, model):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DEEPSEEK_URL", "https://ds.test/v1")
    monkeypatch.setenv("XIAOYI_URL", "https://gpt.test/v1")
    monkeypatch.setenv(url_env, "invalid-address-with-secret")
    monkeypatch.setenv(key_env, "sk-secret")
    config = LLMConfig()
    config.resolved_endpoints = load_llm_endpoints(config)
    assert config.resolved_endpoints[endpoint] is None
    other = "deepseek" if endpoint == "gpt" else "gpt"
    assert config.resolved_endpoints[other] is not None
    with pytest.raises(ValueError, match="未配置模型接口"):
        client_config(config, model)
    assert "invalid-address-with-secret" not in caplog.text and "sk-secret" not in caplog.text
