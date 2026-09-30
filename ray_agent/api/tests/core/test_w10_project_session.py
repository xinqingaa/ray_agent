#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""W10 第二批：绑定 409、exec_dir 缺省、上传与结果不进 /workspace、提示词、会话 project 字段、最近项目排序。"""
import asyncio
import io
import os
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.errors.exceptions import BadRequestError, ConflictError, NotFoundError
from app.application.services.agent_service import AgentService
from app.application.services.project_service import (
    NO_ROOTS_MESSAGE,
    PROJECT_LOCKED_MESSAGE,
    PROJECT_UNBOUND_MESSAGE,
    SHARED_SANDBOX_MESSAGE,
    ProjectService,
)
from app.application.services.session_service import SessionDetail
from app.domain.external.sandbox import SandboxProjectBindingError
from app.domain.models.app_config import A2AConfig, AgentConfig, MCPConfig
from app.domain.models.file import File
from app.domain.models.project import (
    SANDBOX_PROJECT_DIR,
    BrowseListing,
    GitDiff,
    GitStatus,
    PathCheck,
    PathCheckReason,
    ProjectFile,
    ProjectListing,
    ProjectPathError,
)
from app.domain.models.run import Run
from app.domain.models.session import Session
from app.domain.models.tool_result import ToolResult
from app.domain.services.agent_task_runner import AgentTaskRunner
from app.domain.services.context.shaping import OUTPUT_DIR, ResultShaper
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.prompts.en.system import SYSTEM_PROMPT as EN_SYSTEM_PROMPT
from app.domain.services.prompts.en.system import build_system_prompt as build_en_system_prompt
from app.domain.services.prompts.system import SYSTEM_PROMPT, build_system_prompt
from app.domain.services.run_ledger import RunLedger
from app.domain.services.tools.a2a import A2ATool
from app.domain.services.tools.mcp import MCPTool
from app.domain.services.tools.shell import ShellTool
from app.interfaces.endpoints import project_routes, session_routes
from app.interfaces.endpoints.session_routes import session_list_item
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_project_service, get_session_service
from tests.support.loop_harness import InMemorySandbox, make_uow_factory

# 改写 build_system_prompt 之前的中英文系统提示词。无项目时必须与此逐字相同。


class MemStore:
    """绑定测试用的内存会话与运行表。"""

    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.runs: list = []

    async def get_by_id(self, session_id):
        return self.sessions.get(session_id)

    async def get_all(self):
        return list(self.sessions.values())

    async def set_project_path(self, session_id, project_path):
        session = self.sessions.get(session_id)
        if session is None:
            raise ValueError(session_id)
        session.project_path = project_path

    async def list_by_session(self, session_id):
        return [run for run in self.runs if run.session_id == session_id]


class Uow:
    def __init__(self, store: MemStore) -> None:
        self.session = store
        self.run = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class Files:
    def __init__(self) -> None:
        self.calls = []

    async def list_directory(self, project_path, relative=""):
        self.calls.append(("tree", project_path, relative))
        if relative == "escape":
            raise ProjectPathError(PathCheck(
                ok=False, path=relative, reason=PathCheckReason.ESCAPES_PROJECT, message="路径超出了项目目录",
            ))
        return ProjectListing(path=relative or "")

    async def read_file(self, project_path, relative):
        self.calls.append(("file", project_path, relative))
        return ProjectFile(path=relative, name="a.txt", size=2, kind="text", content="hi")

    async def browse(self, path):
        self.calls.append(("browse", path))
        if path == "/nope":
            raise ProjectPathError(PathCheck(
                ok=False, path=path, reason=PathCheckReason.OUTSIDE_ROOTS, message="路径不在允许的项目根目录内",
            ))
        return BrowseListing(path=path, root=path)


class Git:
    def __init__(self, state="ok") -> None:
        self.state = state

    async def status(self, project_path):
        return GitStatus(state=self.state, error="git 超时" if self.state == "timeout" else None)

    async def diff(self, project_path, scope="worktree", path=None):
        return GitDiff(state=self.state, scope=scope, path=path, error="git 超时" if self.state == "timeout" else None)


