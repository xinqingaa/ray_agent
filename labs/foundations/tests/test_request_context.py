"""本地验证请求工作集：不访问外部模型。"""
import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_script(filename):
    spec = importlib.util.spec_from_file_location(filename, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CONTEXT = load_script("5_1_观察请求工作集.py")


class RequestContextTests(unittest.TestCase):
    def test_first_beat_has_no_tool_observation(self):
        first = CONTEXT.inventory(CONTEXT.hello_beats()[0])
        self.assertEqual(first["roles"], ["system", "user"])
        self.assertFalse(first["has_write_observation"])
        self.assertFalse(first["has_read_observation"])

    def test_write_observation_appears_only_from_second_beat(self):
        beats = [CONTEXT.inventory(messages) for messages in CONTEXT.hello_beats()]
        self.assertTrue(beats[1]["has_write_observation"])
        self.assertFalse(beats[1]["has_read_observation"])
        self.assertTrue(beats[2]["has_write_observation"])
        self.assertTrue(beats[2]["has_read_observation"])

    def test_dropping_tool_result_hides_the_observation(self):
        second = CONTEXT.hello_beats()[1]
        missing = CONTEXT.inventory(CONTEXT.drop_last_tool(second))
        self.assertIn("assistant", missing["roles"])
        self.assertFalse(missing["has_write_observation"])

    def test_tools_and_role_wrap_make_the_request_longer_than_contents(self):
        item = CONTEXT.inventory(CONTEXT.hello_beats()[1])
        self.assertGreater(item["wrapped_chars"], item["content_chars"])
        self.assertGreater(item["request_chars"], item["wrapped_chars"])

    def test_main_prints_missing_observation_contrast(self):
        output = io.StringIO()
        with redirect_stdout(output):
            CONTEXT.main()
        text = output.getvalue()
        self.assertIn("写入观察=无", text)
        self.assertIn("写入观察=有", text)
        self.assertIn("漏回传写入观察", text)


if __name__ == "__main__":
    unittest.main()
