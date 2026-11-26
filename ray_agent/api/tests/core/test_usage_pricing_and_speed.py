"""双币种计费（DeepSeek 人民币 CNY、OpenAI 美元 USD）、中转连接计价、新模型目录与流式解码耗时测试。"""
import asyncio
from datetime import datetime, timedelta, timezone
import json

import httpx
from openai import AsyncOpenAI
import pytest

from app.application.services.usage_service import UsageService
from app.domain.external.llm import LLMRequestError
from app.domain.models.app_config import LLMConfig
from app.domain.models.llm import LLMUsage
from app.domain.models.model_catalog import find_model, model_list, model_request
from app.domain.models.session import Session
from app.domain.services.usage_pricing import builtin_token_rates, deepseek_asr_charge, token_charge
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.llm.responses import response_result
from app.infrastructure.external.llm.usage import parse_completion_usage, parse_response_usage
from app.infrastructure.models.usage import UsageModel
from app.infrastructure.storage.sqlite import get_database, set_database
from tests.support.model_connections import connect
from tests.support.sqlite_db import with_database
from sqlalchemy import select


def test_gpt_62_models_and_272k_window():
    models = {spec.id: spec for spec in model_list("openai")}
    assert "gpt-6.2-sol" in models and "gpt-6.2-astra" in models
    for model_id in ("gpt-6.2-sol", "gpt-6.2-astra"):
        spec = models[model_id]
        assert spec.context_window == 272_000
        assert spec.max_output == 128_000
        assert [c.id for c in spec.choices] == ["low", "medium", "high", "xhigh", "max"]
        assert spec.choice("none") is None
        assert spec.default_choice == "medium"

    sol_rates = builtin_token_rates("openai", "gpt-6.2-sol")
    astra_rates = builtin_token_rates("openai", "gpt-6.2-astra")
    assert sol_rates is not None and (sol_rates.currency, str(sol_rates.input), str(sol_rates.cached_input), str(sol_rates.output)) == (
        "USD", "2.00", "0.10", "10.00"
    )
    assert astra_rates is not None and (astra_rates.currency, str(astra_rates.input), str(astra_rates.cached_input), str(astra_rates.output)) == (
        "USD", "8.00", "0.40", "40.00"
    )


def test_deepseek_cny_and_openai_usd_official_charges():
    peak_time = datetime(2026, 11, 20, 2, 0, tzinfo=timezone.utc)  # Friday 02:00 UTC -> peak
    off_peak_time = datetime(2026, 11, 21, 2, 0, tzinfo=timezone.utc)  # Saturday -> off_peak

    usage = LLMUsage(prompt_tokens=1_000_000, cached_tokens=400_000, completion_tokens=100_000)
    # deepseek-flash peak: (600k * 2.00 + 400k * 0.04 + 100k * 8.00) / 1M = 2.016 CNY
    peak_charge = token_charge("deepseek", "deepseek-flash", peak_time, usage)
    assert peak_charge.cost_nano_usd is None
    assert peak_charge.cost_nano_cny == 2_016_000_000
    assert peak_charge.price_period == "peak"

    off_charge = token_charge("deepseek", "deepseek-flash", off_peak_time, usage)
    assert off_charge.cost_nano_usd is None
    assert off_charge.cost_nano_cny == 1_008_000_000
    assert off_charge.price_period == "off_peak"

    # deepseek-asr: ¥0.78 / h，2 seconds -> 0.78 * 2 / 3600 = 0.000433333 CNY -> 433333 nanos
    asr = deepseek_asr_charge(1001)
    assert asr.cost_nano_usd is None and asr.cost_nano_cny == 433_333

    # OpenAI snapshot & cache write & >272K & priority tier
    # input=300k: cached=100k, write_30m=50k, write_12h=50k, uncached=100k; output=10k
    # >272k long_context -> in_factor=2, out_factor=1.5
    # gpt-6.2-sol: (100k*2 + 100k*0.1 + 50k*2.5 + 50k*5.0) * 2 / 1M = (200k + 10k + 125k + 250k) * 2 / 1M = 1.17 USD
    # output: 10k * 10 * 1.5 / 1M = 0.15 USD -> total 1.32 USD; priority *2 = 2.64 USD
    gpt_usage = LLMUsage(
        prompt_tokens=300_000, cached_tokens=100_000,
        cache_write_tokens=100_000, cache_write_30m_tokens=50_000, cache_write_12h_tokens=50_000,
        completion_tokens=10_000,
    )
    charge = token_charge("compatible", "openai/gpt-6.2-sol-2026-10-01", peak_time, gpt_usage, service_tier="priority")
    assert charge.cost_nano_cny is None
    assert charge.cost_nano_usd == 2_640_000_000
    assert charge.price_period == "long_context"