def service(store, root, *, sandbox_address=None, git_state="ok") -> ProjectService:
    return ProjectService(
        uow_factory=lambda: Uow(store),
        files=Files(),
        git=Git(git_state),
        roots=[root] if root is not None else [],
        sandbox_address=sandbox_address,
    )


def make_dirs(tmp_path):
    root = os.path.join(os.path.realpath(tmp_path), "root")
    first = os.path.join(root, "alpha")
    second = os.path.join(root, "beta")
    os.makedirs(first)
    os.makedirs(second)
    return root, first, second


def test_bind_before_first_run_and_reject_after(tmp_path):
    root, first, second = make_dirs(tmp_path)
    store = MemStore()
    session = Session(id="s-bind", title="新对话")
    store.sessions[session.id] = session
    projects = service(store, root)

    async def run():
        bound = await projects.bind(session.id, first + "/../alpha")
        assert bound.path == first
        assert bound.name == "alpha"
        assert bound.available is True and bound.reason is None
        assert session.project_path == first

        replaced = await projects.bind(session.id, second)
        assert replaced.path == second and session.project_path == second

        await projects.unbind(session.id)
        assert session.project_path is None
        again = await projects.bind(session.id, first)
        assert again.path == first

        store.runs.append(Run(session_id=session.id))
        with pytest.raises(ConflictError) as locked:
            await projects.bind(session.id, second)
        assert locked.value.status_code == 409
        assert locked.value.msg == PROJECT_LOCKED_MESSAGE
        assert session.project_path == first
        with pytest.raises(ConflictError) as still:
            await projects.unbind(session.id)
        assert still.value.status_code == 409
        assert session.project_path == first

    asyncio.run(run())


def test_bind_rejects_sandbox_shared_mode_and_existing_sandbox(tmp_path):
    root, first, _second = make_dirs(tmp_path)
    store = MemStore()
    bare = Session(id="s-shared")
    sandboxed = Session(id="s-box", sandbox_id="box-1")
    store.sessions[bare.id] = bare
    store.sessions[sandboxed.id] = sandboxed

    async def run():
        shared = service(store, root, sandbox_address="127.0.0.1")
        with pytest.raises(ConflictError) as exc:
            await shared.bind(bare.id, first)
        assert exc.value.status_code == 409 and exc.value.msg == SHARED_SANDBOX_MESSAGE
        assert bare.project_path is None

        normal = service(store, root)
        with pytest.raises(ConflictError) as locked:
            await normal.bind(sandboxed.id, first)
        assert locked.value.status_code == 409 and locked.value.msg == PROJECT_LOCKED_MESSAGE
        assert sandboxed.project_path is None

        with pytest.raises(NotFoundError) as missing:
            await normal.bind("missing", first)
        assert missing.value.status_code == 404

    asyncio.run(run())


def test_bind_rejects_bad_path_and_empty_roots(tmp_path):
    root, first, _second = make_dirs(tmp_path)
    outside = os.path.join(os.path.realpath(tmp_path), "outside")
    os.makedirs(outside)
    store = MemStore()
    session = Session(id="s-path")
    store.sessions[session.id] = session

    async def run():
        closed = service(store, None)
        with pytest.raises(BadRequestError) as empty:
            await closed.bind(session.id, first)
        assert empty.value.status_code == 400 and empty.value.msg == NO_ROOTS_MESSAGE

        projects = service(store, root)
        missing = os.path.join(root, "gone")
        with pytest.raises(BadRequestError) as not_found:
            await projects.bind(session.id, missing)
        assert not_found.value.status_code == 400 and not_found.value.msg == "路径不存在"
        with pytest.raises(BadRequestError) as out:
            await projects.bind(session.id, outside)
        assert out.value.msg == "路径不在允许的项目根目录内"
        assert session.project_path is None

    asyncio.run(run())


def test_recent_projects_use_latest_updated_at(tmp_path):
    root, first, second = make_dirs(tmp_path)
    day = datetime(2026, 9, 1, 12, 0, 0)
    store = MemStore()
    store.sessions["old-a"] = Session(id="old-a", project_path=first, updated_at=day.replace(day=1))
    store.sessions["new-a"] = Session(id="new-a", project_path=first, updated_at=day.replace(day=3))
    store.sessions["b"] = Session(id="b", project_path=second, updated_at=day.replace(day=2))
    store.sessions["plain"] = Session(id="plain", project_path=None, updated_at=day.replace(day=9))
    projects = service(store, root)

    async def run():
        recent = await projects.list_recent(limit=10)
        assert [item.path for item in recent] == [first, second]
        assert recent[0].name == "alpha" and recent[0].available is True and recent[0].reason is None
        assert [item.path for item in await projects.list_recent(limit=1)] == [first]

    asyncio.run(run())


