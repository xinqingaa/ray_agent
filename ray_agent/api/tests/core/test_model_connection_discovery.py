"""模型提供商打通：保存时归类、上游能力解析与来源、同一模型的唯一归属、字段隔离、自定义思考档位与工具检测。
全部上游请求经 MockTransport 拦截，不产生网络请求；测试用密钥均为假值。"""
import asyncio
import json
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError

from app.application.errors.exceptions import AppException, BadRequestError
from app.application.services import model_connection_service as service_module
from app.application.services.model_connection_service import ModelConnectionService, TOOL_CHECK_NAME
from app.domain.models.app_config import LLMConfig
from app.domain.models.error import ErrorCode
from app.domain.models.llm_endpoints import CustomModel, ProbedModel, ProviderDefinition
from app.domain.models.model_catalog import catalog_models, client_config, find_model, model_request
from app.domain.services.model_discovery import probe_model
from app.domain.services.usage_pricing import PRICE_VERSION
from app.infrastructure.external.llm import openai_llm
from app.infrastructure.external.llm.model_connections import load_model_connections
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.llm.upstream_models import parse_model_list
from tests.support.model_connections import connect, write_connections

FAKE_KEY = "sk-fake-discovery-0001"
ALL_CAPABILITIES = {"context_window", "max_output", "tools", "vision", "thinking", "reasoning_efforts", "rates"}


@pytest.fixture
def upstream(monkeypatch):
    """所有 httpx 客户端改走 MockTransport；routes["handler"] 可以是同步或异步函数。"""
    routes: dict = {"handler": None, "requests": []}

    def dispatch(request):
        routes["requests"].append(request)
        return routes["handler"](request)

    original_init = httpx.AsyncClient.__init__

    def routed_init(self, *args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(dispatch))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", routed_init)
    return routes


def chat_reply(request):
    return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
                                    "usage": {"prompt_tokens": 1, "completion_tokens": 1}})


def _version() -> str:
    return load_model_connections().source.version


def _provider(name, providers):
    return next(item for item in providers if item.name == name)


# ---------- 保存时归类 ----------

def test_save_classifies_catalog_and_custom_models(isolated_model_connections):
    definition = ProviderDefinition(
        base_url="https://mix.test/v1", protocol="chat_completions",
        models=["deepseek-flash", "acme-plain"],
        custom_models={"acme-tuned": CustomModel(context_window=128000, max_output=8000, tools=True, vision=True,
                                                  reasoning_efforts=["low", "high"])},
    )
    source = ModelConnectionService().write("mix", _version(), definition, FAKE_KEY)

    assert _provider("mix", source.providers).models == ["deepseek-flash", "acme-plain", "acme-tuned"]
    stored = load_model_connections()
    assert "deepseek-flash" not in stored.custom_models
    plain = stored.custom_models["acme-plain"]
    assert (plain.context_window, plain.max_output, plain.tools, plain.thinking) == (32000, 4096, True, False)
    assert plain.unconfirmed == ["context_window", "max_output", "tools", "vision", "thinking"]
    tuned = stored.custom_models["acme-tuned"]
    assert tuned.reasoning_efforts == ["low", "high"] and tuned.thinking is True and tuned.unconfirmed == []
    assert stored.model_endpoints == {"deepseek-flash": "mix", "acme-plain": "mix", "acme-tuned": "mix"}


def test_catalog_id_declared_as_custom_is_ignored_in_favour_of_catalog(isolated_model_connections):
    definition = ProviderDefinition(
        base_url="https://mix.test/v1", models=["gpt-6-luna"],
        custom_models={"gpt-6-luna": CustomModel(context_window=2000, max_output=100)},
    )
    ModelConnectionService().write("mix", _version(), definition, FAKE_KEY)
    stored = load_model_connections()
    assert "gpt-6-luna" not in stored.custom_models
    assert find_model("gpt-6-luna").custom is False


def test_save_rejects_when_no_model_is_selected(isolated_model_connections):
    with pytest.raises(BadRequestError, match="请至少选择或声明一个模型"):
        ModelConnectionService().write("empty", _version(), ProviderDefinition(base_url="https://e.test/v1"), FAKE_KEY)