def test_parse_usage_aliases_and_cache_write():
    resp_usage = parse_response_usage({
        "input_tokens": 500,
        "output_tokens": 80,
        "total_tokens": 580,
        "input_tokens_details": {
            "cached_tokens": 200,
            "cache_write_tokens": 100,
            "cache_write_details": {"ttl_30m_tokens": 60, "ttl_12h_tokens": 40},
        },
        "output_tokens_details": {"reasoning_tokens": 30},
    })
    assert resp_usage is not None
    assert (resp_usage.prompt_tokens, resp_usage.cached_tokens, resp_usage.cache_write_tokens) == (500, 200, 100)
    assert (resp_usage.cache_write_30m_tokens, resp_usage.cache_write_12h_tokens, resp_usage.reasoning_tokens) == (60, 40, 30)

    # 代理返回了 chat 风格字段到 Responses 端点也能兜底解析
    fallback = parse_response_usage({
        "prompt_tokens": 400,
        "completion_tokens": 50,
        "prompt_cache_hit_tokens": 300,
        "cache_creation_input_tokens": 50,
    })
    assert fallback is not None
    assert (fallback.prompt_tokens, fallback.cached_tokens, fallback.cache_write_tokens, fallback.completion_tokens) == (
        400, 300, 50, 50
    )

    chat_usage = parse_completion_usage({
        "prompt_tokens": 200,
        "completion_tokens": 40,
        "prompt_cache_hit_tokens": 120,
        "completion_tokens_details": {"reasoning_tokens": 15},
    })
    assert chat_usage is not None and chat_usage.cached_tokens == 120 and chat_usage.reasoning_tokens == 15