def test_project_view_reports_unavailable_reason(tmp_path):
    root, first, _second = make_dirs(tmp_path)
    projects = service(MemStore(), root)
    gone = os.path.join(root, "missing")
    outside = os.path.join(os.path.realpath(tmp_path), "outside")
    assert projects.describe(None) is None
    assert projects.describe("") is None
    missing = projects.describe(gone)
    assert missing is not None and missing.available is False and missing.reason == "路径不存在"
    assert missing.name == "missing"
    out = projects.describe(outside)
    assert out is not None and out.available is False and out.reason == "路径不在允许的项目根目录内"
    ok = projects.describe(first)
    assert ok is not None and ok.available is True and ok.reason is None and ok.name == "alpha"


def test_read_endpoints_and_git_states(tmp_path):
    root, first, _second = make_dirs(tmp_path)

    async def run():
        store = MemStore()
        bare = Session(id="bare")
        bound = Session(id="bound", project_path=first)
        store.sessions[bare.id] = bare
        store.sessions[bound.id] = bound
        projects = service(store, root)
        with pytest.raises(NotFoundError) as missing:
            await projects.tree("nope")
        assert missing.value.status_code == 404
        with pytest.raises(NotFoundError) as unbound:
            await projects.tree(bare.id)
        assert unbound.value.status_code == 404 and unbound.value.msg == PROJECT_UNBOUND_MESSAGE

        listing = await projects.tree(bound.id, "src")
        assert listing.path == "src"
        with pytest.raises(BadRequestError) as bad:
            await projects.tree(bound.id, "escape")
        assert bad.value.status_code == 400 and bad.value.msg == "路径超出了项目目录"

        timed = service(store, root, git_state="timeout")
        status = await timed.git_status(bound.id)
        diff = await timed.git_diff(bound.id, scope="staged", path="a.txt")
        assert status.state == "timeout" and diff.state == "timeout" and diff.scope == "staged"
        repo = service(store, root, git_state="not_a_repository")
        assert (await repo.git_status(bound.id)).state == "not_a_repository"
        errored = service(store, root, git_state="error")
        assert (await errored.git_status(bound.id)).state == "error"

    asyncio.run(run())


def _http(projects: ProjectService, sessions=None):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(session_routes.router)
    app.include_router(project_routes.router)
    app.dependency_overrides[get_project_service] = lambda: projects

    class Listing:
        async def get_all_sessions(self):
            return list(sessions or [])

        async def get_session_detail(self, session_id, after_seq=0, limit=None):
            found = next((item for item in (sessions or []) if item.id == session_id), None)
            if found is None:
                return None
            return SessionDetail(session=found, runs=[], events=[], last_seq=0)

    app.dependency_overrides[get_session_service] = lambda: Listing()
    return TestClient(app)


