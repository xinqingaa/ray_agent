"""本机执行：真实 supervisor 子进程上的启动、进程树结束、外部进程登记、环境隔离与重启语义。"""
import asyncio
import os
import shutil
import subprocess
import tempfile
import time

import pytest

from app.domain.external.process_executor import ProcessOwner, ProcessSpec, ProcessState
from app.domain.models.identity import RootedPath
from app.infrastructure.external.execution import env as execution_env
from app.infrastructure.external.execution import shell_bridge
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.execution.supervisor_client import SupervisorClient, UnknownProcess
from app.infrastructure.external.execution.supervisor_lifecycle import (
    ensure_supervisor, ping, socket_path_for, stop_supervisor,
)

OWNER = ProcessOwner(session_id="s1", run_id="r1")
ROOT_ID = "root-1"


@pytest.fixture
def data_root():
    # 套接字路径有长度上限，pytest 的临时目录在 macOS 上可能过长
    path = tempfile.mkdtemp(prefix="ra-exec-", dir="/tmp")
    yield path
    asyncio.run(stop_supervisor(path))
    shutil.rmtree(path, ignore_errors=True)


@pytest.fixture
def workdir(data_root):
    path = os.path.join(data_root, "work")
    os.makedirs(path)
    return path


def run(coroutine, seconds=40):
    return asyncio.run(asyncio.wait_for(coroutine, seconds))


async def open_executor(data_root, workdir, runtime_bin_dirs=()):
    socket_path = await ensure_supervisor(data_root, runtime_bin_dirs)
    executor = SupervisedProcessExecutor(SupervisorClient(socket_path), {ROOT_ID: workdir})
    return executor


