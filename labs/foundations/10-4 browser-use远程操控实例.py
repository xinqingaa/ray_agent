#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
@Time    : 2025/05/04 0:21
@Author  : thezehui@gmail.com
@File    : 10-4 browser-use远程操控实例.py
"""
import os

import dotenv
from browser_use_sdk import BrowserUse

dotenv.load_dotenv()

client = BrowserUse(api_key=os.environ["BROWSER_USE_API_KEY"])

task = client.tasks.create_task(
    task="帮我看下慕课网有哪些关于AI的体系课",
    llm="browser-use-llm",
)

for step in task.stream():
    print(f"步骤{step.number}: ", step)
    print("====================")
