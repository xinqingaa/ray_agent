#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/03 17:26
@Author  : thezehui@gmail.com
@File    : 10-4 browser-use本次操控实例.py
"""
import asyncio

import dotenv
from browser_use import Agent, Browser, ChatBrowserUse

dotenv.load_dotenv()


async def example():
    # 1.初始化浏览器实例与llm实例
    browser = Browser()
    llm = ChatBrowserUse()

    # 2.构建Browser-use智能体
    agent = Agent(
        task="帮我看下慕课网有哪些关于AI的体系课",
        llm=llm,
        browser=browser,
    )

    # 3.运行agent并返回结果
    return await agent.run()


if __name__ == "__main__":
    history = asyncio.run(example())
    print(history)
