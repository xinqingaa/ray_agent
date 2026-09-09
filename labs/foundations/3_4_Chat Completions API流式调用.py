#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json

import requests

from llm_settings import chat_completions_url, llm_settings


def main() -> None:
    api_key, model, base_url = llm_settings()

    parts = []
    finish_reason = None
    received_done = False
    with requests.post(
        chat_completions_url(base_url),
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [
                {"role": "user", "content": "请用一句话说明：为什么写入文件后还要读取确认？"}
            ],
            "stream": True,  # 请模型服务逐段返回
        },
        stream=True,  # 请 Requests 不要预先读取完整响应体
        timeout=(10, 60),
    ) as response:
        response.raise_for_status()
        response.encoding = "utf-8"
        print("逐段回答：", flush=True)
        # 按该接口的一行 data 对应一个 JSON 块解析，不是通用 SSE 客户端。
        for line in response.iter_lines(chunk_size=1, decode_unicode=True):
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if data == "[DONE]":
                received_done = True
                break
            if not data:
                continue
            chunk = json.loads(data)
            choices = chunk.get("choices") or []
            if not choices:  # 用量统计等块不一定带候选回答
                continue
            choice = choices[0]
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if content:
                parts.append(content)
                print(content, end="", flush=True)
            if choice.get("finish_reason") is not None:
                finish_reason = choice["finish_reason"]

    print()
    if not received_done or finish_reason is None:
        raise RuntimeError("响应流未完整结束；已显示的内容只能视为部分结果。")
    print("拼接回答：", "".join(parts))
    print("结束原因：", finish_reason)


if __name__ == "__main__":
    main()
