"""应用内轻量服务与项目预览：持久化重开、真实 Supervisor 启停与健康检查、增量日志、失败清理、安全围栏、工具策略、生命周期回收与 ZIP 导出。"""
from __future__ import annotations

import asyncio
import io
import os
import shlex
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.application.services.agent_service import AgentService, pending_starts
from app.application.services.background_jobs import BackgroundJobRunner
from app.application.services.data_service import RESET_CONFIRMATION, DataService, data_cleanup_handler
from app.application.services.preview_runtime_service import PreviewRuntimeService
from app.application.services.root_access import RootBindings
from app.application.services.session_service import SessionService
from app.application.services.workspace_service import WorkspaceService, workspace_delete_handler
from app.domain.external.workspace_files import FileLimits
from app.domain.models.app_config import AgentConfig, ToolPolicy, ToolPolicyConfig
from app.domain.models.error import ErrorCode
from app.domain.models.event import ApprovalEvent, ApprovalStatus, PreviewEvent, ToolEvent
from app.domain.models.operation import OperationKind, OperationStatus
from app.domain.models.run import RunStatus
from app.domain.models.session import SessionStatus
from app.domain.services.file_scope import WriteOwner
from app.domain.models.capability import CapabilityState
from app.domain.services.prompts.system import Capability, CapabilityStatus, RuntimeEnvironment
from app.domain.services.tool_policy import builtin_tool_catalog, resolve_policy
from app.domain.services.tools.preview import PreviewTool
from app.infrastructure.external.execution.process_executor import SupervisedProcessExecutor
from app.infrastructure.external.execution.supervisor_client import SupervisorClient
from app.infrastructure.external.execution.supervisor_lifecycle import ensure_supervisor, stop_supervisor
from app.infrastructure.external.file_storage.local_file_storage import LocalFileStorage
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from app.interfaces.endpoints.managed_preview_routes import router as managed_preview_router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_preview_runtime_service
from core.config import Settings, get_settings
from tests.core.test_sqlite_storage import read as read_session_records
from tests.core.test_workspaces import Env, INSTALL
from tests.support.loop_harness import input_task, make_loop, make_runner, start_run
from tests.support.scripted_llm import text, tool_call
from tests.support.sqlite_db import with_database


_HTTP_SERVER_SCRIPT = """import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PID_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.pid")
with open(PID_PATH, "w", encoding="utf-8") as fp:
    fp.write(str(os.getpid()))

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "pid": os.getpid()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/hit":
            print("HIT_ENDPOINT_CALLED", flush=True)
            body = b"hit-ok"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        body = b"<!doctype html><html><body><h1>Shift Tool</h1></body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

host = os.environ.get("HOST", "127.0.0.1")
port = int(os.environ["PORT"])
srv = ThreadingHTTPServer((host, port), Handler)
print(f"SERVICE_READY pid={os.getpid()} port={port}", flush=True)
srv.serve_forever()
"""


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def _wait_dead(pid: int, seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return True
        await asyncio.sleep(0.05)
    return False


async def _build_preview_stack(
    tmp_path: Path,
    uow_factory,
    read_factory,
    *,
    standalone_execution: bool = False,
    settings_override: Settings | None = None,
    jobs: BackgroundJobRunner | None = None,
):
    exec_root = tempfile.mkdtemp(prefix="ra-prev-", dir="/tmp")
    env = Env(tmp_path, uow_factory, read_factory, jobs=jobs)
    bindings = RootBindings(read_factory, env.data)
    root_files = PosixWorkspaceFiles(bindings, FileLimits())
    holder: dict[str, object] = {"executor": None, "standalone": standalone_execution, "settings": settings_override or get_settings()}

    async def get_executor():
        if holder["executor"] is None:
            sock = await ensure_supervisor(exec_root)
            holder["executor"] = SupervisedProcessExecutor(SupervisorClient(sock))
        return holder["executor"]

    async def command_probe():
        return True, "local shell available"

    async def load_config():
        return SimpleNamespace(agent_config=AgentConfig(standalone_execution_enabled=bool(holder["standalone"])))

    previews = PreviewRuntimeService(
        uow_factory=uow_factory,
        read_uow_factory=read_factory,
        root_files=root_files,
        root_bindings=bindings,
        executor_provider=get_executor,
        command_available_probe=command_probe,
        app_config_loader=load_config,
        settings_provider=lambda: holder["settings"],
    )
    workspaces = WorkspaceService(
        uow_factory=uow_factory,
        read_uow_factory=read_factory,
        folders=env.folders,
        policy=env.policy,
        runtime=env.runtime,
        install_id=INSTALL,
        default_location=str(env.default),
        jobs=jobs,
        previews=previews,
    )
    sessions = SessionService(uow_factory, read_factory, workdirs=env.workdirs, jobs=jobs, previews=previews)

    async def cleanup():
        try:
            await previews.stop_all()
        finally:
            if holder["executor"] is not None:
                await holder["executor"].client.close()
            await stop_supervisor(exec_root)
            shutil.rmtree(exec_root, ignore_errors=True)

    return SimpleNamespace(
        env=env,
        previews=previews,
        workspaces=workspaces,
        sessions=sessions,
        bindings=bindings,
        root_files=root_files,
        exec_root=exec_root,
        holder=holder,
        get_executor=get_executor,
        load_config=load_config,
        cleanup=cleanup,
    )


def _write_http_project(project_dir: Path) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "server.py").write_text(_HTTP_SERVER_SCRIPT, encoding="utf-8")


