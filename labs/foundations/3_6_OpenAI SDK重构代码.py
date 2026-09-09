#!/usr/bin/env python
# -*- coding: utf-8 -*-
from llm_settings import openai_client

client, model = openai_client()

response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "你好，你是?"}]
)

message = response.choices[0].message
print("推理内容:", getattr(message, "reasoning_content", None))
print("最终答案:", message.content)
