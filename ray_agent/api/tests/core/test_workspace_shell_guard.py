"""工作区 Shell 污染拦截、缓存环境变量重定向与环境目录过滤测试。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.domain.external.workspace_files import FileLimits, RootBinding
from app.domain.models.event import ApprovalEvent, ApprovalStatus
from app.domain.models.identity import RootKind
from app.domain.services.file_scope import AccessibleRoot, FileScope
from app.domain.services.flows.tool_pipeline import ToolInvocation
from app.domain.services.workspace_shell_guard import (
    WorkspaceShellGuard,
    has_project_manifest,
    inspect_workspace_shell,
)
from app.infrastructure.external.execution.shell_bridge import LocalShellBridge
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles, scan_binding, snapshot_binding
from app.infrastructure.external.workspace_files.watcher import _watched


def _make_scope(workspace: Path, scratch: Path) -> FileScope:
    ws_root = AccessibleRoot(root_id="ws-1", path=str(workspace.resolve()), kind=RootKind.WORKSPACE_FOLDER)
    sc_root = AccessibleRoot(root_id="sc-1", path=str(scratch.resolve()), kind=RootKind.SESSION_WORKDIR)
    return FileScope(files=None, roots=[ws_root, sc_root], working=ws_root)


def _invocation(command: str, exec_dir: str | None = None, *, approval: str | None = None) -> ToolInvocation:
    args = {"session_id": "s1", "command": command}
    if exec_dir is not None:
        args["exec_dir"] = exec_dir
    inv = ToolInvocation(call_id="c1", function_name="shell_execute", raw_arguments="{}", arguments=args)
    inv.tool = SimpleNamespace(name="shell")
    inv.approval = approval
    return inv


def test_non_project_workspace_hard_blocks_venv_install_and_build(tmp_path):
    workspace = tmp_path / "notes"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()
    (workspace / "brief.md").write_text("# brief", encoding="utf-8")

    assert not has_project_manifest(str(workspace))
    guard = WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch))

    blocked_cases = [
        ("python3 -m venv .custom-env", str(workspace)),
        ("uv venv .env", str(workspace)),
        ("pip install requests", str(workspace)),
        ("npm install", str(workspace)),
        ("npm run build", str(workspace)),
        (f"cd {workspace} && pip3 install pandas", str(scratch)),
        (f"python3 -m venv {workspace}/.tmp-venv", str(scratch)),
        (f"npm install --prefix {workspace} lodash", str(scratch)),
    ]
    for cmd, exec_dir in blocked_cases:
        inv = _invocation(cmd, exec_dir)
        result = asyncio.run(guard(inv))
        assert result is not None and result.success is False, f"应拦截：{cmd}"
        assert "拒绝" in result.message and str(scratch.resolve()) in result.message
        assert inv.suspend_event is None


def test_scratch_and_readonly_commands_are_allowed(tmp_path):
    workspace = tmp_path / "notes"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()
    (workspace / "requirements.txt").write_text("requests\n", encoding="utf-8")

    guard = WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch))

    allowed_cases = [
        ("python3 -m venv .env && .env/bin/pip install requests", None),
        ("uv venv .env && uv pip install httpx", str(scratch)),
        (f"uv venv {scratch}/.venv", str(workspace)),
        (f"pip install -r {workspace}/requirements.txt", str(scratch)),
        ("pip list", str(workspace)),
        ("npm --version", str(workspace)),
        ("tsc --noEmit", str(workspace)),
        (f"python3 {scratch}/run.py {workspace}/brief.md", str(workspace)),
    ]
    for cmd, exec_dir in allowed_cases:
        inv = _invocation(cmd, exec_dir)
        result = asyncio.run(guard(inv))
        assert result is None, f"不应误拦：{cmd} -> {result}"
        assert inv.suspend_event is None, f"不应误触发审批：{cmd}"


def test_code_project_workspace_requires_approval_then_allows(tmp_path):
    workspace = tmp_path / "app"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()
    (workspace / "package.json").write_text('{"name":"demo"}', encoding="utf-8")

    assert has_project_manifest(str(workspace))
    guard = WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch))

    # 首次调用挂起审批
    inv = _invocation("npm install", str(workspace))
    result = asyncio.run(guard(inv))
    assert result is None
    assert isinstance(inv.suspend_event, ApprovalEvent)
    assert inv.suspend_event.rule == "workspace_guard:package_install"

    # 用户批准后放行一次
    approved = _invocation("npm install", str(workspace), approval=ApprovalStatus.APPROVED.value)
    assert asyncio.run(guard(approved)) is None
    assert approved.suspend_event is None

    # 同工作区但在 scratch 内建临时环境不需审批
    in_scratch = _invocation("python3 -m venv .tmp", str(scratch))
    assert asyncio.run(guard(in_scratch)) is None
    assert in_scratch.suspend_event is None


def test_local_shell_bridge_redirects_caches_and_temp_to_scratch(tmp_path):
    workspace = tmp_path / "ws"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()

    class _FakeExecutor:
        def register_root(self, root_id, path):
            pass

    bridge = LocalShellBridge(_FakeExecutor(), files=_make_scope(workspace, scratch), session_id="s1", run_id="r1")
    env = bridge._process_env()
    scratch_real = str(scratch.resolve())
    for key in ("TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "PIP_CACHE_DIR", "UV_CACHE_DIR", "npm_config_cache"):
        assert env[key].startswith(scratch_real), f"{key}={env.get(key)}"
    assert (scratch / "tmp").is_dir()
    assert (scratch / ".cache").is_dir()


def test_scan_snapshot_and_watcher_skip_conda_and_cachedir_markers(tmp_path):
    from watchfiles import Change

    root = tmp_path / "ws"
    root.mkdir()
    (root / "doc.md").write_text("# ok", encoding="utf-8")

    conda = root / ".my-conda"
    (conda / "conda-meta").mkdir(parents=True)
    (conda / "lib" / "pkg").mkdir(parents=True)
    (conda / "lib" / "pkg" / "readme.txt").write_text("conda", encoding="utf-8")

    cache = root / "custom-cache"
    cache.mkdir()
    (cache / "CACHEDIR.TAG").write_text("Signature: 8a477f597d28d172789f06886806bc55\n", encoding="utf-8")
    (cache / "data.md").write_text("cached", encoding="utf-8")

    info = root.stat()
    binding = RootBinding(root_id="r1", kind=RootKind.WORKSPACE_FOLDER, path=str(root), dev=info.st_dev, ino=info.st_ino)
    assert scan_binding(binding, (), FileLimits()).files == 1
    assert set(snapshot_binding(binding, (), FileLimits()).files) == {"doc.md"}

    accept = _watched(str(root))
    assert accept(Change.modified, str(root / "doc.md")) is True
    assert accept(Change.added, str(conda / "lib" / "pkg" / "readme.txt")) is False
    assert accept(Change.added, str(cache / "data.md")) is False


def _make_independent_scope(scratch: Path) -> FileScope:
    sc_root = AccessibleRoot(root_id="sc-1", path=str(scratch.resolve()), kind=RootKind.SESSION_WORKDIR)
    return FileScope(files=None, roots=[sc_root], working=sc_root)


def test_external_write_guard_requires_approval_for_workspace_and_independent_sessions(tmp_path):
    workspace = tmp_path / "ws"
    scratch = tmp_path / "scratch"
    outside = tmp_path / "outside"
    workspace.mkdir()
    scratch.mkdir()
    outside.mkdir()

    scopes = [
        ("workspace", WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch))),
        ("independent", WorkspaceShellGuard(_make_independent_scope(scratch), default_exec_dir=str(scratch))),
    ]
    external_commands = [
        "echo hi > ~/Desktop/report.html",
        "echo hi>~/Desktop/tight.html",
        "printf x >> ~/Desktop/append.txt",
        "echo hi >| ~/Downloads/clobber.txt",
        "cmd &> ~/Documents/all.log",
        "cmd 1> ~/Desktop/stdout.log",
        "cmd 2> ~/Desktop/stderr.log",
        "cp out.html ~/Desktop/out.html",
        f"cp -t {outside} out.html",
        f"mv out.html {outside}/out.html",
        "echo log | tee ~/Desktop/tee.log",
        f"mkdir -p {outside}/subdir",
        "curl -s https://example.com -o ~/Downloads/data.csv",
        "cd ~/Desktop && touch a.txt",
        'python3 -c "import os; open(os.path.expanduser(\'~/Desktop/a.html\'), \'w\').write(\'ok\')"',
        f"bash -c 'echo inner > {outside}/inner.txt'",
    ]

    for label, guard in scopes:
        for cmd in external_commands:
            inv = _invocation(cmd, str(scratch))
            result = asyncio.run(guard(inv))
            assert result is None, f"{label} 不应直接返回错误：{cmd}"
            assert isinstance(inv.suspend_event, ApprovalEvent), f"{label} 应触发外部写入审批：{cmd}"
            assert inv.suspend_event.rule == "workspace_guard:external_write"

            approved = _invocation(cmd, str(scratch), approval=ApprovalStatus.APPROVED.value)
            assert asyncio.run(guard(approved)) is None
            assert approved.suspend_event is None


def test_external_write_guard_allows_reads_temp_dev_and_session_roots(tmp_path):
    workspace = tmp_path / "ws"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()

    for guard in (
        WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch)),
        WorkspaceShellGuard(_make_independent_scope(scratch), default_exec_dir=str(scratch)),
    ):
        safe_commands = [
            "cat ~/Desktop/notes.txt",
            "cp ~/Downloads/source.csv ./source.csv",
            "ls -la ~/Desktop",
            "cd ~/Desktop && ls -la",
            "echo ok > /dev/null",
            "cmd > /tmp/tmp-out.log 2>&1",
            "python3 -c 'print(1 > 0)'",
            'echo "score > ~/Desktop/ignored" > out.txt',
            f"cp a.txt {scratch}/b.txt",
        ]
        for cmd in safe_commands:
            inv = _invocation(cmd, str(scratch))
            result = asyncio.run(guard(inv))
            assert result is None, f"安全命令不应被拒：{cmd} -> {result}"
            assert inv.suspend_event is None, f"安全命令不应触发审批：{cmd}"

    # 工作区会话允许写回绑定的工作区目录
    ws_guard = WorkspaceShellGuard(_make_scope(workspace, scratch), default_exec_dir=str(scratch))
    ws_inv = _invocation(f"cp deliverable.html {workspace}/deliverable.html", str(scratch))
    assert asyncio.run(ws_guard(ws_inv)) is None
    assert ws_inv.suspend_event is None
