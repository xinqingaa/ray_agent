"""本地验证工具反馈循环：不访问外部模型。"""
import importlib.util
import io
import json
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


LOOP = load_script("4_1_工具反馈循环.py")
ONCE = load_script("3_7_为ReAct Agent添加计算工具.py")


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


def tool_call(call_id, name, arguments):
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=arguments),
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


class AgentLoopTests(unittest.TestCase):
    def test_text_reply_stops_without_another_model_call(self):
        client = RecordingClient(
            [completion(assistant_message(content="只解释，不操作。"))]
        )
        with patch.object(LOOP, "openai_client", return_value=(client, "fixture-model")):
            reply = LOOP.ToolLoopAgent().process_query("为什么写入后还要读取？")
        self.assertEqual(len(client.calls), 1)
        self.assertNotIn("tool_choice", client.calls[0])
        self.assertEqual(reply, "只解释，不操作。")

    def test_write_then_read_then_stop(self):
        client = RecordingClient(
            [
                completion(
                    assistant_message(
                        tool_calls=[
                            tool_call(
                                "call_write",
                                "write_file",
                                '{"filepath": "hello.txt", "content": "hello"}',
                            )
                        ]
                    )
                ),
                completion(
                    assistant_message(
                        tool_calls=[
                            tool_call("call_read", "read_file", '{"filepath": "hello.txt"}')
                        ]
                    )
                ),
                completion(assistant_message(content="文件内容是 hello。")),
            ]
        )
        with patch.object(LOOP, "openai_client", return_value=(client, "fixture-model")):
            output = io.StringIO()
            with redirect_stdout(output):
                agent = LOOP.ToolLoopAgent()
                reply = agent.process_query(LOOP.DEFAULT_QUERY)

        self.assertEqual(len(client.calls), 3)
        for call in client.calls:
            self.assertNotIn("tool_choice", call)
        self.assertEqual(agent.files.files["hello.txt"], "hello")
        read_results = [
            json.loads(message["content"])
            for message in client.calls[2]["messages"]
            if message.get("role") == "tool" and message.get("name") == "read_file"
        ]
        self.assertEqual(read_results[-1]["content"], "hello")
        self.assertIn("write_file", output.getvalue())
        self.assertIn("read_file", output.getvalue())
        self.assertEqual(reply, "文件内容是 hello。")

    def test_max_iterations_stops_when_tools_never_end(self):
        write = completion(
            assistant_message(
                tool_calls=[
                    tool_call(
                        "call_write",
                        "write_file",
                        '{"filepath": "hello.txt", "content": "hello"}',
                    )
                ]
            )
        )
        client = RecordingClient([write, write])
        with patch.object(LOOP, "openai_client", return_value=(client, "fixture-model")):
            agent = LOOP.ToolLoopAgent(max_iterations=2)
            with self.assertRaisesRegex(RuntimeError, "最大迭代次数"):
                agent.process_query(LOOP.DEFAULT_QUERY)
        self.assertEqual(len(client.calls), 2)

    def test_one_shot_script_locks_the_second_call(self):
        first = assistant_message(
            tool_calls=[
                tool_call("call_calc", "calculator", '{"expression": "12+30"}')
            ]
        )
        second = assistant_message(content="计算结果是 42。")
        client = RecordingClient([completion(first), completion(second)])
        with patch.object(ONCE, "openai_client", return_value=(client, "fixture-model")):
            with redirect_stdout(io.StringIO()):
                ONCE.ReActAgent().process_query("计算 12+30")
        self.assertEqual(client.calls[1]["tool_choice"], "none")


if __name__ == "__main__":
    unittest.main()