def test_http_bind_status_codes_and_project_fields(tmp_path):
    root, first, second = make_dirs(tmp_path)
    outside = os.path.join(os.path.realpath(tmp_path), "outside")
    os.makedirs(outside)
    gone = os.path.join(root, "gone")
    day = datetime(2026, 9, 2, 8, 0, 0)
    store = MemStore()
    ready = Session(id="ready")
    started = Session(id="started", sandbox_id="box")
    bound = Session(id="bound", project_path=first, title="已绑定", updated_at=day.replace(day=2))
    missing_dir = Session(id="missing-dir", project_path=gone, updated_at=day.replace(day=1))
    foreign = Session(id="foreign", project_path=outside, updated_at=day.replace(day=4))
    plain = Session(id="plain", title="无项目", updated_at=day.replace(day=3))
    for session in (ready, started, bound, missing_dir, foreign, plain):
        store.sessions[session.id] = session
    # 最近项目：foreign 的 updated_at 更晚，但列表接口的排序另测；这里给 recent 用同一份 store
    store.sessions["later-first"] = Session(id="later-first", project_path=first, updated_at=day.replace(day=5))
    projects = service(store, root)
    client = _http(projects, [bound, missing_dir, foreign, plain])

    created = client.put(f"/sessions/{ready.id}/project", json={"path": second})
    assert created.status_code == 200
    body = created.json()
    assert body["data"]["path"] == second and body["data"]["name"] == "beta"
    assert body["data"]["available"] is True and body["data"]["reason"] is None

    replaced = client.put(f"/sessions/{ready.id}/project", json={"path": first})
    assert replaced.status_code == 200 and replaced.json()["data"]["path"] == first

    conflict = client.put(f"/sessions/{started.id}/project", json={"path": first})
    assert conflict.status_code == 409 and conflict.json()["msg"] == PROJECT_LOCKED_MESSAGE
    shared = _http(service(store, root, sandbox_address="10.0.0.1"))
    shared_resp = shared.put(f"/sessions/{ready.id}/project", json={"path": first})
    assert shared_resp.status_code == 409 and SHARED_SANDBOX_MESSAGE in shared_resp.json()["msg"]
    # 共享模式的拒绝发生在写入之前，ready 仍是上一次成功绑定的 first
    assert store.sessions[ready.id].project_path == first

    bad = client.put(f"/sessions/{plain.id}/project", json={"path": outside})
    assert bad.status_code == 400 and bad.json()["msg"] == "路径不在允许的项目根目录内"
    empty = _http(service(store, None))
    assert empty.put(f"/sessions/{plain.id}/project", json={"path": first}).status_code == 400
    assert empty.put(f"/sessions/{plain.id}/project", json={"path": first}).json()["msg"] == NO_ROOTS_MESSAGE
    assert client.put("/sessions/missing/project", json={"path": first}).status_code == 404

    cleared = client.delete(f"/sessions/{ready.id}/project")
    assert cleared.status_code == 200 and cleared.json()["data"] is None
    assert store.sessions[ready.id].project_path is None
    assert client.delete(f"/sessions/{started.id}/project").status_code == 409

    listed = client.get("/sessions").json()["data"]["sessions"]
    by_id = {item["session_id"]: item["project"] for item in listed}
    assert by_id["plain"] is None
    assert by_id["bound"] == {"path": first, "name": "alpha", "available": True, "reason": None}
    assert by_id["missing-dir"]["available"] is False and by_id["missing-dir"]["reason"] == "路径不存在"
    assert by_id["foreign"]["available"] is False and by_id["foreign"]["reason"] == "路径不在允许的项目根目录内"
    # 列表流与 GET 共用 session_list_item，字段计算相同
    assert session_list_item(bound, projects).project.model_dump() == by_id["bound"]
    assert session_list_item(plain, projects).project is None

    detail = client.get(f"/sessions/{missing_dir.id}").json()["data"]
    assert detail["project"]["path"] == gone and detail["project"]["available"] is False
    assert detail["project"]["reason"] == "路径不存在"
    assert client.get(f"/sessions/{plain.id}").json()["data"]["project"] is None

    recent = client.get("/projects/recent?limit=2").json()["data"]
    assert [item["path"] for item in recent] == [first, outside]
    assert recent[0]["available"] is True and recent[1]["available"] is False

    roots = client.get("/projects/roots").json()["data"]
    assert roots["enabled"] is True and roots["roots"][0]["path"] == root and roots["roots"][0]["available"] is True
    assert _http(service(store, None)).get("/projects/roots").json()["data"] == {"enabled": False, "roots": [], "supported": True, "reason": NO_ROOTS_MESSAGE}

    tree = client.get(f"/sessions/{bound.id}/project/tree")
    assert tree.status_code == 200 and tree.json()["data"]["path"] == ""
    assert client.get(f"/sessions/{plain.id}/project/tree").status_code == 404
    assert client.get(f"/sessions/{plain.id}/project/tree").json()["msg"] == PROJECT_UNBOUND_MESSAGE
    escaped = client.get(f"/sessions/{bound.id}/project/tree", params={"path": "escape"})
    assert escaped.status_code == 400

    git = _http(service(store, root, git_state="not_a_repository"), [bound])
    status = git.get(f"/sessions/{bound.id}/project/git/status")
    assert status.status_code == 200 and status.json()["data"]["state"] == "not_a_repository"
    timed = _http(service(store, root, git_state="timeout"), [bound])
    diff = timed.get(f"/sessions/{bound.id}/project/git/diff", params={"scope": "worktree"})
    assert diff.status_code == 200 and diff.json()["data"]["state"] == "timeout"


