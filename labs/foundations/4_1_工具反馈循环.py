#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""最小工具反馈循环：有 tool_calls 就执行并再请求，没有则停止。

文件读写发生在进程内存里，不经过沙箱。带 max_iterations。
第二次请求不使用 tool_choice=\"none\"，因此模型仍可提出下一轮调用。
"""
import json
import sys

from llm_settings import openai_client

DEFAULT_QUERY = "请把 hello 写入 hello.txt，再读取文件，告诉我里面是什么。"
MAX_ITERATIONS = 5


class MemoryFiles:
    """进程内文件表，只供本实验观察写后可读。"""

    def __init__(self) -> None:
        self.files: dict[str, str] = {}

    def write_file(self, filepath: str, content: str) -> str:
        self.files[filepath] = content
        return json.dumps({"ok": True, "filepath": filepath}, ensure_ascii=False)

    def read_file(self, filepath: str) -> str:
        if filepath not in self.files:
            return json.dumps({"error": "文件不存在", "filepath": filepath}, ensure_ascii=False)
        return json.dumps(
            {"filepath": filepath, "content": self.files[filepath]},
            ensure_ascii=False,
        )


def _tool_schema(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        },
    }


class ToolLoopAgent:
    def __init__(self, max_iterations: int = MAX_ITERATIONS) -> None:
        self.client, self.model = openai_client()
        self.max_iterations = max_iterations
        self.files = MemoryFiles()
        self.messages = [
            {
                "role": "system",
                "content": (
                    "你是文件助手。需要写入或读取时调用工具。"
                    "写入成功后应再读取确认，不要只凭口头声称文件已写好。"
                ),
            }
        ]
        self.available_tools = {
            "write_file": self.files.write_file,
            "read_file": self.files.read_file,
        }
        self.tools = [
            _tool_schema(
                "write_file",
                "创建或覆盖写入一个文本文件",
                {
                    "filepath": {"type": "string", "description": "要写入的文件路径"},
                    "content": {"type": "string", "description": "要写入的文本内容"},
                },
                ["filepath", "content"],
            ),
            _tool_schema(
                "read_file",
                "读取文本文件内容",
                {"filepath": {"type": "string", "description": "要读取的文件路径"}},
                ["filepath"],
            ),
        ]

    def process_query(self, query: str) -> str:
        """根据工具结果继续决策，直到没有 tool_calls 或达到迭代上限。"""
        self.messages.append({"role": "user", "content": query})

        for _ in range(self.max_iterations):
            response = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=self.tools,
            )
            message = response.choices[0].message
            self.messages.append(message.model_dump())
            tool_calls = message.tool_calls
            if not tool_calls:
                return message.content or ""

            for tool_call in tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)
                print("Tool Call:", tool_name)
                print("Tool Parameters:", tool_args)
                result = self.available_tools[tool_name](**tool_args)
                print(f"Tool [{tool_name}] Result: {result}")
                self.messages.append(
                    {
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": tool_name,
                        "content": result,
                    }
                )

        raise RuntimeError(f"超过最大迭代次数 {self.max_iterations}，本轮未收到无工具调用的回答。")


def main() -> None:
    agent = ToolLoopAgent()
    query = " ".join(sys.argv[1:]).strip() or DEFAULT_QUERY
    print(agent.process_query(query))


if __name__ == "__main__":
    main()
