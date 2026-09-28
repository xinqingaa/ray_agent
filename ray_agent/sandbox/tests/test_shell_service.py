"""W7.1：Shell 执行在约 5 秒内返回，终止能结束忽略 SIGTERM 的进程组。

在沙箱目录运行，不启动 HTTP、Docker 或模型：

    uv run --locked python -m unittest discover -s tests -p 'test_*.py' -v
"""
import asyncio
import os
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from app.services.shell import ShellService


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:
        stat = subprocess.check_output(
            ["ps", "-o", "stat=", "-p", str(pid)],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return False
    return bool(stat) and not stat.startswith(("Z", "z"))


async def _wait_dead(pid: int, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _alive(pid):
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"进程 {pid} 仍在运行")


def _ignore_term_command(pid_path: Path) -> str:
    code = (
        "import os, signal, time\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        f"open({str(pid_path)!r}, 'w').write(str(os.getpid()))\n"
        "while True:\n"
        "    time.sleep(0.2)\n"
    )
    return f"{shlex.quote(sys.executable)} -c {shlex.quote(code)} &\nwait\n"


async def _child_pid(path: Path, timeout: float = 2.0) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and path.read_text().strip():
            return int(path.read_text().strip())
        await asyncio.sleep(0.05)
    raise AssertionError(f"子进程没有写下 pid: {path}")


class ShellServiceControlTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.service = ShellService()
        self._tmpdir = tempfile.TemporaryDirectory(prefix="w71-shell-")
        self.workdir = self._tmpdir.name

    async def asyncTearDown(self) -> None:
        for session_id, shell in list(self.service.active_shells.items()):
            if shell.process.returncode is None:
                await self.service.kill_process(session_id)
        self._tmpdir.cleanup()

    async def test_exec_returns_running_within_five_seconds_and_completed_output(self) -> None:
        started = time.monotonic()
        running = await self.service.exec_command("w71-long", self.workdir, "sleep 10")
        elapsed = time.monotonic() - started
        self.assertEqual(running.status, "running")
        self.assertIsNone(self.service.active_shells["w71-long"].process.returncode)
        self.assertGreaterEqual(elapsed, 4.5)
        self.assertLess(elapsed, 8.0)

        started = time.monotonic()
        done = await self.service.exec_command("w71-short", self.workdir, "sleep 1 && echo ok")
        elapsed = time.monotonic() - started
        self.assertEqual(done.status, "completed")
        self.assertEqual(done.returncode, 0)
        self.assertIn("ok", done.output or "")
        self.assertLess(elapsed, 4.5)

    async def test_kill_ends_process_group_that_ignores_sigterm(self) -> None:
        pid_path = Path(self.workdir) / "child-kill.pid"
        running = await self.service.exec_command("w71-kill", self.workdir, _ignore_term_command(pid_path))
        self.assertEqual(running.status, "running")
        leader = self.service.active_shells["w71-kill"].process
        self.assertEqual(os.getpgid(leader.pid), leader.pid)
        child = await _child_pid(pid_path)
        self.assertNotEqual(child, leader.pid)
        self.assertTrue(_alive(child))

        started = time.monotonic()
        killed = await self.service.kill_process("w71-kill")
        elapsed = time.monotonic() - started
        self.assertEqual(killed.status, "terminated")
        self.assertGreaterEqual(elapsed, 2.0)
        self.assertLess(elapsed, 8.0)
        await _wait_dead(child)
        await _wait_dead(leader.pid)

        replace_path = Path(self.workdir) / "child-replace.pid"
        again = await self.service.exec_command("w71-replace", self.workdir, _ignore_term_command(replace_path))
        self.assertEqual(again.status, "running")
        old_child = await _child_pid(replace_path)
        old_leader = self.service.active_shells["w71-replace"].process.pid
        self.assertTrue(_alive(old_child))

        started = time.monotonic()
        replaced = await self.service.exec_command("w71-replace", self.workdir, "echo replaced")
        elapsed = time.monotonic() - started
        self.assertEqual(replaced.status, "completed")
        self.assertEqual(replaced.returncode, 0)
        self.assertIn("replaced", replaced.output or "")
        self.assertGreaterEqual(elapsed, 2.0)
        self.assertLess(elapsed, 8.0)
        await _wait_dead(old_child)
        await _wait_dead(old_leader)
