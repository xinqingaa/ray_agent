"""启动与回收执行 supervisor：独立会话（setsid），不进核心进程组。"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from app.infrastructure.external.execution.supervisor_client import SupervisorClient, SupervisorUnavailable

logger = logging.getLogger(__name__)

_children: dict[str, int] = {}  # socket → pid；不跨事件循环持有 Process 对象
_executor = None


def socket_path_for(data_root: str | Path) -> str:
    return str(Path(data_root) / "execution" / "supervisor.sock")


def pid_path_for(data_root: str | Path) -> Path:
    return Path(data_root) / "execution" / "supervisor.pid"


async def ping(socket_path: str) -> dict | None:
    client = SupervisorClient(socket_path)
    try:
        return await client.call("ping", timeout=1.0)
    except Exception:
        return None
    finally:
        await client.close()


async def ensure_supervisor(data_root: str | Path, runtime_bin_dirs: list | tuple = ()) -> str:
    """确保 supervisor 在跑，返回套接字路径。短路径数据根避免 macOS 套接字路径超长。"""
    root = Path(data_root)
    (root / "execution").mkdir(parents=True, exist_ok=True)
    sock = socket_path_for(root)
    if await ping(sock) is not None:
        return sock
    Path(sock).unlink(missing_ok=True)
    command = [
        sys.executable, "-m", "app.infrastructure.external.execution.supervisor_server",
        "--socket", sock,
        "--pid-file", str(pid_path_for(root)),
        "--core-pid", str(os.getpid()),
    ]
    for path in runtime_bin_dirs or ():
        command.extend(["--runtime-bin", str(path)])
    # supervisor 自身是核心解释器进程，仍需清掉测试／宿主注入的 PYTHONHOME 等，否则无法启动
    from app.infrastructure.external.execution.env import strip_pyinstaller_markers
    child_env = strip_pyinstaller_markers(os.environ)
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONSAFEPATH", "VIRTUAL_ENV"):
        child_env.pop(key, None)
    log_path = root / "execution" / "supervisor.log"
    with open(log_path, "ab") as log:
        # Popen 而非 asyncio 子进程：supervisor 的生命周期不绑定在某个事件循环上
        proc = subprocess.Popen(
            command,
            cwd=str(Path(__file__).resolve().parents[4]),
            env=child_env,
            start_new_session=True,  # setsid：不在核心进程组内
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            close_fds=True,
        )
    _children[sock] = proc.pid
    threading.Thread(target=proc.wait, name="execution-supervisor-reaper", daemon=True).start()  # 退出后回收，不留僵尸
    for _ in range(100):
        if await ping(sock) is not None:
            logger.info("执行 supervisor 已启动 pid=%s socket=%s", proc.pid, sock)
            return sock
        if proc.poll() is not None:
            raise RuntimeError(f"执行 supervisor 启动失败（退出码 {proc.returncode}），日志见 {log_path}")
        await asyncio.sleep(0.1)
    raise RuntimeError("执行 supervisor 启动后未能握手")


def _signal_stop(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            return
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
            time.sleep(0.05)
        except OSError:
            return
    try:
        os.killpg(pid, signal.SIGKILL)
    except OSError:
        pass


async def stop_supervisor(data_root: str | Path | None = None) -> None:
    """停止指定数据根上的 supervisor；未传时停止本进程拉起的全部。"""
    targets: list[str] = []
    if data_root is not None:
        targets.append(socket_path_for(data_root))
    else:
        targets.extend(list(_children))
    for sock in targets:
        client = SupervisorClient(sock)
        try:
            await client.call("shutdown", timeout=3.0)
        except Exception:
            pass
        finally:
            await client.close()
        pid = _children.pop(sock, None)
        if pid is None and data_root is not None:
            pid = read_supervisor_pid(data_root)
        if pid is not None:
            await asyncio.to_thread(_signal_stop, pid)
        Path(sock).unlink(missing_ok=True)
        if data_root is not None:
            pid_path_for(data_root).unlink(missing_ok=True)


def configure_executor(executor) -> None:
    global _executor
    _executor = executor


def get_executor():
    return _executor


async def shutdown_executor() -> None:
    global _executor
    if _executor is not None:
        try:
            await _executor.shutdown()
        except Exception:
            pass
        _executor = None


def read_supervisor_pid(data_root: str | Path) -> int | None:
    try:
        text = pid_path_for(data_root).read_text(encoding="utf-8").strip()
        return int(text) if text else None
    except (OSError, ValueError):
        return None


def kill_supervisor_from_host(data_root: str | Path, grace_seconds: float = 3.0) -> None:
    pid = read_supervisor_pid(data_root)
    sock = Path(socket_path_for(data_root))
    pid_file = pid_path_for(data_root)
    if pid is None:
        sock.unlink(missing_ok=True)
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            sock.unlink(missing_ok=True)
            pid_file.unlink(missing_ok=True)
            return
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
            time.sleep(0.05)
        except OSError:
            break
    else:
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            pass
    sock.unlink(missing_ok=True)
    pid_file.unlink(missing_ok=True)