def test_shell_exec_dir_defaults_to_workspace_or_home():
    calls = []

    class Sandbox:
        async def exec_command(self, session_id, exec_dir, command):
            calls.append((session_id, exec_dir, command))
            return ToolResult(success=True, data={"exec_dir": exec_dir})

    async def run():
        tool = ShellTool(Sandbox(), default_exec_dir="/workspace")
        schema = next(item for item in tool.get_tools() if item["function"]["name"] == "shell_execute")
        assert "exec_dir" not in schema["function"]["parameters"]["required"]
        assert schema["function"]["parameters"]["required"] == ["session_id", "command"]
        assert "/workspace" in schema["function"]["parameters"]["properties"]["exec_dir"]["description"]
        await tool.shell_execute("sh-1", "pwd")
        await tool.shell_execute("sh-1", "ls", exec_dir="/tmp")
        assert calls == [("sh-1", "/workspace", "pwd"), ("sh-1", "/tmp", "ls")]

        home = ShellTool(Sandbox(), default_exec_dir="/home/ubuntu")
        await home.invoke("shell_execute", session_id="sh-2", command="true")
        assert calls[-1] == ("sh-2", "/home/ubuntu", "true")

    asyncio.run(run())


def test_bound_runner_prompt_upload_and_outputs(tmp_path):
    async def run():
        sandbox = InMemorySandbox()

        async def upload_file(file_data, filepath, filename=None):
            sandbox.files[filepath] = file_data.read().decode()
            return ToolResult(success=True, data={"filepath": filepath})

        sandbox.upload_file = upload_file
        storage = SimpleNamespace(
            download_file=AsyncMock(return_value=(io.BytesIO(b"hello"), File(filename="note.txt"))),
        )
        runner = _runner(sandbox, storage, workspace_dir=SANDBOX_PROJECT_DIR)
        uploaded = await runner._sync_file_to_sandbox("file-1")
        assert uploaded.filepath == "/home/ubuntu/upload/note.txt"
        assert not uploaded.filepath.startswith("/workspace")
        assert "/workspace" not in sandbox.files

        shaper = next(handler for handler in runner._flow.pipeline._after if isinstance(handler, ResultShaper))
        assert shaper._output_dir == OUTPUT_DIR == "/home/ubuntu/.rayagent/outputs"
        invocation = ToolInvocation(call_id="c-big", function_name="shell_execute", raw_arguments="{}")
        await shaper(invocation, ToolResult(success=True, message="x" * 20000))
        path = invocation.shaping.full_output_path
        assert path == "/home/ubuntu/.rayagent/outputs/c-big.txt"
        assert path in sandbox.files and not path.startswith("/workspace")
        assert runner._flow._system_prompt == build_system_prompt(SANDBOX_PROJECT_DIR)
        shell = next(tool for tool in runner._flow.pipeline.tools if isinstance(tool, ShellTool))
        assert shell.default_exec_dir == "/workspace"

        plain = _runner(InMemorySandbox(), storage, workspace_dir=None)
        assert plain._flow._system_prompt == SYSTEM_PROMPT
        plain_shell = next(tool for tool in plain._flow.pipeline.tools if isinstance(tool, ShellTool))
        assert plain_shell.default_exec_dir == "/home/ubuntu"

    asyncio.run(run())


def _runner(sandbox, storage, workspace_dir):
    session = Session(id="w10-runner")
    uow_factory = make_uow_factory(session)
    llm = SimpleNamespace(context_window=32000, max_tokens=4096, model_name="m", temperature=0)
    return AgentTaskRunner(
        uow_factory=uow_factory,
        llm=llm,
        agent_config=AgentConfig(),
        mcp_tool=MCPTool(SimpleNamespace()),
        a2a_tool=A2ATool(SimpleNamespace()),
        session_id=session.id,
        file_storage=storage,
        browser=SimpleNamespace(),
        search_engine=SimpleNamespace(),
        sandbox=sandbox,
        ledger=RunLedger(uow_factory),
        run_id="run-1",
        workspace_dir=workspace_dir,
    )


