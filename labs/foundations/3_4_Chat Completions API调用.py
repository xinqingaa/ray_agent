#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json

import requests

from llm_settings import chat_completions_url, llm_settings


def main() -> None:
    api_key, model, base_url = llm_settings()

    with requests.post(
        chat_completions_url(base_url),
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
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
