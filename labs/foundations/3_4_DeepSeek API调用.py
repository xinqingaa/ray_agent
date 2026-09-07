#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/7/4 10:34
@Author  : thezehui@gmail.com
@File    : 3_3_DeepSeek API调用.py
"""
import os

import dotenv
import requests

dotenv.load_dotenv()

response = requests.request(
    "POST",
    "https://api.deepseek.com/chat/completions",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {os.getenv('DEEPSEEK_API_KEY')}"
    },
    json={
        "model": "deepseek-chat",
        "messages": [
            {"role": "user", "content": "你好，你是?"}
        ],
        "stream": False
    }
)

print(response.json())