def _caps(*items: Capability) -> RuntimeEnvironment:
    return RuntimeEnvironment(capabilities={cap: CapabilityStatus(capability=cap, state=CapabilityState.AVAILABLE) for cap in items})


def test_register_idempotency_static_and_managed_service_lifecycle_with_supervisor(tmp_path):
    async def run(uow_factory, read_factory, _db):
        stack = await _build_preview_stack(tmp_path, uow_factory, read_factory)
        try:
            ws = await stack.workspaces.create("排班工作区")
            ws = await stack.workspaces.set_local_execution(ws.workspace.id, True, ws.workspace.version)
            folder = Path(ws.folder.location)
            root_id = ws.folder.ref.root_id
            session = await stack.sessions.create_session(workspace_id=ws.workspace.id)

            # 1. 静态单文件登记与幂等更新
            (folder / "portal.html").write_text("<!doctype html><html><body>Portal</body></html>", encoding="utf-8")
            static_view, tail, err = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="静态门户 v1",
                kind="static",
                root_id=root_id,
                relative_path="portal.html",
            )
            assert err is None and tail == ""
            assert static_view.kind == "static" and static_view.state == "ready" and static_view.preview_url is None

            static_v2, _, err2 = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="静态门户 v2",
                kind="static",
                root_id=root_id,
                relative_path="portal.html",
            )
            assert err2 is None and static_v2.id == static_view.id and static_v2.name == "静态门户 v2"
            with pytest.raises(BadRequestError):
                await stack.previews.start(static_view.id)

            # 2. 轻量服务登记 -> 自动启动 -> 回环健康检查 -> 真实 HTTP 访问与增量日志
            app_dir = folder / "shift_tool"
            _write_http_project(app_dir)
            cmd = f"{shlex.quote(sys.executable)} server.py"
            svc_view, svc_tail, svc_err = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="班表小工具",
                kind="service",
                root_id=root_id,
                relative_path="shift_tool",
                start_command=cmd,
                health_path="/health",
            )
            assert svc_err is None
            assert svc_view.state == "running" and svc_view.port and svc_view.preview_url == f"http://127.0.0.1:{svc_view.port}/"
            assert "SERVICE_READY" in svc_tail
            pid1 = int((app_dir / "server.pid").read_text(encoding="utf-8"))
            assert _pid_alive(pid1)

            async with httpx.AsyncClient(trust_env=False) as client:
                home_resp = await client.get(svc_view.preview_url)
                assert home_resp.status_code == 200 and "Shift Tool" in home_resp.text
                logs_initial = await stack.previews.read_logs(svc_view.id, offset=0)
                assert "SERVICE_READY" in logs_initial.text and logs_initial.next_offset > 0

                hit_resp = await client.get(f"http://127.0.0.1:{svc_view.port}/hit")
                assert hit_resp.status_code == 200

            # 增量偏移只返回新增日志
            tail_seen = ""
            offset = logs_initial.next_offset
            for _ in range(20):
                delta = await stack.previews.read_logs(svc_view.id, offset=offset)
                tail_seen += delta.text
                offset = delta.next_offset
                if "HIT_ENDPOINT_CALLED" in tail_seen:
                    break
                await asyncio.sleep(0.05)
            assert "HIT_ENDPOINT_CALLED" in tail_seen and "SERVICE_READY" not in tail_seen

            # 3. 预览服务运行时不独占工作区 WriteLease，其它写入者可正常写工作区
            lease = await stack.env.leases().acquire(ws.workspace.id, WriteOwner(session.id, "run-write"), "正常编辑工作区")
            assert lease is not None
            await stack.env.leases().release(lease)

            # 4. 重复登记同名目录保持一条记录（先停止旧进程再按新声明重启）
            svc_updated, _, svc_err2 = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="班表小工具（升级版）",
                kind="service",
                root_id=root_id,
                relative_path="shift_tool",
                start_command=cmd,
                health_path="/health",
            )
            assert svc_err2 is None and svc_updated.id == svc_view.id
            assert await _wait_dead(pid1)
            pid2 = int((app_dir / "server.pid").read_text(encoding="utf-8"))
            assert pid2 != pid1 and _pid_alive(pid2)
            assert len(await stack.previews.list_previews(session_id=session.id)) == 2

            # 5. 模拟应用重启：新建运行时实例读持久表，状态为 stopped（绝不虚报 running）
            fresh = PreviewRuntimeService(
                uow_factory=uow_factory,
                read_uow_factory=read_factory,
                root_files=stack.root_files,
                root_bindings=stack.bindings,
                executor_provider=stack.get_executor,
                command_available_probe=lambda: asyncio.sleep(0, result=(True, "ok")),
                app_config_loader=stack.load_config,
            )
            reopened_list = await fresh.list_previews(workspace_id=ws.workspace.id)
            by_id = {item.id: item for item in reopened_list}
            assert by_id[svc_view.id].state == "stopped" and by_id[svc_view.id].port is None

            # 6. restart 与 stop 均准确更换/终止进程树
            restarted = await stack.previews.restart(svc_view.id)
            assert restarted.state == "running" and await _wait_dead(pid2)
            pid3 = int((app_dir / "server.pid").read_text(encoding="utf-8"))
            assert pid3 != pid2 and _pid_alive(pid3)

            stopped = await stack.previews.stop(svc_view.id)
            assert stopped.state == "stopped" and stopped.port is None and await _wait_dead(pid3)

            # 7. 模拟应用退出 / Supervisor 关闭：未显式 stop 的预览子进程随 Supervisor 一起回收
            restarted_again = await stack.previews.start(svc_view.id)
            assert restarted_again.state == "running"
            pid4 = int((app_dir / "server.pid").read_text(encoding="utf-8"))
            assert _pid_alive(pid4)
            await stop_supervisor(stack.exec_root)
            assert await _wait_dead(pid4)
        finally:
            await stack.cleanup()

    with_database(tmp_path, run, timeout=60)


