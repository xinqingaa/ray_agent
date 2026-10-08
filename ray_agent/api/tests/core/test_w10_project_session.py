"""工作目录、附件同步与无项目提示词回归；废弃宿主机登记用例已移除。"""
import asyncio
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock
from app.domain.models.app_config import AgentConfig
from app.domain.models.file import File
from app.domain.models.project import SANDBOX_PROJECT_DIR
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
from tests.support.loop_harness import InMemorySandbox, make_uow_factory

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


def test_unbound_system_prompts_preserve_default_and_bound_workspace():
    assert SYSTEM_PROMPT == build_system_prompt(None)
    assert EN_SYSTEM_PROMPT == build_en_system_prompt(None)
    bound = build_system_prompt("/workspace")
    assert bound != SYSTEM_PROMPT
    assert "读写挂载" in bound and "也是默认工作目录" in bound
    assert "/home/ubuntu/upload" in bound and "/home/ubuntu/.rayagent/outputs" in bound
    assert "临时文件不要写进项目目录" in bound and "git" not in bound
    assert "工作目录为 /home/ubuntu（HOME 也是这个目录）" not in bound
    assert "你是 RayAgent" in bound and "<file_rules>" in bound
    en_bound = build_en_system_prompt("/workspace")
    assert "read-write mount" in en_bound and "git is available" not in en_bound
    assert "/home/ubuntu/upload" in en_bound and "/home/ubuntu/.rayagent/outputs" in en_bound
    assert "temporary files must not be written into the project" in en_bound
    assert "Working directory is /home/ubuntu (HOME is the same path)" not in en_bound
    assert en_bound.startswith(EN_SYSTEM_PROMPT.split("- Working directory", 1)[0])



def test_attachment_sync_failure_keeps_ids_and_prevents_model_input():
    import pytest
    from app.domain.models.event import MessageEvent

    async def run():
        first, second = File(filename="first.txt"), File(filename="second.txt")
        sandbox = InMemorySandbox()
        sandbox.upload_file = AsyncMock(side_effect=[ToolResult(success=True), ToolResult(success=False, message="disk full")])
        storage = SimpleNamespace(download_file=AsyncMock(side_effect=[(io.BytesIO(b"a"), first), (io.BytesIO(b"b"), second)]))
        runner = _runner(sandbox, storage, workspace_dir=None)
        event = MessageEvent(role="user", message="读取附件", attachments=[first, second])
        with pytest.raises(RuntimeError, match="准备执行环境失败.*同步失败"):
            await runner._sync_message_attachments_to_sandbox(event)
        assert [f.id for f in event.attachments] == [first.id, second.id]
        assert all(not f.filepath for f in event.attachments)
    asyncio.run(run())
