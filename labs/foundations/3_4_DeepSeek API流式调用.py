#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/7/4 10:39
@Author  : thezehui@gmail.com
@File    : 3_3_DeepSeek API流式调用.py
"""
import os

import dotenv
import requests

dotenv.load_dotenv()

with requests.request(
        "POST",
        "https://api.deepseek.com/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {os.getenv('DEEPSEEK_API_KEY')}"
        },
        json={
            "model": "deepseek-reasoner",
            "messages": [
                {"role": "user", "content": "你好，你是?"}
            ],
            "stream": True
        }
) as resp:
    for line in resp.iter_lines(decode_unicode=True):
        if line:
            if line.startswith("data:"):
                data = line.lstrip("data:").strip()
                print("data:", data)