def test_managed_preview_startup_failure_and_timeout_cleanup(tmp_path):
    async def run(uow_factory, read_factory, _db):
        stack = await _build_preview_stack(tmp_path, uow_factory, read_factory)
        try:
            ws = await stack.workspaces.create("故障排查")
            ws = await stack.workspaces.set_local_execution(ws.workspace.id, True, ws.workspace.version)
            folder = Path(ws.folder.location)
            root_id = ws.folder.ref.root_id
            session = await stack.sessions.create_session(workspace_id=ws.workspace.id)

            # 1. 进程提前非零退出：返回 failed、保留可读错误与 stderr 尾部
            crash_dir = folder / "crash_app"
            crash_dir.mkdir()
            (crash_dir / "crash.py").write_text(
                "import sys\nprint('FATAL_BOOT_ERR: missing env', file=sys.stderr, flush=True)\nsys.exit(7)\n",
                encoding="utf-8",
            )
            crash_view, tail, start_err = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="崩溃服务",
                kind="service",
                root_id=root_id,
                relative_path="crash_app",
                start_command=f"{shlex.quote(sys.executable)} crash.py",
                health_path="/health",
            )
            assert crash_view.state == "failed"
            assert crash_view.exit_code == 7
            assert start_err and "7" in start_err
            assert "FATAL_BOOT_ERR" in tail
            logs = await stack.previews.read_logs(crash_view.id)
            assert logs.state == "failed" and "FATAL_BOOT_ERR" in logs.text

            with pytest.raises(AppException) as exc_info:
                await stack.previews.start(crash_view.id)
            assert exc_info.value.info.code is ErrorCode.UNAVAILABLE

            # 2. 健康检查超时：自动杀掉悬挂进程树并保留 failed 状态
            stack.holder["settings"] = Settings(
                managed_preview_start_timeout_seconds=0.6,
                managed_preview_health_interval_seconds=0.1,
            )
            hang_dir = folder / "hang_app"
            hang_dir.mkdir()
            (hang_dir / "hang.py").write_text(
                "import os, time\n"
                "with open('hang.pid', 'w', encoding='utf-8') as f: f.write(str(os.getpid()))\n"
                "print('STARTING_NO_PORT', flush=True)\n"
                "time.sleep(60)\n",
                encoding="utf-8",
            )
            hang_view, hang_tail, hang_err = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=session.id,
                run_id=None,
                name="超时服务",
                kind="service",
                root_id=root_id,
                relative_path="hang_app",
                start_command=f"{shlex.quote(sys.executable)} hang.py",
                health_path="/health",
            )
            assert hang_view.state == "failed" and hang_view.port is None
            assert hang_err and "未通过回环健康检查" in hang_err
            assert "STARTING_NO_PORT" in hang_tail
            hang_pid = int((hang_dir / "hang.pid").read_text(encoding="utf-8"))
            assert await _wait_dead(hang_pid)
        finally:
            await stack.cleanup()

    with_database(tmp_path, run, timeout=60)


