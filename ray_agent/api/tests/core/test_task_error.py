#!/usr/bin/env python
# -*- coding: utf-8 -*-
from app.domain.services.task_error import (
    QUOTA_ERROR,
    format_public_error,
    format_public_error_text,
)


def test_strips_validation_doc_link_and_runner_prefix():
    raw = (
        "AgentTaskRunner出错: 1 validation error for Plan "
        "For further information visit https://errors.pydantic.dev/2.11/v/model_type"
    )
    text = format_public_error_text(raw)
    assert text.startswith("1 validation error for Plan")
    assert "pydantic.dev" not in text
    assert "重试" in text


def test_formats_quota_error():
    assert "额度" in format_public_error_text("Error code: 403 - insufficient_quota")
    assert format_public_error(RuntimeError("insufficient_quota")) == QUOTA_ERROR


def test_hides_docker_pull_url():
    raw = (
        '500 Server Error for http+docker://localhost/v1.56/images/create'
        '?tag=latest&fromImage=mooc-manus-sandbox: Internal Server Error ("failed to resolve reference")'
    )
    text = format_public_error_text(raw)
    assert "http+docker" not in text
    assert "fromImage" not in text
    assert "沙箱镜像或网络不可用" in text
    assert text.endswith("可在本任务中重试。")


def test_keeps_short_error_and_adds_retry_hint():
    text = format_public_error_text("沙箱未就绪")
    assert text.startswith("沙箱未就绪")
    assert "重试" in text
    assert "新开" not in text