def test_create_task_passes_project_and_maps_binding_error(monkeypatch):
    from app.application.services import agent_service as module

    captured = {}

    class FakeRunner:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(module, "AgentTaskRunner", FakeRunner)

    class Box:
        validate_project = AsyncMock()
        def __init__(self, box_id):
            self.id = box_id

        async def get_browser(self):
            return object()

    class SandboxCls:
        created = []
        existing = None
        fail = False

        @classmethod
        async def get(cls, sandbox_id):
            return cls.existing

        @classmethod
        async def create(cls, project_path=None):
            if cls.fail:
                raise SandboxProjectBindingError(SHARED_SANDBOX_MESSAGE)
            cls.created.append(project_path)
            return Box("new-box")

    class Tasks:
        @classmethod
        def create(cls, task_runner):
            return SimpleNamespace(id="task-1")

    updates = {}

    class Repo:
        async def update_sandbox_id(self, session_id, sandbox_id):
            updates["sandbox_id"] = sandbox_id

        async def update_task_id(self, session_id, task_id):
            updates["task_id"] = task_id

    class TaskUow:
        def __init__(self):
            self.session = Repo()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    uow = TaskUow()
    agent = AgentService(
        uow_factory=lambda: uow,
        llm=SimpleNamespace(),
        agent_config=AgentConfig(),
        mcp_config=MCPConfig(),
        a2a_config=A2AConfig(),
        sandbox_cls=SandboxCls,
        task_cls=Tasks,
        search_engine=SimpleNamespace(),
        file_storage=SimpleNamespace(),
    )

    async def run():
        SandboxCls.created, SandboxCls.existing, SandboxCls.fail = [], None, False
        session = Session(id="s-task", project_path="/host/proj")
        await agent._create_task(session, "run-1", None)
        assert SandboxCls.created == ["/host/proj"]
        assert captured["workspace_dir"] == "/workspace"
        assert session.sandbox_id == "new-box"
        assert "sandbox_id" not in updates  # 尚未验证启动所有权，不发布引用

        SandboxCls.created = []
        SandboxCls.existing = None
        captured.clear()
        rebuilt = Session(id="s-ttl", project_path="/host/proj", sandbox_id="expired")
        await agent._create_task(rebuilt, "run-2", None)
        assert SandboxCls.created == ["/host/proj"]
        assert captured["workspace_dir"] == "/workspace"

        SandboxCls.created = []
        live = Box("still-there")
        SandboxCls.existing = live
        captured.clear()
        kept = Session(id="s-live", project_path="/host/proj", sandbox_id="still-there")
        await agent._create_task(kept, "run-3", None)
        assert SandboxCls.created == []
        assert captured["workspace_dir"] == "/workspace"

        SandboxCls.existing = None
        captured.clear()
        plain = Session(id="s-plain")
        await agent._create_task(plain, "run-4", None)
        assert SandboxCls.created[-1] is None
        assert captured["workspace_dir"] is None

        SandboxCls.fail = True
        with pytest.raises(ConflictError) as exc:
            await agent._create_task(Session(id="s-shared", project_path="/host/proj"), "run-5", None)
        assert exc.value.status_code == 409 and exc.value.msg == SHARED_SANDBOX_MESSAGE

    asyncio.run(run())


def test_unbound_system_prompts_match_historical_text():
    assert HISTORICAL_ZH == SYSTEM_PROMPT == build_system_prompt(None)
    assert HISTORICAL_EN == EN_SYSTEM_PROMPT == build_en_system_prompt(None)
    bound = build_system_prompt("/workspace")
    assert bound != SYSTEM_PROMPT
    assert "读写挂载" in bound and "也是默认工作目录" in bound
    assert "/home/ubuntu/upload" in bound and "/home/ubuntu/.rayagent/outputs" in bound
    assert "临时文件不要写进项目目录" in bound and "git 可用" in bound
    assert "工作目录为 /home/ubuntu（HOME 也是这个目录）" not in bound
    assert "你是 RayAgent" in bound and "<file_rules>" in bound
    en_bound = build_en_system_prompt("/workspace")
    assert "read-write mount" in en_bound and "git is available" in en_bound
    assert "/home/ubuntu/upload" in en_bound and "/home/ubuntu/.rayagent/outputs" in en_bound
    assert "temporary files must not be written into the project" in en_bound
    assert "Working directory is /home/ubuntu (HOME is the same path)" not in en_bound
    assert en_bound.startswith(EN_SYSTEM_PROMPT.split("- Working directory", 1)[0])