def test_relay_openai_model_bills_usd_and_preserves_usage_on_incomplete(tmp_path, isolated_model_connections, monkeypatch):
    config = connect(LLMConfig(), isolated_model_connections, '''
[providers.relay]
base_url = "https://relay.example.test/v1"
api_key = "sk-relay-test"
protocol = "responses"
models = ["gpt-6.2-sol"]
''')
    # 虽然域名不是 api.openai.com（kind == compatible），目录模型仍应走 openai 官方美金计费
    bound = config.model_copy(update={
        "model_name": "gpt-6.2-sol",
        "selected_endpoint": config.resolved_endpoints["relay"],
    })
    assert bound.selected_endpoint.kind == "compatible"

    replies = [
        {
            "id": "resp-ok",
            "status": "completed",
            "output": [{"type": "message", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": "ok", "annotations": []}]}],
            "usage": {"input_tokens": 200_000, "output_tokens": 50_000,
                      "input_tokens_details": {"cached_tokens": 100_000}},
        },
        {
            "id": "resp-inc",
            "status": "incomplete",
            "incomplete_details": {"reason": "content_filter"},
            "output": [],
            "usage": {"input_tokens": 100_000, "output_tokens": 10_000},
        },
    ]

    def handler(request):
        return httpx.Response(200, json=replies.pop(0))

    async def scenario(write, read, database):
        set_database(database)
        llm = OpenAILLM(bound.model_copy(update={"streaming": False}))
        llm._client = AsyncOpenAI(
            api_key="sk-relay-test", base_url="https://relay.example.test/v1", max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        ok_res = await llm.invoke([{"role": "user", "content": "hi"}])
        # (100k * 2.00 + 100k * 0.10 + 50k * 10.00) / 1M = 0.71 USD
        assert ok_res.charge is not None and ok_res.charge.cost_nano_usd == 710_000_000
        assert ok_res.charge.price_period == "standard"
        assert llm._billing_vendor == "openai" and llm._billing_provider == "relay"

        with pytest.raises(LLMRequestError) as caught:
            await llm.invoke([{"role": "user", "content": "hi2"}])
        assert caught.value.usage is not None and caught.value.usage.prompt_tokens == 100_000
        await llm._client.close()

        async with read() as uow:
            rows = (await uow.db_session.scalars(select(UsageModel).order_by(UsageModel.id))).all()
        assert len(rows) == 2
        assert rows[0].failed is False and rows[0].cost_nano_usd == 710_000_000
        # 失败的 incomplete 请求依然保留已返回的 token 与估算费用，不再漏记
        assert rows[1].failed is True and rows[1].input_tokens == 100_000 and rows[1].cost_nano_usd == 300_000_000

    previous = None
    try:
        previous = get_database()
    except RuntimeError:
        pass
    try:
        with_database(tmp_path / "db", scenario)
    finally:
        set_database(previous)


def test_streaming_decode_ms_excludes_tail_drain_and_respects_unsplit_reasoning():
    class ControlledTail:
        def __init__(self, loop, step_delay=0.05, tail_delay=0.35):
            self.loop = loop
            self.step_delay = step_delay
            self.tail_delay = tail_delay
            self.step = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            self.step += 1
            if self.step == 1:
                return {"type": "response.reasoning_text.delta", "delta": "think"}
            if self.step == 2:
                await asyncio.sleep(self.step_delay)
                return {"type": "response.output_text.delta", "delta": "hello"}
            if self.step == 3:
                await asyncio.sleep(self.step_delay)
                return {
                    "type": "response.completed",
                    "response": {
                        "id": "r1",
                        "status": "completed",
                        "output": [{"type": "message", "role": "assistant", "status": "completed",
                                    "content": [{"type": "output_text", "text": "hello", "annotations": []}]}],
                        # 上游未拆 reasoning_tokens 时，decode_ms 应从首个推理增量起算，且不含 350ms 尾部排空
                        "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
                    },
                }
            if self.step == 4:
                await asyncio.sleep(self.tail_delay)
                raise StopAsyncIteration
            raise StopAsyncIteration

        async def close(self):
            pass

    async def case():
        loop = asyncio.get_running_loop()
        llm = OpenAILLM(LLMConfig(api_key="fixture", model_name="gpt-6.2-sol"), reasoning_effort="medium")
        tail = ControlledTail(loop)

        async def create(**kwargs):
            return tail

        from types import SimpleNamespace
        llm._client = SimpleNamespace(responses=SimpleNamespace(create=create))
        result = await llm.invoke([{"role": "user", "content": "hi"}])
        assert result.decode_ms is not None
        assert 80 <= result.decode_ms < 250  # 包含两次 50ms 生成间隔 (~100ms)，但不包含 350ms 尾部排空

    asyncio.run(case())


def test_response_result_still_raises_with_usage_on_failed_status():
    raw = {
        "id": "r-fail",
        "status": "failed",
        "error": {"code": "server_error", "message": "boom"},
        "usage": {"input_tokens": 50, "output_tokens": 12, "total_tokens": 62},
    }
    with pytest.raises(LLMRequestError) as caught:
        response_result(raw, "gpt-6.2-sol", "openai")
    assert caught.value.retryable is True
    assert caught.value.usage is not None and caught.value.usage.prompt_tokens == 50
    assert find_model("gpt-6.2-sol").context_window == 272_000
    assert model_request(LLMConfig(base_url="https://api.deepseek.com"), model_id="deepseek-flash", reasoning="high") is not None


def test_usage_service_aggregates_both_currencies_without_false_unpriced(tmp_path):
    async def scenario(write, read, _database):
        session = Session()
        now = datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc)
        async with write() as uow:
            await uow.session.save(session)
            await uow.usage.add(
                started_at=now, session_id=session.id, run_id=None, workspace_id=None,
                purpose="main", provider="deepseek", model="deepseek-flash", failed=False,
                input_tokens=100, output_tokens=50, total_tokens=150, cost_nano_cny=123_456,
            )
            await uow.usage.add(
                started_at=now, session_id=session.id, run_id=None, workspace_id=None,
                purpose="main", provider="gpt", model="gpt-6.2-sol", failed=False,
                input_tokens=200, output_tokens=80, total_tokens=280, cost_nano_usd=654_321,
            )
        service = UsageService(write, read)
        totals = await service.session(session.id)
        assert totals.requests == 2 and totals.unpriced_requests == 0
        assert totals.cost_nano_cny == 123_456 and totals.cost_nano_usd == 654_321
        report = await service.report("24h", None, None, None, now=now + timedelta(minutes=1), zone=timezone.utc)
        assert report.totals.unpriced_requests == 0
        assert report.totals.cost_nano_cny == 123_456 and report.totals.cost_nano_usd == 654_321

    with_database(tmp_path / "db", scenario)
