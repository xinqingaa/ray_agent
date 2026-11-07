"""本机执行 supervisor：独立进程，经 Unix 域套接字接收行分隔 JSON 请求，管理进程身份与进程树。

协议：每行一个 JSON 对象。请求 `{"id", "method", "params"}`，响应 `{"id", "result"}` 或 `{"id", "error": {"code", "message"}}`。
每个启动的进程拥有独立 POSIX 会话，process_id 只在本 supervisor 的生命周期内有效，重启后不认领任何旧 PID。

生命周期：除 ping 外发过请求的连接视为“已附着”；所有已附着连接都断开、核心进程消失、收到 shutdown 或终止信号时，
supervisor 强制结束全部已登记的进程树并退出。
"""
import argparse
import asyncio
import codecs
import contextlib
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

if __package__:
    from .env import build_process_env, detect_posix_shell, shell_flags
else:  # 作为脚本直接运行时与 env.py 同目录
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from env import build_process_env, detect_posix_shell, shell_flags  # type: ignore[no-redef]

logger = logging.getLogger("execution.supervisor")

OUTPUT_LIMIT_CHARS = 1024 * 1024  # 单个进程在内存中保留的输出尾部上限（按字符计）
STREAM_LIMIT_BYTES = 16 * 1024 * 1024  # 单行请求或响应的大小上限
PARENT_POLL_SECONDS = 1.0
KILL_CONFIRM_SECONDS = 3.0  # 强制结束后等待确认进程树消失的期限
DRAIN_AFTER_EXIT_SECONDS = 1.0  # 外壳退出后等待输出管道排空的期限；后台子进程可能一直持有管道
POLL_SECONDS = 0.05
MAX_RETAINED_PROCESSES = 512
ALREADY_RUNNING_EXIT = 3  # 已有 supervisor 在监听同一路径

STATE_RUNNING = "running"
STATE_EXITED = "exited"
STATE_STOPPED = "stopped"
STATE_KILLED = "killed"
STATE_LOST = "lost"


class RpcError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- 进程表快照与信号 -------------------------------------------------------------------------------------------

def _snapshot() -> list[tuple[int, int, int, str]]:
    """（pid, ppid, pgid, stat）列表；ps 不可用时为空。"""
    try:
        output = subprocess.check_output(["ps", "-ax", "-o", "pid=,ppid=,pgid=,stat="], text=True,
                                         stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return []
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3]))
        except ValueError:
            continue
    return rows


def _is_zombie(stat: str) -> bool:
    return stat.startswith(("Z", "z"))


def _descendants(root_pid: int, rows: list[tuple[int, int, int, str]]) -> list[int]:
    children: dict[int, list[int]] = {}
    for pid, ppid, _pgid, _stat in rows:
        children.setdefault(ppid, []).append(pid)
    found, queue = [], [root_pid]
    while queue:
        for child in children.get(queue.pop(), []):
            found.append(child)
            queue.append(child)
    return found