def test_managed_preview_security_guards_quotas_and_flags(tmp_path):
    async def run(uow_factory, read_factory, _db):
        stack = await _build_preview_stack(tmp_path, uow_factory, read_factory, standalone_execution=False)
        try:
            ws_a = await stack.workspaces.create("纯文档工作区")
            ws_a = await stack.workspaces.set_local_execution(ws_a.workspace.id, True, ws_a.workspace.version)
            ws_b = await stack.workspaces.create("工作区 B")
            ws_b = await stack.workspaces.set_local_execution(ws_b.workspace.id, True, ws_b.workspace.version)

            folder_a = Path(ws_a.folder.location)
            folder_b = Path(ws_b.folder.location)
            s_a = await stack.sessions.create_session(workspace_id=ws_a.workspace.id)
            s_b = await stack.sessions.create_session(workspace_id=ws_b.workspace.id)
            s_solo = await stack.sessions.create_session(workspace_id=None)

            app_a1 = folder_a / "a1"
            app_a2 = folder_a / "a2"
            app_b1 = folder_b / "b1"
            _write_http_project(app_a1)
            _write_http_project(app_a2)
            _write_http_project(app_b1)
            cmd = f"{shlex.quote(sys.executable)} server.py"

            # 1. 非回环监听命令被拒绝
            for bad_cmd in (
                f"{shlex.quote(sys.executable)} server.py --host 0.0.0.0",
                f"{shlex.quote(sys.executable)} server.py --bind [::]",
                f"{shlex.quote(sys.executable)} server.py --host ::",
            ):
                with pytest.raises(BadRequestError, match="127\\.0\\.0\\.1"):
                    await stack.previews.register(
                        workspace_id=ws_a.workspace.id,
                        session_id=s_a.id,
                        run_id=None,
                        name="不安全监听",
                        kind="service",
                        root_id=ws_a.folder.ref.root_id,
                        relative_path="a1",
                        start_command=bad_cmd,
                    )

            # 2. 沿用 WorkspaceShellGuard：非代码工作区拒绝依赖安装/虚拟环境，且拒绝外部目录写入
            for guard_cmd in (
                "pip install flask && python server.py",
                "python3 -m venv .venv && .venv/bin/python server.py",
                f"{cmd} > ~/Desktop/rayagent-outside-preview.txt",
            ):
                with pytest.raises(BadRequestError):
                    await stack.previews.register(
                        workspace_id=ws_a.workspace.id,
                        session_id=s_a.id,
                        run_id=None,
                        name="越权命令",
                        kind="service",
                        root_id=ws_a.folder.ref.root_id,
                        relative_path="a1",
                        start_command=guard_cmd,
                    )

            # 3. 独立对话 / 工作区未开启本机执行 & 归档工作区均不可启动 service
            solo_root_pair = None
            async with read_factory() as uow:
                solo_root_pair = await uow.root.session_workdir(s_solo.id)
            assert solo_root_pair is not None
            solo_dir = (stack.env.data / solo_root_pair[1]) / "solo_app"
            _write_http_project(solo_dir)
            with pytest.raises(ConflictError, match="独立对话未开启本机执行"):
                await stack.previews.register(
                    workspace_id=None,
                    session_id=s_solo.id,
                    run_id=None,
                    name="独立服务",
                    kind="service",
                    root_id=solo_root_pair[0].root_id,
                    relative_path="solo_app",
                    start_command=cmd,
                )

            # 4. 单工作区与全局轻量并发配额限制
            stack.holder["settings"] = Settings(managed_preview_max_per_workspace=1, managed_preview_max_global=2)
            v_a1, _, err_a1 = await stack.previews.register(
                workspace_id=ws_a.workspace.id,
                session_id=s_a.id,
                run_id=None,
                name="服务 A1",
                kind="service",
                root_id=ws_a.folder.ref.root_id,
                relative_path="a1",
                start_command=cmd,
                health_path="/health",
            )
            assert err_a1 is None and v_a1.state == "running"

            v_a2, _, err_a2 = await stack.previews.register(
                workspace_id=ws_a.workspace.id,
                session_id=s_a.id,
                run_id=None,
                name="服务 A2",
                kind="service",
                root_id=ws_a.folder.ref.root_id,
                relative_path="a2",
                start_command=cmd,
                health_path="/health",
            )
            assert err_a2 and "当前工作区同时运行的轻量预览服务已达上限" in err_a2 and v_a2.state == "stopped"

            v_b1, _, err_b1 = await stack.previews.register(
                workspace_id=ws_b.workspace.id,
                session_id=s_b.id,
                run_id=None,
                name="服务 B1",
                kind="service",
                root_id=ws_b.folder.ref.root_id,
                relative_path="b1",
                start_command=cmd,
                health_path="/health",
            )
            assert err_b1 is None and v_b1.state == "running"

            # 全局已满 2 个，再起独立对话服务触发全局上限
            stack.holder["standalone"] = True
            v_solo, _, err_solo = await stack.previews.register(
                workspace_id=None,
                session_id=s_solo.id,
                run_id=None,
                name="独立服务",
                kind="service",
                root_id=solo_root_pair[0].root_id,
                relative_path="solo_app",
                start_command=cmd,
                health_path="/health",
            )
            assert err_solo and "全局最多 2 个" in err_solo

            # 关闭工作区本机执行开关时拒绝 start()；归档工作区同样拒绝
            ws_b = await stack.workspaces.set_local_execution(ws_b.workspace.id, False, ws_b.workspace.version)
            with pytest.raises(ConflictError, match="未开启本机执行"):
                await stack.previews.start(v_b1.id)
            await stack.workspaces.archive(ws_b.workspace.id, ws_b.workspace.version)
            with pytest.raises(ConflictError, match="已归档"):
                await stack.previews.start(v_b1.id)
        finally:
            await stack.cleanup()

    with_database(tmp_path, run, timeout=60)


