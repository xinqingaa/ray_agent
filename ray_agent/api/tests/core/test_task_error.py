#!/usr/bin/env python
# -*- coding: utf-8 -*-
from app.domain.services.task_error import (
    STEP_PARSE_ERROR,
    QUOTA_ERROR,
    format_public_error,
    format_public_error_text,
)


def test_formats_step_validation_dump():
    raw = (
        "AgentTaskRunner出错: 1 validation error for Step "
        "Input should be a valid dictionary or instance of Step "
        "[type=model_type, input_value=[{'type': 'tool_use'}], input_type=list] "
        "For further information visit https://errors.pydantic.dev/2.11/v/model_type"
    )
    assert format_public_error_text(raw) == STEP_PARSE_ERROR


def test_formats_quota_error():
    assert "额度" in format_public_error_text("Error code: 403 - insufficient_quota")
    assert format_public_error(RuntimeError("insufficient_quota")) == QUOTA_ERROR


def test_keeps_short_error_and_adds_retry_hint():
    text = format_public_error_text("沙箱未就绪")
    assert text.startswith("沙箱未就绪")
    assert "重试" in text
    assert "新开" not in text
