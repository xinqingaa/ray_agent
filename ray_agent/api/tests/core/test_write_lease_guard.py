"""工作区写入租约连续冲突熔断测试。"""
import asyncio
import os
from pathlib import Path
from types import SimpleNamespace

from app.application.services.root_access import StaticBindings, accessible
from app.domain.external.workspace_files import RootBinding, WorkspaceFileError
from app.domain.models.app_config import AgentConfig
from app.domain.models.error import ErrorCode
from app.domain.models.event import ToolEvent, ToolEventStatus
from app.domain.models.identity import RootKind
from app.domain.models.message import Message
from app.domain.models.session import Session
from app.domain.models.tool_result import ToolResult
from app.domain.services.file_scope import FileScope
from app.domain.services.flows.agent_loop import AgentLoop
from app.domain.services.tools.base import BaseTool
from app.domain.services.tools.file import FileTool
from app.domain.services.tools.shell import ShellTool
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from tests.support.loop_harness import make_uow_factory
from tests.support.scripted_llm import ScriptedLLM, ScriptedToolCall, text, tool_call


def _conflict_error(lease_id: str = "lease-1", owner_session_id: str = "s-other") -> WorkspaceFileError:
    return WorkspaceFileError(
        ErrorCode.CONFLICT,
        f"工作区文件夹被会话 {owner_session_id} 占用（Shell 与脚本执行）：正在持续执行命令，属于稳定占用",
        details={
            "lease": {
                "id": lease_id,
                "state": "held",
                "writer_kind": "process",
                "owner_session_id": owner_session_id,
                "owner_run_id": "run-other",
                "operation": None,
                "reason": "Shell 与脚本执行",
                "acquired_at": 1700000000000,
            }
        },
    )


def test_lease_conflict_circuit_breaker_trips_and_allows_reads_and_scratch_writes(tmp_path):
    workspace = tmp_path / "ws"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()
    (workspace / "notes.md").write_text("只读材料", encoding="utf-8")

    ws_binding = RootBinding(root_id="ws-1", kind=RootKind.WORKSPACE_FOLDER, path=str(workspace.resolve()))
    sc_binding = RootBinding(root_id="sc-1", kind=RootKind.SESSION_WORKDIR, path=str(scratch.resolve()))
    raw_files = PosixWorkspaceFiles(StaticBindings([ws_binding, sc_binding]))

    gate_state = {"conflict": True, "lease_id": "lease-1"}
    gate_calls = []

    class _ConflictGate:
        async def write_bytes(self, path, data, expected, owner):
            gate_calls.append(("write_bytes", path.relative_path))
            if gate_state["conflict"]:
                raise _conflict_error(lease_id=gate_state["lease_id"])
            return await raw_files.write_bytes(path, data, expected)

        async def write_stream(self, path, source, expected, owner):
            return await self.write_bytes(path, source.read(), expected, owner)

    scope = FileScope(
        raw_files,
        [accessible(ws_binding), accessible(sc_binding)],
        working=accessible(ws_binding),
        gate=_ConflictGate(),
        gated_root_id="ws-1",
    )

    shell_calls = []

    class _ConflictShell:
        async def exec_command(self, session_id, exec_dir, command):
            shell_calls.append(command)
            if gate_state["conflict"]:
                raise _conflict_error(lease_id=gate_state["lease_id"])
            return ToolResult(success=True, message="success", data={"status": "completed", "returncode": 0, "output": "ok"})

        async def read_shell_output(self, session_id, console=False):
            return ToolResult(success=True, data={"output": ""})

        async def wait_process(self, session_id, seconds=None):
            return ToolResult(success=True, data={"status": "completed", "returncode": 0})

        async def write_shell_input(self, session_id, input_text, press_enter=True):
            return ToolResult(success=True)

        async def kill_process(self, session_id):
            return ToolResult(success=True)

    session = Session(id="s-breaker", workspace_id="w1")
    llm = ScriptedLLM([
        # 第 1 次工作区写入冲突（count=1）
        tool_call("write_file", {"filepath": "out.md", "content": "one"}, id="c1"),
        # 第 2 次 Shell 同一租约冲突（count=2 -> 触发熔断）
        tool_call("shell_execute", {"session_id": "sh1", "command": "echo hi"}, id="c2"),
        # 第 3 次工作区写入应被管线短路，不触达 _ConflictGate
        tool_call("write_file", {"filepath": "out.md", "content": "three"}, id="c3"),
        # 第 4 次工作区 replace_in_file 也应被短路
        tool_call("replace_in_file", {"filepath": "notes.md", "old_str": "只读", "new_str": "改写"}, id="c4"),
        # 第 5 次只读工作区文件与写入 scratch 仍应正常放行
        tool_call("read_file", {"filepath": "notes.md"}, id="c5"),
        tool_call("write_file", {"filepath": str(scratch.resolve() / "deliverable.md"), "content": "临时产出"}, id="c6"),
        text("已将成果写入会话目录。"),
    ])
    loop = AgentLoop(
        uow_factory=make_uow_factory(session),
        llm=llm,
        agent_config=AgentConfig(max_iterations=12, max_retries=2),
        session_id=session.id,
        tools=[FileTool(scope), ShellTool(sandbox=_ConflictShell(), default_exec_dir=str(scratch.resolve()))],
        retry_interval=0,
    )

    async def run_first():
        return [e.model_copy(deep=True) async for e in loop.invoke(Message(message="开始写入"))]

    events = asyncio.run(asyncio.wait_for(run_first(), 5))
    called = {e.tool_call_id: e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED}

    assert called["c1"].function_result.success is False
    assert called["c2"].function_result.success is False
    assert called["c2"].function_result.data.get("circuit_open") is True
    # c3 与 c4 均被熔断短路，没有再次调用底层门控或 Shell
    assert called["c3"].function_result.success is False
    assert called["c3"].function_result.data.get("circuit_open") is True
    assert called["c4"].function_result.success is False
    assert called["c4"].function_result.data.get("circuit_open") is True
    assert gate_calls == [("write_bytes", "out.md")]
    assert shell_calls == ["echo hi"]

    # 熔断期间读工作区与写 scratch 正常执行
    assert called["c5"].function_result.success is True
    assert "只读材料" in called["c5"].function_result.data["content"]
    assert called["c6"].function_result.success is True
    assert (scratch / "deliverable.md").read_text(encoding="utf-8") == "临时产出"

    # 下一次新运行通过 _begin() 重置熔断，释放冲突后工作区写入恢复成功
    gate_state["conflict"] = False
    llm._script.extend([
        tool_call("write_file", {"filepath": "out.md", "content": "recovered"}, id="c7"),
        text("恢复完成"),
    ])

    async def run_second():
        return [e.model_copy(deep=True) async for e in loop.invoke(Message(message="再写一次"))]

    events2 = asyncio.run(asyncio.wait_for(run_second(), 5))
    called2 = {e.tool_call_id: e for e in events2 if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED}
    assert called2["c7"].function_result.success is True
    assert (workspace / "out.md").read_text(encoding="utf-8") == "recovered"