# ---------- 同一模型只能属于一个提供商 ----------

def test_same_model_under_two_providers_is_rejected_on_save(isolated_model_connections):
    service = ModelConnectionService()
    service.write("first", _version(), ProviderDefinition(base_url="https://a.test/v1", models=["gpt-6-luna"]), FAKE_KEY)

    with pytest.raises(BadRequestError) as caught:
        service.write("second", _version(), ProviderDefinition(base_url="https://b.test/v1", models=["gpt-6-luna"]),
                      "sk-fake-second-0002")

    assert "gpt-6-luna 已由 first 提供" in str(caught.value)
    assert caught.value.info.details == {"models": {"gpt-6-luna": "已由 first 提供"}}
    assert "sk-fake-second-0002" not in str(caught.value)
    assert "second" not in [item.name for item in load_model_connections().source.providers]


def test_resaving_the_same_owner_keeps_its_models(isolated_model_connections):
    service = ModelConnectionService()
    service.write("first", _version(), ProviderDefinition(base_url="https://a.test/v1", models=["gpt-6-luna"]), FAKE_KEY)
    source = service.write("first", _version(), ProviderDefinition(base_url="https://a.test/v2", models=["gpt-6-luna"]), FAKE_KEY)
    assert _provider("first", source.providers).models == ["gpt-6-luna"]


def test_hand_edited_duplicate_is_ignored_on_read_with_reason(isolated_model_connections):
    write_connections(isolated_model_connections, '''
[providers.first]
base_url = "https://a.test/v1"
api_key = "sk-fake-first-0001"
models = ["gpt-6-luna"]

[providers.second]
base_url = "https://b.test/v1"
api_key = "sk-fake-second-0002"
models = ["gpt-6-luna", "gpt-6-astra"]
''')
    loaded = load_model_connections()
    second = _provider("second", loaded.source.providers)
    assert second.models == ["gpt-6-astra"]
    assert "gpt-6-luna 已由 first 提供" in second.issue
    assert loaded.model_endpoints["gpt-6-luna"] == "first"


# ---------- 上游模型能力解析与来源 ----------

RICH = {
    "id": "vendor/rich", "context_length": 128000, "top_provider": {"max_completion_tokens": 8192},
    "supported_parameters": ["tools", "reasoning", "temperature"],
    "architecture": {"input_modalities": ["text", "image"]},
    "supported_reasoning_efforts": ["low", "high", "enabled", "bad effort!"],
    "pricing": {"prompt": "0.000001", "completion": "0.000004", "input_cache_read": "0.0000002"},
}


def test_rich_upstream_metadata_is_parsed_with_upstream_sources():
    [report] = parse_model_list({"data": [RICH]}, secret=FAKE_KEY)
    probed = probe_model(report)

    assert probed.catalog is False
    assert (probed.context_window, probed.max_output) == (128000, 8192)
    assert (probed.tools, probed.vision, probed.thinking) == (True, True, True)
    assert probed.reasoning_efforts == ["low", "high"]
    assert probed.rates.input == Decimal("1") and probed.rates.cached_input == Decimal("0.2") and probed.rates.output == Decimal("4")
    assert probed.sources == {key: "upstream" for key in ALL_CAPABILITIES}


def test_id_only_upstream_entry_falls_back_to_unconfirmed_defaults():
    [report] = parse_model_list({"data": [{"id": "vendor/bare"}]}, secret=FAKE_KEY)
    probed = probe_model(report)

    assert (probed.context_window, probed.max_output) == (32000, 4096)
    assert (probed.tools, probed.vision, probed.thinking) == (True, False, False)
    assert probed.reasoning_efforts == [] and probed.rates is None
    assert probed.sources == {key: "unconfirmed" for key in ALL_CAPABILITIES}


def test_negative_pricing_is_treated_as_not_reported():
    [report] = parse_model_list({"data": [{"id": "vendor/dynamic", "pricing": {"prompt": "-1", "completion": "-1"}}]},
                                secret=FAKE_KEY)
    probed = probe_model(report)
    assert probed.rates is None and probed.sources["rates"] == "unconfirmed"


