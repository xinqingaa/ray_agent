"""本地验证工具执行路径：不访问外部模型。"""
import importlib.util
import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_script(filename):
    spec = importlib.util.spec_from_file_location(filename, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TOOL_AGENT = load_script("3_7_为ReAct Agent添加计算工具.py")
EXTRACT = load_script("3_8_Pydantic结合Tool Calls实现数据提取.py")


def assistant_message(content=None, tool_calls=None):
    dumped_calls = None
    if tool_calls:
        dumped_calls = [
            {
                "id": item.id,
                "type": "function",
                "function": {
                    "name": item.function.name,
                    "arguments": item.function.arguments,
                },
            }
            for item in tool_calls
        ]
    return SimpleNamespace(
        content=content,
        tool_calls=tool_calls,
        model_dump=lambda: {
            "role": "assistant",
            "content": content,
            "tool_calls": dumped_calls,
        },
    )


def completion(message):
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class RecordingClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class ToolActionTests(unittest.TestCase):
    def test_parse_script_accepts_valid_and_rejects_invalid(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "3_8_Pydantic解析数据.py")],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIn("解析成功", result.stdout)
        self.assertIn("数据校验失败", result.stdout)

    def test_text_reply_does_not_execute_a_tool(self):
        client = RecordingClient(
            [completion(assistant_message(content="这是解释，不是操作。"))]
        )
        with patch.object(TOOL_AGENT, "openai_client", return_value=(client, "fixture-model")):
            output = io.StringIO()
            with redirect_stdout(output):
                reply = TOOL_AGENT.ReActAgent().process_query("为什么写入后还要读取？")
        self.assertEqual(len(client.calls), 1)
        self.assertIn("tools", client.calls[0])
        self.assertNotIn("tool_choice", client.calls[0])
        self.assertEqual(reply, "Assistant: 这是解释，不是操作。")
        self.assertEqual(output.getvalue(), "")

    def test_tool_calls_are_executed_and_returned_as_tool_role(self):
        first = assistant_message(
            tool_calls=[
                SimpleNamespace(
                    id="call_calc",
                    function=SimpleNamespace(
                        name="calculator",
                        arguments='{"expression": "12+30"}',
                    ),
                )
            ]
        )
        second = assistant_message(content="计算结果是 42。")
        client = RecordingClient([completion(first), completion(second)])

        with patch.object(TOOL_AGENT, "openai_client", return_value=(client, "fixture-model")):
            output = io.StringIO()
            with redirect_stdout(output):
                reply = TOOL_AGENT.ReActAgent().process_query("计算 12+30")

        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[1]["tool_choice"], "none")
        tool_messages = [
            message
            for message in client.calls[1]["messages"]
            if message.get("role") == "tool"
        ]
        self.assertEqual(len(tool_messages), 1)
        self.assertEqual(tool_messages[0]["tool_call_id"], "call_calc")
        self.assertEqual(json.loads(tool_messages[0]["content"]), {"result": 42})
        self.assertIn("calculator", output.getvalue())
        self.assertEqual(reply, "Assistant: 计算结果是 42。")

    def test_forced_tool_choice_extracts_schema_without_running_a_function(self):
        arguments = '{"name": "泽辉", "age": 18, "email": "zehuiya@163.com"}'
        tool_call = SimpleNamespace(function=SimpleNamespace(arguments=arguments))
        client = RecordingClient(
            [completion(SimpleNamespace(tool_calls=[tool_call]))]
        )
        with patch.object(EXTRACT, "openai_client", return_value=(client, "fixture-model")):
            output = io.StringIO()
            with redirect_stdout(output):
                EXTRACT.main()
        self.assertEqual(client.calls[0]["tool_choice"]["function"]["name"], "UserInfo")
        self.assertEqual(output.getvalue().strip(), "泽辉")


if __name__ == "__main__":
    unittest.main()
