#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/7/4 15:05
@Author  : thezehui@gmail.com
@File    : 3_6 OpenAI SDK重构代码.py
"""
import dotenv
from openai import OpenAI

dotenv.load_dotenv()

client = OpenAI()

response = client.chat.completions.create(
    model="deepseek-reasoner",
    messages=[{"role": "user", "content": "你好，你是?"}]
)

print("推理内容:", response.choices[0].message.reasoning_content)
print("最终答案:", response.choices[0].message.content)
