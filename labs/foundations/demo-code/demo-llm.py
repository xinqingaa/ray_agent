#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from llm_settings import openai_client


class ChatClient:
    """OpenAI 兼容客户端"""

    def __init__(self):
        self.openai, self.model = openai_client()

    async def process_query(self, query: str) -> str:
        """使用模型处理用户输入"""
        # 初始化用户消息
        messages = [{"role": "user", "content": query}]

        # 调用模型获取响应内容
        response = self.openai.chat.completions.create(
            model=self.model,
            messages=messages,
        )

        # 获取响应消息+工具响应
        response_message = response.choices[0].message

        # 返回应用响应
        return "Assistant: " + response_message.content

    async def chat_loop(self):
        """运行循环对话"""
        while True:
            try:
                # 获取用户的输入，如果输入quit则退出循环
                query = input("\nQuery: ").strip()
                if query.lower() == "quit":
                    break
                # 调用process_query获取响应内容并打印
                response = await self.process_query(query)
                print(response)
            except Exception as e:
                print(f"\nError: {str(e)}")


async def main():
    client = ChatClient()

    await client.chat_loop()


if __name__ == "__main__":
    asyncio.run(main())
