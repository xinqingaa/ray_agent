"""本地 HTTP 验证：不访问外部服务，不需要真实密钥。"""
import importlib.util
import io
import json
import sys
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import llm_settings as settings

def load_script(filename):
    spec = importlib.util.spec_from_file_location(filename, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NORMAL = load_script("3_4_Chat Completions API调用.py")
STREAM = load_script("3_4_Chat Completions API流式调用.py")

FIXTURE_ENV = {
    "LLM_API_KEY": "local-fixture-only",
    "LLM_MODEL_NAME": "fixture-model",
    "LLM_BASE_URL": "https://example.test/v1",
}


class LlmSettingsTests(unittest.TestCase):
    def test_appends_chat_completions(self):
        self.assertEqual(
            settings.chat_completions_url("https://example.test/v1"),
            "https://example.test/v1/chat/completions",
        )
        self.assertEqual(
            settings.chat_completions_url("https://example.test/v1/chat/completions"),
            "https://example.test/v1/chat/completions",
        )


class ModelInteractionTests(unittest.TestCase):
    def run_local(self, module, mode="normal", reason="stop", extra_env=None):
        observed = {}
        first_displayed = threading.Event()

        class Output(io.StringIO):
            def write(self, text):
                if text == "读取":
                    first_displayed.set()
                return super().write(text)

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                observed["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if mode == "http_error":
                    self.send_response(401)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json" if module is NORMAL else "text/event-stream")
                self.end_headers()
                if module is NORMAL:
                    self.wfile.write(json.dumps({"choices": [{"message": {"role": "assistant", "content": "读取确认。"}, "finish_reason": reason}]}).encode())
                    return

                def send(data):
                    value = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
                    self.wfile.write(f"data: {value}\n\n".encode())
                    self.wfile.flush()

                self.wfile.write(b": keep-alive\n\n")
                send({"choices": [{"delta": {"role": "assistant", "content": ""}, "finish_reason": None}]})
                send({"choices": [{"delta": {"content": "读取"}, "finish_reason": None}]})
                # 只有首段已经到达应用层，才发送余下响应；缓冲到结束的实现会失败。
                observed["displayed_before_end"] = first_displayed.wait(2)
                if mode == "truncated":
                    return
                send({"choices": [{"delta": {"content": "确认。"}, "finish_reason": None}]})
                send({"choices": [{"delta": {}, "finish_reason": reason}]})
                send({"choices": [], "usage": {"total_tokens": 12}})
                send("[DONE]")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        real_post = requests.post
        output = Output()

        def local_post(url, **kwargs):
            observed["url"] = url
            return real_post(f"http://127.0.0.1:{server.server_port}/chat/completions", **kwargs)

        env = extra_env or FIXTURE_ENV
        try:
            with patch.dict("os.environ", env, clear=True), patch.object(settings.dotenv, "load_dotenv"), patch.object(module.requests, "post", side_effect=local_post), redirect_stdout(output):
                module.main()
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
        return output.getvalue(), observed

    def test_same_input_and_complete_response(self):
        normal_text, normal = self.run_local(NORMAL)
        stream_text, stream = self.run_local(STREAM)
        self.assertEqual(normal["body"]["model"], stream["body"]["model"])
        self.assertEqual(normal["body"]["messages"], stream["body"]["messages"])
        self.assertFalse(normal["body"]["stream"])
        self.assertTrue(stream["body"]["stream"])
        self.assertEqual(normal["url"], "https://example.test/v1/chat/completions")
        self.assertIn("回答： 读取确认。", normal_text)
        self.assertIn("拼接回答： 读取确认。", stream_text)
        self.assertIn("结束原因： stop", stream_text)
        self.assertTrue(stream["displayed_before_end"], "客户端必须在响应结束前输出首段")

    def test_length_is_visible(self):
        text, _ = self.run_local(STREAM, reason="length")
        self.assertIn("结束原因： length", text)

    def test_truncated_stream_is_not_complete(self):
        with self.assertRaisesRegex(RuntimeError, "未完整结束"):
            self.run_local(STREAM, mode="truncated")

    def test_http_error_is_not_an_answer(self):
        for module in (NORMAL, STREAM):
            with self.subTest(module=module.__name__), self.assertRaises(requests.HTTPError):
                self.run_local(module, mode="http_error")

    def test_missing_settings_stop_before_network(self):
        for module in (NORMAL, STREAM):
            with self.subTest(module=module.__name__), patch.dict("os.environ", {}, clear=True), patch.object(settings.dotenv, "load_dotenv"), patch.object(module.requests, "post") as post:
                with self.assertRaisesRegex(SystemExit, "LLM_API_KEY"):
                    module.main()
                post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
