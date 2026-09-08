#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把内部异常转成可展示、可重试的说明，不要求用户新开任务。"""

STEP_PARSE_ERROR = "当前步骤的执行结果无法解析，已停止本轮任务。可直接重试，无需新开任务。"
QUOTA_ERROR = "模型服务额度不足。请检查模型配置后，在本任务中重试。"
EMPTY_MESSAGE_ERROR = "没有收到有效消息，请重新发送。"
SUMMARIZE_PARSE_ERROR = "汇总结果无法解析，已停止本轮任务。可直接重试，无需新开任务。"
GENERIC_RETRY_SUFFIX = "可在本任务中重试。"


def format_public_error_text(text: str) -> str:
    """将原始错误文本收成短句，去掉校验栈和文档链接。"""
    raw = (text or "").strip()
    if not raw:
        return f"任务执行失败。{GENERIC_RETRY_SUFFIX}"

    lowered = raw.lower()
    if "validation error for step" in lowered or "type=model_type" in lowered:
        return STEP_PARSE_ERROR
    if "insufficient_quota" in lowered:
        return QUOTA_ERROR
    if raw == "空消息错误" or "empty message" in lowered:
        return EMPTY_MESSAGE_ERROR
    if "汇总结果无法解析" in raw:
        return SUMMARIZE_PARSE_ERROR

    first_line = raw.splitlines()[0].strip()
    marker = "for further information visit"
    idx = first_line.lower().find(marker)
    if idx >= 0:
        first_line = first_line[:idx].strip()
    if first_line.startswith("AgentTaskRunner出错:"):
        first_line = first_line[len("AgentTaskRunner出错:"):].strip()
    if not first_line:
        return f"任务执行失败。{GENERIC_RETRY_SUFFIX}"
    if len(first_line) > 160:
        first_line = first_line[:160] + "…"
    if GENERIC_RETRY_SUFFIX in first_line or "可直接重试" in first_line:
        return first_line
    return f"{first_line} {GENERIC_RETRY_SUFFIX}"


def format_public_error(exc: BaseException) -> str:
    """将异常转成面向用户的失败说明。"""
    return format_public_error_text(str(exc))