def _signal_pid(pid: int, sig: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.kill(pid, sig)


def _signal_group(pgid: int, sig: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pgid, sig)


# ---- 受管进程 ---------------------------------------------------------------------------------------------------

@dataclass
class Managed:
    process_id: str
    pid: int
    pgid: int
    owner: dict[str, Any]
    interactive: bool
    external: bool = False
    group_mode: bool = True  # 外部进程不是组长时改为按后代进程逐个发信号
    proc: Optional[asyncio.subprocess.Process] = None
    state: str = STATE_RUNNING
    exit_code: Optional[int] = None
    started_at: str = field(default_factory=_now)
    ended_at: Optional[str] = None
    chunks: deque = field(default_factory=deque)
    buffered: int = 0
    base: int = 0  # chunks 首字符对应的累计输出偏移
    tree_gone: bool = False  # 已确认进程树消失，之后不再向该 pgid 发信号，避免误伤复用者
    drain_timed_out: bool = False
    exited: asyncio.Event = field(default_factory=asyncio.Event)
    tasks: list = field(default_factory=list)

    def append(self, text: str) -> None:
        if not text:
            return
        self.chunks.append(text)
        self.buffered += len(text)
        while self.buffered > OUTPUT_LIMIT_CHARS:
            first = self.chunks[0]
            overflow = self.buffered - OUTPUT_LIMIT_CHARS
            if overflow >= len(first):
                self.chunks.popleft()
                self.buffered -= len(first)
                self.base += len(first)
            else:
                self.chunks[0] = first[overflow:]
                self.buffered -= overflow
                self.base += overflow

    @property
    def total(self) -> int:
        return self.base + self.buffered

    def status(self) -> dict[str, Any]:
        return {"process_id": self.process_id, "state": self.state, "exit_code": self.exit_code,
                "started_at": self.started_at, "ended_at": self.ended_at}


class Supervisor:
    def __init__(self, runtime_bin_dirs: list[str], core_pid: Optional[int]) -> None:
        self.runtime_bin_dirs = runtime_bin_dirs
        self.core_pid = core_pid
        self.shell = detect_posix_shell()
        self.processes: dict[str, Managed] = {}
        self.stop_event = asyncio.Event()
        self.stop_reason = ""
        self._attached = 0
        self._kill_lock = asyncio.Lock()
        self._own_pgid = os.getpgid(0)
        self._core_pgid = self._pgid_of(core_pid) if core_pid else None

    @staticmethod
    def _pgid_of(pid: Optional[int]) -> Optional[int]:
        try:
            return os.getpgid(pid) if pid else None
        except OSError:
            return None

    def request_stop(self, reason: str) -> None:
        if not self.stop_event.is_set():
            self.stop_reason = reason
            self.stop_event.set()

    # ---- 存活判断与终止 ----

    def _tree_alive_sync(self, m: Managed) -> bool:
        """进程树里是否还有未退出的进程；僵尸进程不算。"""
        if m.group_mode:
            try:
                os.killpg(m.pgid, 0)
            except ProcessLookupError:
                return False
            except PermissionError:
                pass
            rows = _snapshot()
            if not rows:
                return True
            return any(pgid == m.pgid and not _is_zombie(stat) for _pid, _ppid, pgid, stat in rows)
        rows = _snapshot()
        if not rows:
            try:
                os.kill(m.pid, 0)
            except ProcessLookupError:
                return False
            return True
        pids = {m.pid, *_descendants(m.pid, rows)}
        return any(pid in pids and not _is_zombie(stat) for pid, _ppid, _pgid, stat in rows)

    async def _tree_alive(self, m: Managed) -> bool:
        if m.tree_gone:
            return False
        alive = await asyncio.to_thread(self._tree_alive_sync, m)
        if not alive:
            m.tree_gone = True
        return alive

    def _signal_tree(self, m: Managed, sig: int) -> None:
        if m.tree_gone:
            return
        if m.group_mode:
            _signal_group(m.pgid, sig)
            return
        for pid in [*_descendants(m.pid, _snapshot()), m.pid]:
            _signal_pid(pid, sig)

    def _mark_ended(self, m: Managed) -> None:
        if m.ended_at is None:
            m.ended_at = _now()

    async def _confirm_gone(self, m: Managed, seconds: float, sig: Optional[int]) -> bool:
        """在期限内等待进程树消失；sig 不为空时每轮重发（覆盖期间新派生的进程）。"""
        deadline = time.monotonic() + seconds
        while True:
            if not await self._tree_alive(m):
                return True
            if time.monotonic() >= deadline:
                return False
            if sig is not None:
                self._signal_tree(m, sig)
            await asyncio.sleep(POLL_SECONDS)

    async def _settle_leader(self, m: Managed) -> None:
        """树已消失后给领导进程一点时间被回收，以便拿到退出码。"""
        if m.proc is not None and not m.exited.is_set():
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(m.exited.wait(), 2.0)

    async def stop_tree(self, m: Managed, grace: float) -> dict[str, Any]:
        if m.tree_gone or not await self._tree_alive(m):
            await self._settle_leader(m)
            self._refresh_external(m)
            return m.status()
        self._signal_tree(m, signal.SIGTERM)
        if await self._confirm_gone(m, max(grace, 0.0), None):
            await self._settle_leader(m)
            self._finalize(m, STATE_STOPPED)
            return m.status()
        status = m.status()
        status["state"] = STATE_RUNNING  # 期限内未退出：交给调用方决定是否强制结束
        return status

    async def kill_tree(self, m: Managed) -> dict[str, Any]:
        if m.tree_gone or not await self._tree_alive(m):
            await self._settle_leader(m)
            self._refresh_external(m)
            return m.status()
        self._signal_tree(m, signal.SIGKILL)
        if await self._confirm_gone(m, KILL_CONFIRM_SECONDS, signal.SIGKILL):
            await self._settle_leader(m)
            self._finalize(m, STATE_KILLED)
        else:
            m.state = STATE_LOST
            self._mark_ended(m)
        return m.status()

    def _finalize(self, m: Managed, state: str) -> None:
        m.state = state
        self._mark_ended(m)
        m.exited.set()

    def _refresh_external(self, m: Managed) -> None:
        if m.external and m.state == STATE_RUNNING and m.tree_gone:
            m.state = STATE_EXITED
            self._mark_ended(m)
            m.exited.set()

    # ---- 输出与等待任务 ----

    async def _pump(self, m: Managed) -> None:
        assert m.proc is not None and m.proc.stdout is not None
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            while True:
                data = await m.proc.stdout.read(65536)
                if not data:
                    break
                m.append(decoder.decode(data))
        except Exception as exc:  # 读取失败不应拖垮 supervisor
            logger.warning("读取进程 %s 输出失败: %s", m.process_id, exc)
        m.append(decoder.decode(b"", final=True))

    async def _reap(self, m: Managed) -> None:
        assert m.proc is not None
        code = await m.proc.wait()
        m.exit_code = code
        if m.state == STATE_RUNNING:
            m.state = STATE_EXITED
        self._mark_ended(m)
        m.exited.set()
        await self._tree_alive(m)  # 外壳退出时树已空就立即记下，防止之后 pgid 被无关进程复用

    async def _drain(self, m: Managed) -> None:
        if m.proc is None or m.drain_timed_out or not m.tasks:
            return
        pump = m.tasks[0]
        if pump.done():
            return
        done, _ = await asyncio.wait({pump}, timeout=DRAIN_AFTER_EXIT_SECONDS)
        if not done:
            m.drain_timed_out = True

    async def _poll_external(self, m: Managed) -> None:
        while m.state == STATE_RUNNING and not m.tree_gone:
            await self._tree_alive(m)
            if m.tree_gone:
                break
            await asyncio.sleep(0.2)
        self._refresh_external(m)

    # ---- 方法 ----

    def _get(self, params: dict[str, Any]) -> Managed:
        process_id = params.get("process_id")
        m = self.processes.get(process_id) if isinstance(process_id, str) else None
        if m is None:
            raise RpcError("unknown_process", f"进程不存在或已不属于当前 supervisor: {process_id}")
        return m

    def _evict(self) -> None:
        if len(self.processes) <= MAX_RETAINED_PROCESSES:
            return
        for process_id, m in list(self.processes.items()):
            if len(self.processes) <= MAX_RETAINED_PROCESSES:
                break
            if m.state != STATE_RUNNING and m.tree_gone:
                del self.processes[process_id]

    async def m_ping(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"pid": os.getpid(), "core_pid": self.core_pid, "shell": self.shell,
                "processes": len(self.processes)}

    async def m_start(self, params: dict[str, Any]) -> dict[str, Any]:
        argv, command = params.get("argv"), params.get("shell_command")
        if (argv is None) == (command is None):
            raise RpcError("bad_request", "argv 与 shell_command 必须且只能给出一个")
        if command is not None:
            argv = [self.shell, *shell_flags(self.shell), "-c", command]
        if not isinstance(argv, list) or not argv or not all(isinstance(item, str) for item in argv):
            raise RpcError("bad_request", "argv 必须是非空字符串列表")
        cwd = params.get("cwd")
        if not isinstance(cwd, str) or not os.path.isdir(cwd):
            raise RpcError("cwd_missing", f"工作目录不存在: {cwd}")
        owner = params.get("owner") or {}
        if not (owner.get("run_id") or owner.get("operation_id")):
            raise RpcError("bad_request", "进程必须归属于运行或操作")
        interactive = bool(params.get("interactive"))
        env = build_process_env(params.get("env") or {}, self.runtime_bin_dirs)
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, cwd=cwd, env=env,
                stdin=asyncio.subprocess.PIPE if interactive else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                start_new_session=True, limit=STREAM_LIMIT_BYTES)
        except OSError as exc:
            raise RpcError("start_failed", f"无法启动进程: {exc}")
        m = Managed(process_id=uuid.uuid4().hex, pid=proc.pid, pgid=proc.pid, owner=owner,
                    interactive=interactive, proc=proc)
        m.tasks = [asyncio.create_task(self._pump(m)), asyncio.create_task(self._reap(m))]
        self.processes[m.process_id] = m
        self._evict()
        return m.status()

    async def m_register_external(self, params: dict[str, Any]) -> dict[str, Any]:
        pid, owner = params.get("pid"), params.get("owner") or {}
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1:
            raise RpcError("bad_request", "pid 无效")
        if not (owner.get("run_id") or owner.get("operation_id")):
            raise RpcError("bad_request", "进程必须归属于运行或操作")
        if pid in (os.getpid(), self.core_pid):
            raise RpcError("bad_request", "不能登记核心或 supervisor 自身")
        try:
            os.kill(pid, 0)
            pgid = os.getpgid(pid)
        except ProcessLookupError:
            raise RpcError("not_running", f"进程不存在: {pid}")
        except PermissionError:
            raise RpcError("forbidden", f"无权操作进程: {pid}")
        group_mode = pgid == pid
        if pgid in (self._own_pgid, self._core_pgid) and group_mode:
            raise RpcError("bad_request", "不能登记核心或 supervisor 所在的进程组")
        m = Managed(process_id=uuid.uuid4().hex, pid=pid, pgid=pgid, owner=owner, interactive=False,
                    external=True, group_mode=group_mode)
        m.tasks = [asyncio.create_task(self._poll_external(m))]
        self.processes[m.process_id] = m
        self._evict()
        return m.status()

    async def m_status(self, params: dict[str, Any]) -> dict[str, Any]:
        m = self._get(params)
        self._refresh_external(m)
        return m.status()

    async def m_read_output(self, params: dict[str, Any]) -> dict[str, Any]:
        m = self._get(params)
        offset = params.get("offset", 0)
        if not isinstance(offset, int) or offset < 0:
            raise RpcError("bad_request", "offset 必须是非负整数")
        if m.exited.is_set():
            await self._drain(m)
        truncated = offset < m.base
        start = max(offset, m.base) - m.base
        text = "".join(m.chunks)[start:] if m.chunks else ""
        return {"process_id": m.process_id, "stream": "combined", "text": text,
                "next_offset": m.total, "truncated": truncated}

    async def m_write_input(self, params: dict[str, Any]) -> dict[str, Any]:
        m = self._get(params)
        text = params.get("text")
        if not isinstance(text, str):
            raise RpcError("bad_request", "text 必须是字符串")
        if m.state != STATE_RUNNING or m.proc is None or m.proc.stdin is None or m.proc.stdin.is_closing():
            raise RpcError("not_running", "进程未在运行或没有保留标准输入")
        try:
            m.proc.stdin.write(text.encode("utf-8"))
            await m.proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise RpcError("not_running", f"标准输入已关闭: {exc}")
        if params.get("echo", True):
            m.append(text)
        return {}

    async def m_wait(self, params: dict[str, Any]) -> dict[str, Any]:
        m = self._get(params)
        timeout = params.get("timeout_seconds")
        if m.external:
            deadline = None if timeout is None else time.monotonic() + float(timeout)
            while m.state == STATE_RUNNING and (deadline is None or time.monotonic() < deadline):
                await asyncio.sleep(0.1)
            return m.status()
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(m.exited.wait(), None if timeout is None else float(timeout))
        if m.exited.is_set():
            await self._drain(m)
        return m.status()

    async def m_stop_tree(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.stop_tree(self._get(params), float(params.get("grace_seconds", 3.0)))

    async def m_kill_tree(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.kill_tree(self._get(params))

    async def m_shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        # 先杀进程树再应答，避免客户端随后强制结束 supervisor 时留下孤儿。
        self.request_stop("shutdown 请求")
        await self.kill_all()
        return {}

    # ---- 连接与分派 ----

    async def kill_all(self) -> None:
        async with self._kill_lock:
            running = [m for m in self.processes.values() if not m.tree_gone]
            if not running:
                return
            for m in running:
                self._signal_tree(m, signal.SIGKILL)
            await asyncio.gather(*(self.kill_tree(m) for m in running), return_exceptions=True)

    async def handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        write_lock = asyncio.Lock()
        pending: set[asyncio.Task] = set()
        attached = False

        async def respond(payload: dict[str, Any]) -> None:
            data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            async with write_lock:
                writer.write(data)
                with contextlib.suppress(ConnectionError):
                    await writer.drain()

        async def serve(request_id: Any, method: str, params: dict[str, Any]) -> None:
            handler: Optional[Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]] = getattr(
                self, f"m_{method}", None) if method.isidentifier() else None
            try:
                if handler is None:
                    raise RpcError("unknown_method", f"未知方法: {method}")
                result = await handler(params)
                await respond({"id": request_id, "result": result})
            except RpcError as exc:
                await respond({"id": request_id, "error": {"code": exc.code, "message": exc.message}})
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("方法 %s 执行失败", method)
                await respond({"id": request_id, "error": {"code": "internal", "message": str(exc)}})

        try:
            while True:
                try:
                    line = await reader.readline()
                except (asyncio.LimitOverrunError, ValueError):
                    break
                if not line:
                    break
                try:
                    request = json.loads(line)
                    request_id, method = request["id"], request["method"]
                    params = request.get("params") or {}
                    if not isinstance(method, str) or not isinstance(params, dict):
                        raise ValueError
                except (ValueError, KeyError, TypeError):
                    await respond({"id": None, "error": {"code": "bad_request", "message": "请求格式无效"}})
                    continue
                if method != "ping" and not attached:
                    attached = True
                    self._attached += 1
                task = asyncio.create_task(serve(request_id, method, params))
                pending.add(task)
                task.add_done_callback(pending.discard)
        finally:
            for task in pending:
                task.cancel()
            with contextlib.suppress(Exception):
                writer.close()
            if attached:
                self._attached -= 1
                if self._attached == 0:
                    # 立即清树，避免只靠 serve() 收尾时与 wait 竞态
                    self.request_stop("客户端断开")
                    asyncio.create_task(self.kill_all())

    async def watch_core(self) -> None:
        if not self.core_pid:
            return
        while not self.stop_event.is_set():
            try:
                os.kill(self.core_pid, 0)
            except ProcessLookupError:
                self.request_stop(f"核心进程 {self.core_pid} 已退出")
                return
            except PermissionError:
                pass
            await asyncio.sleep(PARENT_POLL_SECONDS)


def _socket_in_use(path: str) -> bool:
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        probe.connect(path)
        return True
    except OSError:
        return False
    finally:
        probe.close()


async def serve(socket_path: str, pid_file: Optional[str], core_pid: Optional[int],
                runtime_bin_dirs: list[str]) -> int:
    if os.path.exists(socket_path):
        if _socket_in_use(socket_path):
            logger.error("已有 supervisor 在监听 %s", socket_path)
            return ALREADY_RUNNING_EXIT
        os.unlink(socket_path)
    os.makedirs(os.path.dirname(socket_path), mode=0o700, exist_ok=True)
    supervisor = Supervisor(runtime_bin_dirs, core_pid)
    old_umask = os.umask(0o177)
    try:
        server = await asyncio.start_unix_server(supervisor.handle_connection, path=socket_path,
                                                 limit=STREAM_LIMIT_BYTES)
    finally:
        os.umask(old_umask)
    os.chmod(socket_path, 0o600)
    if pid_file:
        with open(pid_file, "w", encoding="utf-8") as handle:
            handle.write(str(os.getpid()))

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        loop.add_signal_handler(sig, supervisor.request_stop, f"收到信号 {sig.name}")
    watcher = asyncio.create_task(supervisor.watch_core())
    logger.info("supervisor 已就绪 pid=%s socket=%s", os.getpid(), socket_path)
    await supervisor.stop_event.wait()
    logger.info("supervisor 停止: %s", supervisor.stop_reason)
    watcher.cancel()
    server.close()
    await supervisor.kill_all()
    with contextlib.suppress(OSError):
        os.unlink(socket_path)
    if pid_file:
        with contextlib.suppress(OSError):
            with open(pid_file, encoding="utf-8") as handle:
                if handle.read().strip() == str(os.getpid()):
                    os.unlink(pid_file)
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="RayAgent 本机执行 supervisor")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--pid-file")
    parser.add_argument("--core-pid", type=int)
    parser.add_argument("--runtime-bin", action="append", default=[])
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    return asyncio.run(serve(args.socket, args.pid_file, args.core_pid, args.runtime_bin))


if __name__ == "__main__":
    sys.exit(main())