HISTORICAL_ZH = '\n你是 RayAgent，一个在 Linux 沙箱中替用户完成任务的 AI Agent。你通过工具亲自执行任务，而不是指导用户去做。\n\n<agent_loop>\n- 每次回复要么调用工具，要么直接给出最终答复。回复中没有工具调用时，本次任务即结束，这条回复就是交给用户的最终答复。\n- 一次回复可以包含多个工具调用，它们按顺序执行；后一个调用需要依据前一个结果时，放到下一次回复。\n- 调用工具时可以附带一两句简短说明，让用户知道你正在做什么；不要重复已经说过的内容。\n- 复杂任务（需要多个阶段或多次工具调用）先用 update_plan 写出简短的计划清单，推进时及时更新状态，同一时间最多一项 in_progress；简单任务不必写计划。\n- 需要交付文件成果时，先用文件或 Shell 工具写入文件，再调用 deliver_files 交付；路径必须是已经写入的沙箱绝对路径。只在回复里提到路径不算交付。\n- 只有缺少必要信息且无法合理假设时，才用 message_ask_user 提问；提问后本轮暂停，用户的回复会作为该调用的结果返回。\n- 工具返回失败时，先阅读错误信息，修正参数或换一种方法，不要原样重复同一个失败的调用。\n- 最终答复直接给出结果，按任务需要选择格式与长度，可以使用 Markdown；不要把待办清单或建议当作结果交付。\n- 对话较长时，较早的历史会被压缩为一条“[上下文摘要]”消息，其后附上用户消息原文；据此继续任务，用户原文优先。\n</agent_loop>\n\n<language_settings>\n- 默认工作语言为中文；用户在消息中使用或指定其他语言时，改用该语言\n- 调用工具前的简短说明、计划条目、最终答复以及工具调用中的自然语言参数都使用工作语言\n</language_settings>\n\n<sandbox_environment>\n- Ubuntu 22.04，可访问互联网；命令以用户 ubuntu 执行，需要更高权限时使用免密 sudo\n- 工作目录为 /home/ubuntu（HOME 也是这个目录）；用户上传的附件位于 /home/ubuntu/upload\n- Python 3.10（python3、pip3）、Node.js 24（node、npm）、bc；可以用 Shell 安装其他依赖\n- 可用工具：文件读写、Shell、浏览器、网页搜索，以及已接入的 MCP 工具与 A2A 远程 Agent\n</sandbox_environment>\n\n<file_rules>\n- 读取、写入、追加和编辑文件优先使用文件工具，避免 Shell 命令中的转义问题\n- 不要读取二进制文件；需要处理时用 Shell 或代码\n- 工具结果超过单条上限时只返回开头与结尾的预览，完整内容保存在 /home/ubuntu/.rayagent/outputs/ 下并在结果中给出路径；需要时用 read_file 按行分段读取，不要一次读回全部\n</file_rules>\n\n<shell_rules>\n- 使用非交互命令，需要确认时加 -y 或 -f\n- 避免产生大量输出的命令，必要时把输出重定向到文件\n- 计算与数据处理用 Python 或 bc，不要心算；较长的代码先写入文件再执行\n</shell_rules>\n\n<search_and_browser_rules>\n- 需要事实依据时，优先使用搜索工具，再用浏览器打开原始页面核对；搜索摘要不足以作为依据\n- 用户消息中给出的 URL 用浏览器打开\n- 浏览器工具默认只返回可见视口中的元素，格式为 `index[:]<tag>text</tag>`，index 用于后续交互；未列出的元素可以用坐标交互\n- 浏览器会尝试把页面提取为 Markdown；内容已足够时无需滚动，否则滚动查看\n- 涉及登录等敏感操作时，可以用 message_ask_user 建议用户接管浏览器\n</search_and_browser_rules>\n'
HISTORICAL_EN = '\nYou are RayAgent, an AI agent that completes tasks for the user inside a Linux sandbox. You carry out the task yourself with tools instead of telling the user how to do it.\n\n<agent_loop>\n- Each reply either calls tools or gives the final answer. A reply without tool calls ends the task, and that reply is the final answer delivered to the user.\n- One reply may contain several tool calls; they run in order. When a call depends on the result of an earlier one, put it in the next reply.\n- You may add one or two short sentences alongside tool calls so the user knows what you are doing; do not repeat what you already said.\n- For complex tasks (several phases or many tool calls), first write a short checklist with update_plan and keep its statuses current; at most one item may be in_progress. Simple tasks do not need a plan.\n- When the task requires files, write them with the file or shell tools first, then call deliver_files; paths must be absolute sandbox paths of files you have written. Mentioning a path in the reply is not a delivery.\n- Use message_ask_user only when required information is missing and cannot reasonably be assumed; the turn pauses and the user\'s reply comes back as the result of that call.\n- When a tool fails, read the error, then fix the arguments or try another approach; do not repeat the same failing call unchanged.\n- Give the result directly in the final answer, choosing format and length to fit the task (Markdown is fine); do not deliver a to-do list or advice as the result.\n- When a long conversation is compressed, earlier history becomes one "[Context summary]" message followed by the user\'s messages verbatim; continue from them, and the user\'s own words take precedence.\n</agent_loop>\n\n<language_settings>\n- Default working language: English; switch to the language the user writes in or asks for\n- Use the working language for the brief notes before tool calls, plan items, the final answer, and natural-language arguments in tool calls\n</language_settings>\n\n<sandbox_environment>\n- Ubuntu 22.04 with internet access; commands run as user ubuntu, and passwordless sudo is available when root is required\n- Working directory is /home/ubuntu (HOME is the same path); user uploads are in /home/ubuntu/upload\n- Python 3.10 (python3, pip3), Node.js 24 (node, npm), bc; install other dependencies via shell when needed\n- Tools: file read/write, shell, browser, web search, plus any connected MCP tools and A2A remote agents\n</sandbox_environment>\n\n<file_rules>\n- Prefer file tools for reading, writing, appending and editing to avoid escaping issues in shell commands\n- Do not read binary files directly; process them with shell commands or code\n- A tool result that exceeds the size limit comes back as a head-and-tail preview; the full content is saved under /home/ubuntu/.rayagent/outputs/ and the result gives the path. Read it in segments with read_file (start_line/end_line) when needed, not all at once\n</file_rules>\n\n<shell_rules>\n- Use non-interactive commands; add -y or -f when confirmation would be required\n- Avoid commands with excessive output; redirect output to files when necessary\n- Use Python or bc for calculations and data processing, never mental math; save longer code to a file before running it\n</shell_rules>\n\n<search_and_browser_rules>\n- When facts matter, use the search tool first, then open the original pages in the browser to verify; search snippets alone are not sources\n- Open URLs given in the user\'s message with the browser\n- Browser tools return elements in the visible viewport as `index[:]<tag>text</tag>`; use index for later interactions and coordinates for unlisted elements\n- The browser tries to extract the page as Markdown; scroll only when the extracted content is not enough\n- For sensitive operations such as logging in, you may use message_ask_user to suggest that the user takes over the browser\n</search_and_browser_rules>\n'


def test_validate_start_rechecks_roots_and_rejects_replaced_paths(tmp_path):
    root = os.path.realpath(tmp_path)
    project = os.path.join(root, "project")
    os.mkdir(project)
    store = MemStore()
    svc = service(store, root)
    svc.validate_start(project)
    with pytest.raises(ConflictError, match="未配置"):
        service(store, None).validate_start(project)
    with pytest.raises(ConflictError, match="共享沙箱"):
        service(store, root, sandbox_address="shared").validate_start(project)
    with open(os.path.join(project, ".git"), "w") as handle:
        handle.write("gitdir: ../other")
    with pytest.raises(ConflictError, match="linked worktree"):
        svc.validate_start(project)
    os.remove(os.path.join(project, ".git"))
    os.rmdir(project)
    os.mkdir(os.path.join(root, "replacement"))
    os.symlink(os.path.join(root, "replacement"), project)
    with pytest.raises(ConflictError, match="已被替换"):
        svc.validate_start(project)