def test_invalid_upstream_field_is_isolated_to_its_own_capability():
    reports = parse_model_list({"data": [
        {"id": "vendor/partial", "context_length": "lots", "supported_parameters": ["tools"]},
        {"id": "vendor/next", "context_length": 64000},
    ]}, secret=FAKE_KEY)
    by_id = {item.id: probe_model(item) for item in reports}
    partial, nxt = by_id["vendor/partial"], by_id["vendor/next"]

    assert partial.context_window == 32000 and partial.sources["context_window"] == "unconfirmed"
    assert partial.tools is True and partial.sources["tools"] == "upstream"
    assert partial.vision is False and partial.sources["vision"] == "unconfirmed"
    assert nxt.context_window == 64000 and nxt.sources["context_window"] == "upstream"


def test_output_limit_close_to_window_is_not_trusted():
    [report] = parse_model_list({"data": [{"id": "vendor/tight", "context_length": 4000, "max_output_tokens": 3900}]},
                                secret=FAKE_KEY)
    probed = probe_model(report)
    assert probed.max_output == 2000 and probed.sources["max_output"] == "unconfirmed"


def test_catalog_model_always_uses_catalog_values():
    [report] = parse_model_list({"data": [{"id": "deepseek-flash", "context_length": 999}]}, secret=FAKE_KEY)
    probed = probe_model(report)
    spec = find_model("deepseek-flash")
    assert probed.catalog is True and probed.context_window == spec.context_window
    assert probed.sources["context_window"] == "catalog"


def test_entries_containing_the_secret_or_without_id_are_skipped_and_list_is_sorted():
    reports = parse_model_list({"data": [
        {"id": "zeta"}, {"id": f"leak-{FAKE_KEY}"}, {"name": "no-id"}, {"id": "alpha"}, {"id": "alpha"},
    ]}, secret=FAKE_KEY)
    assert [item.id for item in reports] == ["alpha", "zeta"]


def test_payload_without_data_list_is_rejected():
    with pytest.raises(ValueError):
        parse_model_list({"models": []}, secret=FAKE_KEY)


def test_probe_lists_models_with_claims_and_details(isolated_model_connections, upstream):
    service = ModelConnectionService()
    service.write("first", _version(), ProviderDefinition(
        base_url="https://a.test/v1", custom_models={"vendor/shared": CustomModel(context_window=16000, max_output=2000)}),
        FAKE_KEY)
    upstream["handler"] = lambda request: httpx.Response(200, json={"data": [RICH, {"id": "vendor/shared"}]})

    definition = ProviderDefinition(base_url="https://second.test/v1")
    result = asyncio.run(service.probe(definition, name="second", key=FAKE_KEY, model=None))
    assert result["method"] == "models" and result["models"] == ["vendor/rich", "vendor/shared"]
    details = {item.id: item for item in result["model_details"]}
    assert isinstance(details["vendor/rich"], ProbedModel) and details["vendor/rich"].claimed_by is None
    assert details["vendor/shared"].claimed_by == "first"

    own = asyncio.run(service.probe(definition, name="first", key=FAKE_KEY, model=None))
    assert {item.id: item for item in own["model_details"]}["vendor/shared"].claimed_by is None


def test_probe_reports_upstream_failures_without_echoing_key(isolated_model_connections, upstream):
    upstream["handler"] = lambda request: httpx.Response(401, json={"error": {"message": f"bad key {FAKE_KEY}"}})
    with pytest.raises(AppException) as caught:
        asyncio.run(ModelConnectionService().probe(ProviderDefinition(base_url="https://a.test/v1"), name=None,
                                                    key=FAKE_KEY, model=None))
    assert caught.value.info.code == ErrorCode.UPSTREAM_ERROR
    assert caught.value.info.details["upstream_status"] == 401
    assert FAKE_KEY not in caught.value.info.message


