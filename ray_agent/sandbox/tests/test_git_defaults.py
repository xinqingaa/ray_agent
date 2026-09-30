"""真实 Git 临时仓库验证默认执行配置；不连接 Docker，不测试凭据或推送。"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().parents[1] / "scripts/git-defaults.py"


class GitDefaultsTest(unittest.TestCase):
    def test_commit_ignores_hooks_fsmonitor_filters_and_keeps_config(self):
        with tempfile.TemporaryDirectory(prefix="rayagent-git-") as directory:
            root = Path(directory)
            subprocess.run(["/usr/bin/git", "init", "-q", directory], check=True)
            hook = root / ".git/hooks/pre-commit"
            hook.write_text("#!/bin/sh\ntouch hook-ran\nexit 42\n")
            hook.chmod(0o755)
            config = root / ".git/config"
            config.write_text(config.read_text() + '\n[core]\n fsmonitor = "touch fsmonitor-ran"\n[filter "tripwire"]\n clean = "touch filter-ran; cat"\n smudge = "touch filter-ran; cat"\n required = true\n')
            original_config = config.read_bytes()
            (root / ".gitattributes").write_text("*.txt filter=tripwire\n")
            (root / "note.txt").write_text("temporary commit\n")
            environment = {**os.environ, "GIT_AUTHOR_NAME": "RayAgent Probe", "GIT_AUTHOR_EMAIL": "probe@example.test",
                           "GIT_COMMITTER_NAME": "RayAgent Probe", "GIT_COMMITTER_EMAIL": "probe@example.test"}
            for args in (("add", "."), ("commit", "-qm", "probe")):
                result = subprocess.run([sys.executable, str(WRAPPER), "-C", directory, *args],
                                        env=environment, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(config.read_bytes(), original_config)
            self.assertFalse((root / "hook-ran").exists())
            self.assertFalse((root / "filter-ran").exists())
            self.assertFalse((root / "fsmonitor-ran").exists())
            author = subprocess.check_output(["/usr/bin/git", "-C", directory, "log", "-1", "--format=%an <%ae>"], text=True)
            self.assertEqual(author.strip(), "RayAgent Probe <probe@example.test>")

    def test_missing_hooks_and_config_still_support_init(self):
        with tempfile.TemporaryDirectory(prefix="rayagent-git-empty-") as directory:
            result = subprocess.run([sys.executable, str(WRAPPER), "-C", directory, "init", "-q"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((Path(directory) / ".git/config").is_file())


if __name__ == "__main__":
    unittest.main()
