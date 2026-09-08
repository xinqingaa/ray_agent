#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""日志上下文与默认配置。"""
from app.infrastructure.logging import log_session_prefix, set_log_session_id


def test_log_session_prefix_empty_by_default():
    set_log_session_id("")
    assert log_session_prefix() == ""


def test_log_session_prefix_includes_session_id():
    set_log_session_id("47db6fc2-3225-49b0-b615-a985cf773900")
    assert log_session_prefix() == "会话[47db6fc2-3225-49b0-b615-a985cf773900] "
    set_log_session_id("")