def test_probe_rejects_malformed_model_list(isolated_model_connections, upstream):
    upstream["handler"] = lambda request: httpx.Response(200, json={"items": []})
    with pytest.raises(AppException, match="上游返回的模型列表格式无效"):
        asyncio.run(ModelConnectionService().probe(ProviderDefinition(base_url="https://a.test/v1"), name=None,
                                                    key=FAKE_KEY, model=None))


# ---------- 字段隔离与地址保留 ----------

def test_single_invalid_custom_model_does_not_invalidate_provider(isolated_model_connections):
    connect(LLMConfig(), isolated_model_connections, '''
[providers.good]
base_url = "https://good.test/v1"
api_key = "sk-fake-good-0001"

[providers.good.custom_models.acme-ok]
context_window = 100000
max_output = 2000

[providers.good.custom_models.acme-bad]
context_window = 100000
max_output = 2000
reasoning_efforts = ["enabled"]
''')
    loaded = load_model_connections()
    status = _provider("good", loaded.source.providers)

    assert loaded.endpoints["good"] is not None and loaded.endpoints["good"].base_url.host == "good.test"
    assert status.models == ["acme-ok"] and status.base_url == "https://good.test/v1"
    assert status.issue == "已忽略：acme-bad 无效（思考档位不能使用 enabled 或 disabled）"
    assert loaded.model_endpoints == {"acme-ok": "good"}
    assert "sk-fake-good-0001" not in status.issue


def test_invalid_provider_field_keeps_parseable_base_url_and_no_fallback(isolated_model_connections):
    write_connections(isolated_model_connections, '''
[providers.keep]
base_url = "https://keep.test/v1"
api_key = "sk-fake-keep-0001"
protocol = "bogus"
models = ["gpt-6-luna"]
''')
    loaded = load_model_connections()
    status = _provider("keep", loaded.source.providers)
    assert loaded.endpoints["keep"] is None and loaded.model_endpoints == {}
    assert status.base_url == "https://keep.test/v1"
    assert "protocol 无效" in status.issue


def test_credentials_in_base_url_are_never_echoed(isolated_model_connections):
    write_connections(isolated_model_connections, '''
[providers.leaky]
base_url = "https://user:sk-fake-leak-0001@leak.test/v1"
api_key = "sk-fake-leak-0002"
models = ["gpt-6-luna"]
''')
    status = _provider("leaky", load_model_connections().source.providers)
    assert status.base_url is None
    assert "sk-fake-leak" not in status.model_dump_json()


def test_old_custom_model_without_new_keys_keeps_legacy_defaults(isolated_model_connections):
    write_connections(isolated_model_connections, '''
[providers.legacy]
base_url = "https://legacy.test/v1"
api_key = "sk-fake-legacy-0001"

[providers.legacy.custom_models.legacy-model]
context_window = 16000
max_output = 2000
''')
    model = load_model_connections().custom_models["legacy-model"]
    assert (model.tools, model.thinking, model.reasoning_efforts, model.unconfirmed) == (False, False, [], [])

    service = ModelConnectionService()
    service.write("legacy", _version(), ProviderDefinition(
        base_url="https://legacy.test/v1", custom_models={"legacy-model": model}), "sk-fake-legacy-0001")
    text = isolated_model_connections.read_text(encoding="utf-8")
    assert "reasoning_efforts" not in text and "unconfirmed" not in text


# ---------- 自定义模型的思考档位 ----------

@pytest.mark.parametrize("efforts", [["enabled"], ["low", "low"], ["disabled"], [f"e{i}" for i in range(9)]])
def test_custom_efforts_reject_reserved_duplicate_and_excess(efforts):
    with pytest.raises(ValidationError):
        CustomModel(context_window=16000, max_output=2000, reasoning_efforts=efforts)


