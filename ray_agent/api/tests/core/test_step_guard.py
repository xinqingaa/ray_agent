#!/usr/bin/env python
# -*- coding: utf-8 -*-
from app.domain.services.agents.step_guard import is_fake_step_completion


def test_write_file_step_without_tools_is_fake():
    assert is_fake_step_completion(
        "使用 write_file 工具将内容 hello 写入 /home/ubuntu/hello.txt。",
        ["/home/ubuntu/hello.txt"],
        [],
    )


def test_write_file_step_with_notify_only_is_fake():
    assert is_fake_step_completion(
        "使用 write_file 写入 hello.txt",
        ["/home/ubuntu/hello.txt"],
        ["message_notify_user"],
    )


def test_write_file_step_with_real_tool_is_not_fake():
    assert not is_fake_step_completion(
        "使用 write_file 写入 hello.txt",
        ["/home/ubuntu/hello.txt"],
        ["write_file"],
    )


def test_plain_text_step_without_tools_is_allowed():
    assert not is_fake_step_completion("根据已有结果整理结论", [], [])
