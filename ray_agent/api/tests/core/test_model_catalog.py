from app.domain.models.app_config import LLMConfig, ModelSampling
from app.domain.models.model_catalog import (
    auxiliary_call,
    choose_sampling,
    current_sampling,
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
    window, tokens = tuned_limits(8192, 131_072, spec, choice)
    assert (window, tokens) == (131_072, 32_768)
    assert tuned_limits(8192, 2_000_000, spec, choice)[0] == 1_000_000
    off = spec.choice("disabled")
    assert tuned_limits(8192, 131_072, spec, off)[1] == 8192


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
    assert fresh.context_window == 65536
    capped = model_request(config.model_copy(update={"context_window": 2_000_000}), model_id="deepseek-v4-pro", reasoning="low")
    assert capped is not None and capped.context_window == 1_000_000
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


def test_model_profile_overrides_globals_and_session_keeps_its_copy():
    config = LLMConfig(
        base_url="https://api.deepseek.com",
        context_window=131072,
        max_tokens=8192,
        temperature=0.7,
        model_profiles={
            "deepseek-v4-pro": ModelSampling(temperature=0.2, max_tokens=4096, context_window=65536),
        },
    )
    pro = model_request(config, model_id="deepseek-v4-pro", reasoning="disabled")
    flash = model_request(config, model_id="deepseek-flash", reasoning="disabled")
    assert pro is not None and (pro.context_window, pro.max_tokens, pro.temperature) == (65536, 4096, 0.2)
    assert flash is not None and (flash.context_window, flash.max_tokens, flash.temperature) == (131072, 8192, 0.7)
    frozen = current_sampling(config, "deepseek-v4-pro")
    later = config.model_copy(update={"model_profiles": {
        "deepseek-v4-pro": ModelSampling(temperature=0.1, max_tokens=1024, context_window=32768),
    }})
    kept = model_request(later, model_id="deepseek-v4-pro", reasoning="disabled", sampling=frozen)
    assert kept is not None and (kept.context_window, kept.max_tokens, kept.temperature) == (65536, 4096, 0.2)
    wide = current_sampling(config.model_copy(update={"model_profiles": {
        "deepseek-flash": ModelSampling(temperature=0.7, max_tokens=8192, context_window=2_000_000),
    }}), "deepseek-flash")
    assert wide.context_window == 1_000_000


def test_existing_session_ignores_new_settings_until_the_model_changes():
    current = ModelSampling(temperature=0.3, max_tokens=2048, context_window=32768)
    frozen = ModelSampling(temperature=0.7, max_tokens=8192, context_window=131072)
    assert choose_sampling(frozen=frozen, model_changed=False, snapshot=None, current=current) == frozen
    assert choose_sampling(frozen=frozen, model_changed=True, snapshot=None, current=current) == current
    old = choose_sampling(frozen=None, model_changed=False, snapshot={
        "context_window": 1_000_000, "max_tokens": 32768, "temperature": 0.7,
    }, current=current)
    assert (old.context_window, old.max_tokens, old.temperature) == (1_000_000, 32768, 0.7)
    fresh = choose_sampling(frozen=None, model_changed=False, snapshot=None, current=current)
    assert fresh == current


def test_auxiliary_call_uses_flash_without_thinking():
    config = LLMConfig(base_url="https://api.deepseek.com", model_name="deepseek-v4-pro")
    short, thinking, effort = auxiliary_call(config, max_tokens=256, temperature=0.2, timeout=20)
    assert (short.model_name, thinking, effort, short.max_tokens, short.streaming, short.context_window) == (
        "deepseek-flash", "disabled", None, 256, False, 200_000)
    wide = auxiliary_call(
        config.model_copy(update={"context_window": 2_000_000}), max_tokens=256, temperature=0.2, timeout=20)
    assert wide[0].context_window == 1_000_000


def test_snapshot_preserves_request_encoding_separately_from_display_choice():
    config = LLMConfig(base_url="https://api.deepseek.com", model_name="deepseek-flash")
    profile = model_request(config, model_id="deepseek-v4-pro", reasoning="high", snapshot={
        "model_name": "deepseek-flash", "reasoning": "vendor-high",
        "reasoning_effort": "high", "thinking": "enabled", "keep_reasoning": False,
        "context_window": 200000, "max_tokens": 8192,
    })
    assert profile.reasoning_id == "vendor-high"
    assert profile.reasoning_effort == "high"
    assert profile.keep_reasoning is False