def test_custom_efforts_become_selectable_choices_and_reach_the_request(isolated_model_connections):
    config = connect(LLMConfig(), isolated_model_connections, '''
[providers.think]
base_url = "https://think.test/v1"
api_key = "sk-fake-think-0001"
protocol = "chat_completions"

[providers.think.custom_models.acme-think]
context_window = 64000
max_output = 4000
reasoning_efforts = ["low", "high"]
''')
    spec = find_model("acme-think", config)
    assert [choice.id for choice in spec.choices] == ["disabled", "low", "high"]
    assert spec.default_choice == "disabled"

    restored = model_request(config, model_id="acme-think", reasoning="high")
    assert (restored.thinking, restored.reasoning_effort) == ("enabled", "high")
    llm = OpenAILLM(client_config(config, "acme-think"), thinking=restored.thinking, reasoning_effort=restored.reasoning_effort)
    kwargs = llm._request_kwargs([{"role": "user", "content": "hi"}], None, None, None, stream=False)
    assert kwargs["reasoning_effort"] == "high"

    off = model_request(config, model_id="acme-think", reasoning="disabled")
    llm = OpenAILLM(client_config(config, "acme-think"), thinking=off.thinking, reasoning_effort=off.reasoning_effort)
    assert "reasoning_effort" not in llm._request_kwargs([{"role": "user", "content": "hi"}], None, None, None, stream=False)


# ---------- 工具能力检测 ----------

TOOL_DEFINITION = ProviderDefinition(
    base_url="https://tool.test/v1", protocol="chat_completions",
    custom_models={"acme-tool": CustomModel(context_window=16000, max_output=2000)},
)


def test_tool_check_accepted_sends_the_probe_tool(isolated_model_connections, upstream):
    def handler(request):
        body = json.loads(request.content)
        assert body["tools"][0]["function"]["name"] == TOOL_CHECK_NAME
        return chat_reply(request)

    upstream["handler"] = handler
    result = asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    assert result["supported"] is True and result["upstream_status"] == 200
    assert len(upstream["requests"]) == 1


def test_tool_check_client_rejection_means_unsupported(isolated_model_connections, upstream):
    upstream["handler"] = lambda request: httpx.Response(400, json={"error": {"message": "tools are not supported"}})
    result = asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    assert result["supported"] is False and result["upstream_status"] == 400
    assert "tools are not supported" in result["reason"] and result["suggestion"]


@pytest.mark.parametrize("status", [422])
def test_tool_check_rejected_body_status_means_unsupported(isolated_model_connections, upstream, status):
    upstream["handler"] = lambda request: httpx.Response(status, json={"error": {"message": "unknown field tools"}})
    result = asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    assert result["supported"] is False and result["upstream_status"] == status


@pytest.mark.parametrize("status, expected", [
    (401, "API Key"), (403, "API Key"), (404, "模型 ID 与地址"), (418, "无法判断工具能力"),
])
def test_tool_check_auth_missing_or_other_client_errors_are_non_retryable_failures(
        isolated_model_connections, upstream, status, expected):
    """这些状态不说明请求体是否被接受，不能下「不支持工具」的结论。"""
    upstream["handler"] = lambda request: httpx.Response(status, json={"error": {"message": "denied"}})
    with pytest.raises(AppException) as caught:
        asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    info = caught.value.info
    assert info.code == ErrorCode.UPSTREAM_ERROR and info.retryable is False
    assert info.details["upstream_status"] == status and expected in info.message
    assert FAKE_KEY not in info.message


@pytest.mark.parametrize("status", [429, 500, 503])
def test_tool_check_throttling_or_server_error_is_a_failure_not_a_verdict(isolated_model_connections, upstream, status):
    upstream["handler"] = lambda request: httpx.Response(status, json={"error": {"message": "busy"}})
    with pytest.raises(AppException) as caught:
        asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    assert caught.value.info.code == ErrorCode.UPSTREAM_ERROR and caught.value.info.retryable is True


def test_tool_check_undeclared_catalog_outside_model_uses_conservative_declaration(isolated_model_connections, upstream):
    """未保存、也不在 custom_models 中的目录外模型：按保守默认声明发起检测，不因找不到模型而报错。"""
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return chat_reply(request)

    upstream["handler"] = handler
    definition = ProviderDefinition(base_url="https://tool.test/v1", protocol="chat_completions")
    result = asyncio.run(ModelConnectionService().tool_check(definition, name=None, key=FAKE_KEY, model="acme-fresh"))
    assert result["supported"] is True
    assert seen["body"]["model"] == "acme-fresh" and seen["body"]["tools"][0]["function"]["name"] == TOOL_CHECK_NAME


