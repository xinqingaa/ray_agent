#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/7/4 10:34
@Author  : thezehui@gmail.com
@File    : 3_3_DeepSeek API调用.py
"""
import json
import os

import dotenv
import requests


def main() -> None:
    dotenv.load_dotenv()
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("请先配置 DEEPSEEK_API_KEY，运行条件见本目录 README。")

    with requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            "messages": [
                {"role": "user", "content": "请用一句话说明：为什么写入文件后还要读取确认？"}
            ],
            "stream": False,
        },
        timeout=(10, 60),
    ) as response:
        response.raise_for_status()
        body = response.json()

    print("完整响应：")
    print(json.dumps(body, ensure_ascii=False, indent=2))
    choice = body["choices"][0]
    print("回答：", choice["message"].get("content") or "")
    print("结束原因：", choice.get("finish_reason"))


if __name__ == "__main__":
    main()