def test_lease_conflict_guard_resets_counter_on_new_lease_or_success(tmp_path):
    from app.domain.services.flows.tool_pipeline import ToolInvocation
    from app.domain.services.write_lease_guard import WriteLeaseConflictGuard

    workspace = tmp_path / "ws"
    scratch = tmp_path / "scratch"
    workspace.mkdir()
    scratch.mkdir()
    ws_binding = RootBinding(root_id="ws-1", kind=RootKind.WORKSPACE_FOLDER, path=str(workspace.resolve()))
    sc_binding = RootBinding(root_id="sc-1", kind=RootKind.SESSION_WORKDIR, path=str(scratch.resolve()))
    scope = FileScope(
        PosixWorkspaceFiles(StaticBindings([ws_binding, sc_binding])),
        [accessible(ws_binding), accessible(sc_binding)],
        working=accessible(ws_binding),
    )
    guard = WriteLeaseConflictGuard(scope)

    def inv(name: str, args: dict) -> ToolInvocation:
        return ToolInvocation(call_id="c", function_name=name, raw_arguments="{}", arguments=args)

    err_a = _conflict_error(lease_id="lease-a", owner_session_id="s-a")
    err_b = _conflict_error(lease_id="lease-b", owner_session_id="s-b")
    res_a = ToolResult(success=False, message=str(err_a), data={"code": err_a.code.value, "details": err_a.details})
    res_b = ToolResult(success=False, message=str(err_b), data={"code": err_b.code.value, "details": err_b.details})

    # lease-a 遇到 1 次，换为 lease-b 应重新计数为 1（不立即熔断）
    r1 = asyncio.run(guard.after(inv("write_file", {"filepath": "a.md"}), res_a))
    assert not r1.data.get("circuit_open")
    r2 = asyncio.run(guard.after(inv("write_file", {"filepath": "a.md"}), res_b))
    assert not r2.data.get("circuit_open")
    # lease-b 第 2 次才触发熔断
    r3 = asyncio.run(guard.after(inv("shell_execute", {"session_id": "sh", "command": "ls"}), res_b))
    assert r3.data.get("circuit_open") is True
    assert asyncio.run(guard.before(inv("write_file", {"filepath": "a.md"}))) is not None
    # 写入 scratch 不被熔断，也不重置工作区熔断状态
    assert asyncio.run(guard.before(inv("write_file", {"filepath": str(scratch.resolve() / "ok.md")}))) is None
    assert asyncio.run(guard.before(inv("write_file", {"filepath": "a.md"}))) is not None
    # 一次工作区成功写入重置计数
    asyncio.run(guard.after(inv("write_file", {"filepath": "a.md"}), ToolResult(success=True, message="ok")))
    assert asyncio.run(guard.before(inv("write_file", {"filepath": "a.md"}))) is None