def test_tool_check_timeout_is_bounded(isolated_model_connections, upstream, monkeypatch):
    monkeypatch.setattr(service_module, "TOOL_CHECK_TIMEOUT_SECONDS", 0.05)

    async def stalled(request):
        await asyncio.sleep(5)
        return chat_reply(request)

    upstream["handler"] = stalled
    with pytest.raises(AppException) as caught:
        asyncio.run(ModelConnectionService().tool_check(TOOL_DEFINITION, name=None, key=FAKE_KEY, model="acme-tool"))
    assert caught.value.info.code == ErrorCode.TIMEOUT


# ---------- 内置目录 ----------

def test_catalog_exposes_capabilities_and_pricing_without_endpoints():
    payload = ModelConnectionService.catalog()
    assert payload["price_version"] == PRICE_VERSION
    ids = [item["id"] for item in payload["models"]]
    assert ids == [spec.id for spec in catalog_models()]
    for item in payload["models"]:
        assert item["source"] == "catalog" and item["unconfirmed"] == []
        assert "tools" in item and "context_window" in item and "choices" in item
        assert item["has_builtin_pricing"] == (item["rates"] is not None)
        assert "base_url" not in item and "api_key" not in item
    assert next(item for item in payload["models"] if item["id"] == "deepseek-flash")["has_builtin_pricing"] is True


# ---------- HTTP 接口 ----------

def test_catalog_and_tool_check_routes(client, isolated_model_connections, upstream):
    catalog = client.get("/api/app-config/llm/catalog")
    assert catalog.status_code == 200
    assert [item["id"] for item in catalog.json()["data"]["models"]] == [spec.id for spec in catalog_models()]

    missing = client.post("/api/app-config/llm/providers/tool-check", json={
        "base_url": "https://tool.test/v1", "protocol": "chat_completions", "api_key": FAKE_KEY})
    assert missing.status_code == 400 and "请选择要检测工具的模型" in missing.text

    upstream["handler"] = chat_reply
    checked = client.post("/api/app-config/llm/providers/tool-check", json={
        "base_url": "https://tool.test/v1", "protocol": "chat_completions", "api_key": FAKE_KEY, "model": "acme-tool",
        "custom_models": {"acme-tool": {"context_window": 16000, "max_output": 2000}}})
    assert checked.status_code == 200, checked.text
    assert checked.json()["data"]["supported"] is True and FAKE_KEY not in checked.text


def test_invalid_custom_field_on_save_names_model_and_field(client, isolated_model_connections):
    """保存被 422 拒绝时，错误消息点名模型 ID 与字段，且不回显密钥。"""
    version = client.get("/api/app-config/llm/providers").json()["data"]["version"]
    base = {"base_url": "https://bad.test/v1", "api_key": FAKE_KEY, "protocol": "chat_completions", "version": version}

    field = client.put("/api/app-config/llm/providers/bad-field", json={
        **base, "custom_models": {"acme-bad": {"context_window": 1, "max_output": 100}}})
    assert field.status_code == 422
    assert field.json()["error"]["message"] == "模型 acme-bad 的 context_window 无效：须大于 1"
    assert field.json()["error"]["details"]["models"] == {"acme-bad": "模型 acme-bad 的 context_window 无效：须大于 1"}
    assert FAKE_KEY not in field.text

    rule = client.put("/api/app-config/llm/providers/bad-rule", json={
        **base, "custom_models": {"acme-bad": {"context_window": 16000, "max_output": 100,
                                               "reasoning_efforts": ["enabled"]}}})
    assert rule.status_code == 422
    assert rule.json()["error"]["message"] == "模型 acme-bad 无效：思考档位不能使用 enabled 或 disabled"
    assert rule.json()["error"]["details"]["models"]["acme-bad"] == "模型 acme-bad 无效：思考档位不能使用 enabled 或 disabled"