def shell_spec(command, **kwargs):
    return ProcessSpec(shell_command=command, cwd=RootedPath(root_id=ROOT_ID), owner=OWNER, **kwargs)


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def wait_dead(pid, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not pid_alive(pid):
            return True
        await asyncio.sleep(0.05)
    return False


async def pid_from_output(executor, process_id, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        text = (await executor.read_output(process_id)).text.strip()
        if text.splitlines() and text.splitlines()[0].isdigit():
            return int(text.splitlines()[0])
        await asyncio.sleep(0.05)
    raise AssertionError("没有读到进程号")


def test_start_wait_and_read_output(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            info = await executor.shell_info()
            assert info.dialect == "posix" and info.program in ("/bin/zsh", "/bin/sh")
            started = await executor.start(shell_spec("echo hello; echo oops >&2; pwd; exit 3"))
            assert started.state is ProcessState.RUNNING and started.process_id
            done = await executor.wait(started.process_id, 10)
            assert done.state is ProcessState.EXITED and done.exit_code == 3 and done.ended_at
            output = await executor.read_output(started.process_id)
            lines = output.text.splitlines()
            assert lines[:2] == ["hello", "oops"] and os.path.realpath(lines[2]) == os.path.realpath(workdir)
            assert not output.truncated and output.next_offset == len(output.text)
            assert (await executor.read_output(started.process_id, output.next_offset)).text == ""
            tail = await executor.read_output(started.process_id, 6)
            assert tail.text == output.text[6:]
        finally:
            await executor.client.close()

    run(check())


def test_wait_timeout_returns_running_and_write_input(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            started = await executor.start(shell_spec("read line; echo got:$line", interactive=True))
            waiting = await executor.wait(started.process_id, 0.3)
            assert waiting.state is ProcessState.RUNNING
            await executor.write_input(started.process_id, "abc\n")
            done = await executor.wait(started.process_id, 10)
            assert done.state is ProcessState.EXITED and done.exit_code == 0
            assert "got:abc" in (await executor.read_output(started.process_id)).text
            with pytest.raises(Exception):
                await executor.write_input(started.process_id, "late\n")
        finally:
            await executor.client.close()

    run(check())


def test_output_keeps_only_tail_when_over_limit(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            started = await executor.start(shell_spec("head -c 1500000 /dev/zero | tr '\\0' 'a'"))
            await executor.wait(started.process_id, 20)
            output = await executor.read_output(started.process_id)
            assert len(output.text) == 1024 * 1024 and output.truncated
            assert output.next_offset == 1_500_000
        finally:
            await executor.client.close()

    run(check())


def test_stop_tree_kills_children(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            started = await executor.start(shell_spec("sleep 300 & echo $!; wait"))
            child = await pid_from_output(executor, started.process_id)
            assert pid_alive(child)
            stopped = await executor.stop_tree(started.process_id, 5)
            assert stopped.state is ProcessState.STOPPED
            assert await wait_dead(child)
        finally:
            await executor.client.close()

    run(check())


def test_shell_kill_reaps_background_after_leader_exit_and_preserves_zero(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        bridge = LocalShellBridge(executor, root_id=ROOT_ID, root_location=workdir, owner=OWNER)
        try:
            result = await bridge.exec_command('orphan', workdir,
                '/bin/sleep 60 </dev/null >/dev/null 2>&1 & echo $!; exit 0')
            assert result.data['returncode'] == 0
            child = int(result.data['output'].strip())
            assert pid_alive(child)
            killed = await bridge.kill_process('orphan')
            assert killed.success and await wait_dead(child)
            assert killed.data['returncode'] == 0
            again = await bridge.kill_process('orphan')
            assert again.success and again.data['returncode'] == 0
        finally:
            await bridge.destroy()
            await executor.client.close()
    run(check())


def test_stop_tree_returns_running_when_ignored_then_kill_tree(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            started = await executor.start(shell_spec("trap '' TERM; echo $$; while true; do sleep 1; done"))
            leader = await pid_from_output(executor, started.process_id)
            assert (await executor.stop_tree(started.process_id, 0.3)).state is ProcessState.RUNNING
            killed = await executor.kill_tree(started.process_id)
            assert killed.state is ProcessState.KILLED
            assert await wait_dead(leader)
        finally:
            await executor.client.close()

    run(check())


def test_register_external_and_kill(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        leader = subprocess.Popen(["sh", "-c", "sleep 300 & echo $! ; wait"], start_new_session=True,
                                  stdout=subprocess.PIPE, text=True)
        child = int(leader.stdout.readline())
        # 不是组长的外部进程按后代树结束，不会波及它所在的进程组
        shared = subprocess.Popen(["sh", "-c", "sleep 300 & wait"])
        try:
            registered = await executor.register_external(leader.pid, ProcessOwner(operation_id="op-mcp"))
            assert registered.state is ProcessState.RUNNING
            killed = await executor.kill_tree(registered.process_id)
            assert killed.state is ProcessState.KILLED
            leader.wait(timeout=5)
            assert await wait_dead(child)

            tree = await executor.register_external(shared.pid, ProcessOwner(operation_id="op-mcp-2"))
            assert (await executor.kill_tree(tree.process_id)).state is ProcessState.KILLED
            shared.wait(timeout=5)
            assert os.getpgid(0) is not None  # 测试进程所在的进程组没有被终止

            with pytest.raises(Exception):
                await executor.register_external(os.getpid(), ProcessOwner(operation_id="op-self"))
        finally:
            for process in (leader, shared):
                if process.poll() is None:
                    process.kill()
                    process.wait()
            await executor.client.close()

    run(check())


def test_scrubbed_env_does_not_pass_secret(data_root, workdir, monkeypatch):
    monkeypatch.setenv("FAKE_SECRET", "top-secret-value")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")
    monkeypatch.setenv("PYTHONHOME", "/not/real")
    monkeypatch.setenv("DYLD_LIBRARY_PATH", "/not/real")
    monkeypatch.setenv("_PYI_APPLICATION_HOME_DIR", "/not/real")

    async def check():
        executor = await open_executor(data_root, workdir, ["/opt/managed/bin"])
        try:
            started = await executor.start(shell_spec("env", env={"EXPLICIT_VALUE": "yes"}))
            await executor.wait(started.process_id, 10)
            text = (await executor.read_output(started.process_id)).text
            assert "FAKE_SECRET" not in text and "top-secret-value" not in text
            for name in ("OPENAI_API_KEY", "PYTHONHOME", "DYLD_LIBRARY_PATH", "_PYI_"):
                assert name not in text
            assert "EXPLICIT_VALUE=yes" in text
            path_line = next(line for line in text.splitlines() if line.startswith("PATH="))
            assert path_line.startswith("PATH=/opt/managed/bin:")
        finally:
            await executor.client.close()

    run(check())


def test_scrub_env_helpers():
    source = {"PATH": "/evil", "HOME": "/h", "LANG": "C", "LC_ALL": "C", "FAKE_SECRET": "x", "MY_API_KEY": "k",
              "RAYAGENT_DATA_ROOT": "/d", "DYLD_FALLBACK_LIBRARY_PATH": "/x", "_PYI_ARCHIVE_FILE": "/a",
              "_MEIPASS2": "/m", "PYTHONHOME": "/p", "PYTHONPATH": "/q", "HTTPS_PROXY": "http://proxy:1"}
    scrubbed = execution_env.scrub_env(source, ["/rt/bin"])
    assert scrubbed == {"HOME": "/h", "LANG": "C", "LC_ALL": "C", "HTTPS_PROXY": "http://proxy:1",
                            "PATH": execution_env.managed_path(["/rt/bin"]), "PYTHONNOUSERSITE": "1",
                            "PYTHONDONTWRITEBYTECODE": "1"}
    assert execution_env.managed_path(["/rt/bin", "/usr/bin"]).split(os.pathsep)[:2] == ["/rt/bin", "/usr/bin"]
    assert execution_env.strip_pyinstaller_markers(source).keys() == {
        "PATH", "HOME", "LANG", "LC_ALL", "FAKE_SECRET", "MY_API_KEY", "RAYAGENT_DATA_ROOT", "HTTPS_PROXY"}
    merged = execution_env.build_process_env({"FAKE_SECRET": "explicit", "DYLD_X": "1"}, source=source)
    assert merged["FAKE_SECRET"] == "explicit" and "DYLD_X" not in merged and "MY_API_KEY" not in merged


def test_restart_does_not_revive_old_process_ids(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        started = await executor.start(shell_spec("echo $$; exec sleep 300"))
        old_pid = await pid_from_output(executor, started.process_id)
        old_supervisor = (await executor.ping())["pid"]
        await stop_supervisor(data_root)
        await executor.client.close()
        assert await wait_dead(old_pid, 15.0), "supervisor 停止时必须结束其进程树"
        assert await wait_dead(old_supervisor, 15.0)

        fresh = await open_executor(data_root, workdir)
        try:
            assert (await fresh.ping())["pid"] != old_supervisor
            for call in (fresh.status, fresh.read_output, fresh.kill_tree):
                with pytest.raises(UnknownProcess):
                    await call(started.process_id)
            with pytest.raises(UnknownProcess):
                await fresh.stop_tree(started.process_id, 1)
        finally:
            await fresh.client.close()

    run(check())


def test_client_disconnect_kills_trees_and_supervisor_exits(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        started = await executor.start(shell_spec("echo $$; exec sleep 300"))
        pid = await pid_from_output(executor, started.process_id)
        supervisor_pid = (await executor.ping())["pid"]
        await executor.client.close()
        assert await wait_dead(pid, 15.0), "客户端断开后进程树必须被结束"
        assert await wait_dead(supervisor_pid, 15.0), "最后一条附着连接断开后 supervisor 必须退出"
        assert await ping(socket_path_for(data_root)) is None

    run(check())


def test_ping_does_not_count_as_attached_client(data_root, workdir):
    async def check():
        socket_path = await ensure_supervisor(data_root)
        assert await ping(socket_path) is not None
        await asyncio.sleep(0.3)
        assert await ping(socket_path) is not None  # 只 ping 的连接断开不会停止 supervisor

    run(check())


def test_supervisor_runs_outside_core_process_group(data_root, workdir):
    async def check():
        executor = await open_executor(data_root, workdir)
        try:
            pid = (await executor.ping())["pid"]
            assert os.getpgid(pid) == pid != os.getpgid(0)
            assert os.path.exists(os.path.join(data_root, "execution", "supervisor.pid"))
        finally:
            await executor.client.close()

    run(check())


def test_shell_bridge_session_semantics(data_root, workdir, monkeypatch):
    monkeypatch.setattr(shell_bridge, "EXEC_FOREGROUND_SECONDS", 0.5)

    async def check():
        executor = await open_executor(data_root, workdir)
        bridge = LocalShellBridge(executor, root_id=ROOT_ID, root_location=workdir, owner=OWNER)
        try:
            done = await bridge.exec_command("a", workdir, "echo hi; exit 2")
            assert done.success and done.message == "success"
            assert done.data == {"session_id": "a", "command": "echo hi; exit 2", "status": "completed",
                                 "returncode": 2, "output": "hi\n"}

            missing = await bridge.exec_command("a", os.path.join(workdir, "nope"), "true")
            assert not missing.success and "目录不存在" in missing.message
            outside = await bridge.exec_command("a", "/tmp", "true")
            assert not outside.success

            running = await bridge.exec_command("b", workdir, "echo start; read line; echo got:$line; sleep 300")
            assert running.success and running.data["status"] == "running"
            waited = await bridge.wait_process("b", 1)
            assert not waited.success and "超时" in waited.message
            read = await bridge.read_shell_output("b", console=True)
            assert read.data["output"] == "start\n"
            assert [r["command"] for r in read.data["console_records"]] == [
                "echo start; read line; echo got:$line; sleep 300"]
            assert (await bridge.write_shell_input("b", "xyz", True)).data == {"status": "success"}
            await asyncio.sleep(0.5)
            assert "got:xyz" in (await bridge.read_shell_output("b")).data["output"]

            killed = await bridge.kill_process("b")
            assert killed.success and killed.data["status"] == "terminated"
            again = await bridge.kill_process("b")
            assert again.success and again.data["returncode"] == killed.data["returncode"]
            assert not (await bridge.write_shell_input("b", "x", True)).success

            replaced = await bridge.exec_command("b", workdir, "echo second")
            assert replaced.data["status"] == "completed" and replaced.data["output"] == "second\n"
            records = (await bridge.read_shell_output("b", console=True)).data["console_records"]
            assert [r["command"] for r in records][-1] == "echo second" and len(records) == 2
            assert records[0]["output"].startswith("start\n")

            missing_session = await bridge.read_shell_output("zzz")
            assert not missing_session.success and "不存在" in missing_session.message
            assert not (await bridge.kill_process("zzz")).success
        finally:
            await executor.client.close()

    run(check())


@pytest.mark.skipif(os.getenv('RAY_TEST_TOOL_RUNTIMES') != '1', reason='显式启用随包工具运行时检查')
def test_bundled_python_and_node_without_developer_path(data_root, workdir):
    from app.infrastructure.external.execution.runtime import runtime_bin_dirs
    async def check():
        bins = runtime_bin_dirs()
        assert len(bins) == 2, '先准备基础工具运行时'
        executor = await open_executor(data_root, workdir, bins)
        try:
            started = await executor.start(shell_spec(
                "python3 -c 'import sys,ssl,sqlite3,venv; print(sys.executable); print(6*7)' && "
                "node -e 'console.log(process.execPath); console.log(6*7)'"))
            done = await executor.wait(started.process_id, 20)
            assert done.exit_code == 0
            lines = (await executor.read_output(started.process_id)).text.splitlines()
            assert Path(lines[0]).parent == bins[0] and lines[1] == '42'
            assert Path(lines[2]).parent == bins[1] and lines[3] == '42'
            assert '/opt/homebrew' not in execution_env.managed_path(bins)
        finally:
            await executor.client.close()
    from pathlib import Path
    run(check())