def test_register_preview_tool_policy_and_preview_event(tmp_path):
    # 1. 纯策略规则与内置目录校验
    catalog = {item["toolset"]: item["functions"] for item in builtin_tool_catalog()}
    assert "register_preview" in catalog.get("preview", [])
    assert "register_preview_service" in catalog.get("preview_service", [])

    cfg = ToolPolicyConfig(rules={"preview_service:*": "deny"})
    assert resolve_policy(cfg, "preview", "register_preview", {"kind": "static"}).policy == ToolPolicy.ALLOW
    deny_match = resolve_policy(cfg, "preview", "register_preview", {"kind": "service"})
    assert deny_match.policy == ToolPolicy.DENY and deny_match.rule == "preview_service:*"

    # 2. AgentLoop + ToolPolicyGuard + AgentTaskRunner._register_preview + PreviewEvent 端到端
    async def run(uow_factory, read_factory, _db):
        stack = await _build_preview_stack(tmp_path, uow_factory, read_factory, standalone_execution=False)
        try:
            ws = await stack.workspaces.create("工具策略")
            ws = await stack.workspaces.set_local_execution(ws.workspace.id, True, ws.workspace.version)
            folder = Path(ws.folder.location)
            (folder / "dashboard.html").write_text("<!doctype html><html><body>Dash</body></html>", encoding="utf-8")
            _write_http_project(folder / "mini_svc")
            created = await stack.sessions.create_session(workspace_id=ws.workspace.id)
            session = await stack.sessions.get_session(created.id)
            opened = await stack.env.scope_of(session)
            files = SimpleNamespace(scope=opened.scope, files=opened.scope.files)

            cmd = f"{shlex.quote(sys.executable)} server.py"
            holder: dict[str, object] = {}

            async def reg_cb(**kwargs):
                return await holder["runner"]._register_preview(**kwargs)

            script_ask = [
                tool_call(
                    "register_preview",
                    {"name": "静态看板", "kind": "static", "path": "dashboard.html", "note": "离线可用"},
                    id="p-static",
                ),
                tool_call(
                    "register_preview",
                    {
                        "name": "轻量脚本工具",
                        "kind": "service",
                        "path": "mini_svc",
                        "start_command": cmd,
                        "health_path": "/health",
                        "note": "支持本机读写",
                    },
                    id="p-service",
                ),
            ]
            h1 = make_loop(
                script_ask,
                session=session,
                uow_factory=uow_factory,
                files=files,
                extra_tools=[PreviewTool(reg_cb)],
                tool_policy={"preview_service:*": "ask"},
            )
            h1.loop.workspace_id = ws.workspace.id
            started = await start_run(h1, input_task(), "生成静态看板与轻量工具")
            r1 = make_runner(h1, run=started)
            r1._workspace_id = ws.workspace.id
            r1._preview_runtime = stack.previews
            r1._environment_caps = _caps(Capability.FILE_ACCESS, Capability.LOCAL_COMMAND)
            holder["runner"] = r1
            await r1.invoke(input_task())

            _, runs, events = await read_session_records(read_factory, session.id)
            assert runs[0].status is RunStatus.WAITING
            preview_events = [e for e in events if isinstance(e, PreviewEvent)]
            approval_events = [e for e in events if isinstance(e, ApprovalEvent)]
            # static 无需审批立即成功并写入 PreviewEvent；service 进入审批等待
            assert len(preview_events) == 1 and preview_events[0].kind == "static" and preview_events[0].note == "离线可用"
            assert len(approval_events) == 1 and approval_events[0].rule == "preview_service:*"

            # 用户批准 service -> 续接运行并启动轻量服务、补发 PreviewEvent
            h2 = make_loop(
                [text("均已就绪")],
                session=await stack.sessions.get_session(session.id),
                uow_factory=uow_factory,
                files=files,
                extra_tools=[PreviewTool(reg_cb)],
                tool_policy={"preview_service:*": "ask"},
            )
            h2.loop.workspace_id = ws.workspace.id
            svc = AgentService.__new__(AgentService)
            svc._uow_factory = uow_factory
            svc._uow = uow_factory()
            svc._ledger = h2.ledger
            svc._notifier = h2.notifier
            svc._task_cls = None
            svc._get_task = AsyncMock(return_value=None)
            created_tasks = []

            async def create_task(sess, rid, prior_status, approval=None):
                t = input_task()
                t.invoke = AsyncMock()
                created_tasks.append((rid, prior_status, approval))
                return t

            svc._create_task = create_task
            accepted = await svc.reply_approval(session.id, "p-service", approve=True)
            await pending_starts()[accepted.run_id].worker
            rid, prior_status, approval = created_tasks[0]
            r2 = make_runner(h2, run=await _get_run(read_factory, rid), prior_status=prior_status, approval=approval)
            r2._workspace_id = ws.workspace.id
            r2._preview_runtime = stack.previews
            r2._environment_caps = _caps(Capability.FILE_ACCESS, Capability.LOCAL_COMMAND)
            holder["runner"] = r2
            await r2.invoke(input_task())

            _, runs2, events2 = await read_session_records(read_factory, session.id)
            assert runs2[0].status is RunStatus.COMPLETED
            preview_events2 = [e for e in events2 if isinstance(e, PreviewEvent)]
            assert [e.kind for e in preview_events2] == ["static", "service"]
            running_list = await stack.previews.list_previews(session_id=session.id)
            svc_item = next(p for p in running_list if p.kind == "service")
            assert svc_item.state == "running" and svc_item.port

            # 3. 策略 deny 时 service 被拦截且不启动进程；无 LOCAL_COMMAND 能力时仍可用 static
            solo_sess = await stack.sessions.create_session(workspace_id=None)
            solo_loaded = await stack.sessions.get_session(solo_sess.id)
            solo_opened = await stack.env.scope_of(solo_loaded)
            (solo_opened.workdir.path / "page.html").write_text("<!doctype html><html>Solo</html>", encoding="utf-8")
            (solo_opened.workdir.path / "svc").mkdir()
            _write_http_project(solo_opened.workdir.path / "svc")
            solo_files = SimpleNamespace(scope=solo_opened.scope, files=solo_opened.scope.files)
            h3 = make_loop(
                [
                    tool_call("register_preview", {"name": "独立静态页", "kind": "static", "path": "page.html"}, id="s1"),
                    tool_call(
                        "register_preview",
                        {"name": "独立脚本", "kind": "service", "path": "svc", "start_command": cmd},
                        id="s2",
                    ),
                    text("完成"),
                ],
                session=solo_loaded,
                uow_factory=uow_factory,
                files=solo_files,
                extra_tools=[PreviewTool(reg_cb)],
                tool_policy={"preview_service:*": "allow"},
            )
            r3 = make_runner(h3, run=await start_run(h3, input_task(), "无本地执行下预览"))
            r3._workspace_id = None
            r3._preview_runtime = stack.previews
            r3._environment_caps = _caps(Capability.FILE_ACCESS)  # 不含 LOCAL_COMMAND
            holder["runner"] = r3
            await r3.invoke(input_task())
            _, _, solo_events = await read_session_records(read_factory, solo_sess.id)
            tool_ev_s2 = next(e for e in solo_events if isinstance(e, ToolEvent) and e.tool_call_id == "s2" and e.status.value == "called")
            assert tool_ev_s2.function_result is not None and not tool_ev_s2.function_result.success
            assert "未开启本机执行" in (tool_ev_s2.function_result.message or "")
            assert [e.kind for e in solo_events if isinstance(e, PreviewEvent)] == ["static"]
        finally:
            await stack.cleanup()

    with_database(tmp_path, run, timeout=60)


