#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""观察每一拍请求的工作集：模型只看见程序放进这一次调用的内容。

使用与 4_1 默认任务同形的示意消息，不调用外部模型，也不依赖本地 tokenizer。
"""
import json
import sys

QUERY = "请把 hello 写入 hello.txt，再读取文件，告诉我里面是什么。"
SYSTEM = (
    "你是文件助手。需要写入或读取时调用工具。"
    "写入成功后应再读取确认，不要只凭口头声称文件已写好。"
)
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "创建或覆盖写入一个文本文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["filepath", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取文本文件内容",
            "parameters": {
                "type": "object",
                "properties": {"filepath": {"type": "string"}},
                "required": ["filepath"],
            },
        },
    },
]


def assistant_action(call_id: str, name: str, arguments: str, content=None) -> dict:
    return {
        "role": "assistant",
        "content": content,
        "tool_calls": [
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": arguments},
            }
        ],
    }


def tool_result(call_id: str, name: str, payload: dict) -> dict:
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": name,
        "content": json.dumps(payload, ensure_ascii=False),
    }


def hello_beats() -> list[list[dict]]:
    """三拍请求里实际送出的 messages。示意数据，不是真实模型输出。"""
    system = {"role": "system", "content": SYSTEM}
    user = {"role": "user", "content": QUERY}
    write = assistant_action(
        "call_write",
        "write_file",
        '{"filepath": "hello.txt", "content": "hello"}',
    )
    write_obs = tool_result("call_write", "write_file", {"ok": True, "filepath": "hello.txt"})
    read = assistant_action("call_read", "read_file", '{"filepath": "hello.txt"}')
    read_obs = tool_result(
        "call_read",
        "read_file",
        {"filepath": "hello.txt", "content": "hello"},
    )
    return [
        [system, user],
        [system, user, write, write_obs],
        [system, user, write, write_obs, read, read_obs],
    ]


def has_tool_observation(messages: list[dict], name: str) -> bool:
    return any(item.get("role") == "tool" and item.get("name") == name for item in messages)


def content_chars(messages: list[dict]) -> int:
    total = 0
    for item in messages:
        content = item.get("content")
        if isinstance(content, str):
            total += len(content)
        if item.get("tool_calls"):
            total += len(json.dumps(item["tool_calls"], ensure_ascii=False))
    return total


def wrap_for_count(messages: list[dict]) -> str:
    """示意 chat template：服务端会给角色加包装，不是把 content 拼起来。"""
    parts = []
    for item in messages:
        parts.append(f"<|{item.get('role', '')}|>{item.get('content') or ''}")
        if item.get("tool_calls"):
            parts.append(json.dumps(item["tool_calls"], ensure_ascii=False))
    return "".join(parts)


def inventory(messages: list[dict], tools: list[dict] | None = None) -> dict:
    tool_list = TOOLS if tools is None else tools
    return {
        "roles": [item.get("role") for item in messages],
        "has_write_observation": has_tool_observation(messages, "write_file"),
        "has_read_observation": has_tool_observation(messages, "read_file"),
        "message_count": len(messages),
        "content_chars": content_chars(messages),
        "wrapped_chars": len(wrap_for_count(messages)),
        "request_chars": content_chars(messages) + len(json.dumps(tool_list, ensure_ascii=False)),
    }


def drop_last_tool(messages: list[dict]) -> list[dict]:
    trimmed = list(messages)
    if trimmed and trimmed[-1].get("role") == "tool":
        trimmed.pop()
    return trimmed


def format_inventory(index: int, item: dict) -> str:
    write = "有" if item["has_write_observation"] else "无"
    read = "有" if item["has_read_observation"] else "无"
    return (
        f"第 {index} 拍  roles={item['roles']}\n"
        f"  写入观察={write}  读取观察={read}  消息条数={item['message_count']}\n"
        f"  正文字符={item['content_chars']}  加角色包装={item['wrapped_chars']}  "
        f"含 tools 声明={item['request_chars']}"
    )


def main() -> None:
    beats = hello_beats()
    for index, messages in enumerate(beats, start=1):
        print(format_inventory(index, inventory(messages)))
        print()

    missing = inventory(drop_last_tool(beats[1]))
    print("第二拍若漏回传写入观察:")
    print(format_inventory(2, missing))


if __name__ == "__main__":
    main()
    sys.exit(0)
