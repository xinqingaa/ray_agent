from app.domain.models.app_config import LLMConfig
from app.domain.models.model_catalog import (
    auxiliary_call,
    missing_reasoning,
    model_list,
    model_request,
    provider_for,
    resolve_selection,
    tuned_limits,
)


def test_deepseek_catalog_uses_request_ids_and_vendor_efforts():
    assert provider_for("https://api.deepseek.com") == "deepseek"
    assert provider_for("https://api.openai.com/v1") is None
    models = model_list("deepseek")
    assert [item.id for item in models] == ["deepseek-flash", "deepseek-v4-pro"]
    flash, pro = models
    assert flash.auxiliary and not pro.auxiliary
    assert [choice.id for choice in flash.choices] == ["disabled", "low", "high", "max"]
    spec, choice = resolve_selection("deepseek", None, None)
    assert (spec.id, choice.id, choice.replay) == ("deepseek-flash", "high", "all_turns")
    window, tokens = tuned_limits(8192, spec, choice)
    assert (window, tokens) == (1_000_000, 32_768)
    off = spec.choice("disabled")
    assert tuned_limits(8192, spec, off)[1] == 8192


def test_unknown_choice_is_rejected_and_old_history_blocks_thinking():
    try:
        resolve_selection("deepseek", "deepseek-chat", "high")
    except ValueError as exc:
        assert "deepseek-chat" in str(exc)
    else:
        raise AssertionError("retired id should be rejected")
    assert missing_reasoning([{"role": "assistant", "content": "答"}])
    assert not missing_reasoning([{"role": "assistant", "content": "答", "reasoning_content": "想"}])


def test_new_run_uses_selection_and_resume_keeps_snapshot():
    config = LLMConfig(base_url="https://api.deepseek.com", model_name="deepseek-reasoner", max_tokens=8192, context_window=65536)
    fresh = model_request(config, model_id="deepseek-v4-pro", reasoning="low")
    assert fresh is not None
    assert (fresh.model_name, fresh.reasoning_effort, fresh.thinking, fresh.keep_reasoning) == (
        "deepseek-v4-pro", "low", "enabled", True)
    assert fresh.context_window == 1_000_000
    resumed = model_request(config, model_id="deepseek-v4-pro", reasoning="max", snapshot={
        "model_name": "deepseek-flash", "context_window": 65536, "max_tokens": 8192,
    })
    assert resumed is not None
    assert (resumed.model_name, resumed.thinking, resumed.keep_reasoning) == ("deepseek-flash", None, False)
    other = model_request(
        LLMConfig(base_url="https://example.test/v1", model_name="custom"),
        model_id=None, reasoning=None,
    )
    assert other is None


def test_auxiliary_call_uses_flash_without_thinking():
    config = LLMConfig(base_url="https://api.deepseek.com", model_name="deepseek-v4-pro")
    short, thinking, effort = auxiliary_call(config, max_tokens=256, temperature=0.2, timeout=20)
    assert (short.model_name, thinking, effort, short.max_tokens, short.streaming) == (
        "deepseek-flash", "disabled", None, 256, False)