async def _get_run(read_factory, run_id: str):
    async with read_factory() as uow:
        return await uow.run.get(run_id)


def test_lifecycle_cleanup_zip_export_and_routes(tmp_path):
    async def run(uow_factory, read_factory, _db):
        jobs = BackgroundJobRunner(uow_factory, "instance", read_uow_factory=read_factory, poll_seconds=0.05)
        stack = await _build_preview_stack(tmp_path, uow_factory, read_factory, jobs=jobs)
        storage = LocalFileStorage(tmp_path / "objects", tmp_path / "tmp", uow_factory)
        jobs.register(
            OperationKind.WORKSPACE_DELETE,
            workspace_delete_handler(stack.env.folders, uow_factory, storage.remove_key, stack.env.workdirs.remove),
            requeue_on_restart=True,
        )
        jobs.register(
            OperationKind.DATA_CLEANUP,
            data_cleanup_handler(stack.env.folders, storage.remove_key, stack.env.workdirs.remove),
            requeue_on_restart=True,
        )
        cmd = f"{shlex.quote(sys.executable)} server.py"
        try:
            ws = await stack.workspaces.create("回收与导出")
            ws = await stack.workspaces.set_local_execution(ws.workspace.id, True, ws.workspace.version)
            folder = Path(ws.folder.location)
            root_id = ws.folder.ref.root_id

            # 含敏感文件用于验证 ZIP 过滤与 RAYAGENT_START.txt
            proj = folder / "zip_svc"
            _write_http_project(proj)
            (proj / ".env").write_text("SECRET=123", encoding="utf-8")
            (proj / ".git").mkdir()
            (proj / ".git" / "config").write_text("[core]", encoding="utf-8")
            (proj / "secret.key").write_text("KEY", encoding="utf-8")
            (proj / "data.sqlite").write_text("db", encoding="utf-8")

            s1 = await stack.sessions.create_session(workspace_id=ws.workspace.id)
            p1, _, err1 = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=s1.id,
                run_id=None,
                name="会话服务",
                kind="service",
                root_id=root_id,
                relative_path="zip_svc",
                start_command=cmd,
                health_path="/health",
            )
            assert err1 is None and p1.state == "running"
            pid1 = int((proj / "server.pid").read_text(encoding="utf-8"))

            # ZIP 导出包含 server.py 与 RAYAGENT_START.txt，过滤敏感文件
            archive, filename = await stack.previews.export_zip(p1.id)
            assert filename.endswith(".zip")
            with zipfile.ZipFile(archive) as zf:
                names = set(zf.namelist())
                assert "server.py" in names and "RAYAGENT_START.txt" in names
                assert not any(n.startswith(".git") or n.endswith(".env") or n.endswith(".key") or n.endswith(".sqlite") for n in names)
                start_txt = zf.read("RAYAGENT_START.txt").decode("utf-8")
                assert "HOST=127.0.0.1" in start_txt and "server.py" in start_txt
            archive.close()

            # HTTP 路由联调
            api = FastAPI()
            register_exception_handlers(api)
            api.include_router(managed_preview_router, prefix="/api")
            api.dependency_overrides[get_preview_runtime_service] = lambda: stack.previews
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as client:
                list_resp = await client.get(f"/api/previews?session_id={s1.id}")
                assert list_resp.status_code == 200 and len(list_resp.json()["data"]["previews"]) == 1
                get_resp = await client.get(f"/api/previews/{p1.id}")
                assert get_resp.status_code == 200 and get_resp.json()["data"]["state"] == "running"
                logs_resp = await client.get(f"/api/previews/{p1.id}/logs?offset=0")
                assert logs_resp.status_code == 200 and "SERVICE_READY" in logs_resp.json()["data"]["text"]
                head_resp = await client.head(f"/api/previews/{p1.id}/export.zip")
                assert head_resp.status_code == 200 and "application/zip" in head_resp.headers["content-type"]
                zip_resp = await client.get(f"/api/previews/{p1.id}/export.zip")
                assert zip_resp.status_code == 200
                with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
                    assert "RAYAGENT_START.txt" in zf.namelist()
                stop_resp = await client.post(f"/api/previews/{p1.id}/stop")
                assert stop_resp.status_code == 200 and stop_resp.json()["data"]["state"] == "stopped"
                assert await _wait_dead(pid1)
                start_resp = await client.post(f"/api/previews/{p1.id}/start")
                assert start_resp.status_code == 200 and start_resp.json()["data"]["state"] == "running"
                pid1_b = int((proj / "server.pid").read_text(encoding="utf-8"))

            # 1. 删除会话回收对应运行中预览进程树
            await stack.sessions.delete_session(s1.id)
            assert await _wait_dead(pid1_b)

            # 2. 关闭本机执行 / 归档工作区均回收预览进程树
            s2 = await stack.sessions.create_session(workspace_id=ws.workspace.id)
            p2, _, err2 = await stack.previews.register(
                workspace_id=ws.workspace.id,
                session_id=s2.id,
                run_id=None,
                name="开关回收",
                kind="service",
                root_id=root_id,
                relative_path="zip_svc",
                start_command=cmd,
                health_path="/health",
            )
            assert err2 is None
            pid2 = int((proj / "server.pid").read_text(encoding="utf-8"))
            ws = await stack.workspaces.set_local_execution(ws.workspace.id, False, ws.workspace.version)
            assert await _wait_dead(pid2)

            ws = await stack.workspaces.set_local_execution(ws.workspace.id, True, ws.workspace.version)
            await stack.previews.start(p2.id)
            pid3 = int((proj / "server.pid").read_text(encoding="utf-8"))
            ws = await stack.workspaces.archive(ws.workspace.id, ws.workspace.version)
            assert await _wait_dead(pid3)

            # 3. 删除工作区回收运行中预览进程树
            ws = await stack.workspaces.unarchive(ws.workspace.id, ws.workspace.version)
            await stack.previews.start(p2.id)
            pid4 = int((proj / "server.pid").read_text(encoding="utf-8"))
            jobs.start()
            del_job = await stack.workspaces.delete(ws.workspace.id)
            for _ in range(150):
                del_job = await jobs.get(del_job.operation_id)
                if del_job.status.terminal:
                    break
                await asyncio.sleep(0.02)
            assert del_job.status == OperationStatus.SUCCEEDED and await _wait_dead(pid4)

            # 4. 清空全量数据回收运行中预览并删除持久化记录
            ws2 = await stack.workspaces.create("全量清空")
            ws2 = await stack.workspaces.set_local_execution(ws2.workspace.id, True, ws2.workspace.version)
            proj2 = Path(ws2.folder.location) / "svc2"
            _write_http_project(proj2)
            s3 = await stack.sessions.create_session(workspace_id=ws2.workspace.id)
            p3, _, err3 = await stack.previews.register(
                workspace_id=ws2.workspace.id,
                session_id=s3.id,
                run_id=None,
                name="全清前服务",
                kind="service",
                root_id=ws2.folder.ref.root_id,
                relative_path="svc2",
                start_command=cmd,
                health_path="/health",
            )
            assert err3 is None
            pid5 = int((proj2 / "server.pid").read_text(encoding="utf-8"))
            data_svc = DataService(uow_factory, jobs, INSTALL, previews=stack.previews)
            reset_task = await data_svc.start(RESET_CONFIRMATION)
            for _ in range(150):
                reset_task = await data_svc.get(reset_task.id)
                if reset_task.state != "running":
                    break
                await asyncio.sleep(0.02)
            await jobs.stop()
            assert reset_task.state == "completed" and await _wait_dead(pid5)
            assert await stack.previews.list_previews() == []
        finally:
            await jobs.stop()
            await stack.cleanup()

    with_database(tmp_path, run, timeout=60)
