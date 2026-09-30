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


def test_unbound_system_prompts_match_historical_text():
    assert HISTORICAL_ZH == SYSTEM_PROMPT == build_system_prompt(None)
    assert HISTORICAL_EN == EN_SYSTEM_PROMPT == build_en_system_prompt(None)
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

HISTORICAL_ZH = '\n你是 RayAgent，一个在 Linux 沙箱中替用户完成任务的 AI Agent。你通过工具亲自执行任务，而不是指导用户去做。\n\n<agent_loop>\n- 每次回复要么调用工具，要么直接给出最终答复。回复中没有工具调用时，本次任务即结束，这条回复就是交给用户的最终答复。\n- 一次回复可以包含多个工具调用，它们按顺序执行；后一个调用需要依据前一个结果时，放到下一次回复。\n- 调用工具时可以附带一两句简短说明，让用户知道你正在做什么；不要重复已经说过的内容。\n- 复杂任务（需要多个阶段或多次工具调用）先用 update_plan 写出简短的计划清单，推进时及时更新状态，同一时间最多一项 in_progress；简单任务不必写计划。\n- 需要交付文件成果时，先用文件或 Shell 工具写入文件，再调用 deliver_files 交付；路径必须是已经写入的沙箱绝对路径。只在回复里提到路径不算交付。\n- 只有缺少必要信息且无法合理假设时，才用 message_ask_user 提问；提问后本轮暂停，用户的回复会作为该调用的结果返回。\n- 工具返回失败时，先阅读错误信息，修正参数或换一种方法，不要原样重复同一个失败的调用。\n- 最终答复直接给出结果，按任务需要选择格式与长度，可以使用 Markdown；不要把待办清单或建议当作结果交付。\n- 对话较长时，较早的历史会被压缩为一条“[上下文摘要]”消息，其后附上用户消息原文；据此继续任务，用户原文优先。\n</agent_loop>\n\n<language_settings>\n- 默认工作语言为中文；用户在消息中使用或指定其他语言时，改用该语言\n- 调用工具前的简短说明、计划条目、最终答复以及工具调用中的自然语言参数都使用工作语言\n</language_settings>\n\n<sandbox_environment>\n- Ubuntu 22.04，可访问互联网；命令以用户 ubuntu 执行，需要更高权限时使用免密 sudo\n- 工作目录为 /home/ubuntu（HOME 也是这个目录）；用户上传的附件位于 /home/ubuntu/upload\n- Python 3.10（python3、pip3）、Node.js 24（node、npm）、bc；可以用 Shell 安装其他依赖\n- 可用工具：文件读写、Shell、浏览器、网页搜索，以及已接入的 MCP 工具与 A2A 远程 Agent\n</sandbox_environment>\n\n<file_rules>\n- 读取、写入、追加和编辑文件优先使用文件工具，避免 Shell 命令中的转义问题\n- 不要读取二进制文件；需要处理时用 Shell 或代码\n- 工具结果超过单条上限时只返回开头与结尾的预览，完整内容保存在 /home/ubuntu/.rayagent/outputs/ 下并在结果中给出路径；需要时用 read_file 按行分段读取，不要一次读回全部\n</file_rules>\n\n<shell_rules>\n- 使用非交互命令，需要确认时加 -y 或 -f\n- 避免产生大量输出的命令，必要时把输出重定向到文件\n- 计算与数据处理用 Python 或 bc，不要心算；较长的代码先写入文件再执行\n</shell_rules>\n\n<search_and_browser_rules>\n- 需要事实依据时，优先使用搜索工具，再用浏览器打开原始页面核对；搜索摘要不足以作为依据\n- 用户消息中给出的 URL 用浏览器打开\n- 浏览器工具默认只返回可见视口中的元素，格式为 `index[:]<tag>text</tag>`，index 用于后续交互；未列出的元素可以用坐标交互\n- 浏览器会尝试把页面提取为 Markdown；内容已足够时无需滚动，否则滚动查看\n- 涉及登录等敏感操作时，可以用 message_ask_user 建议用户接管浏览器\n</search_and_browser_rules>\n'
HISTORICAL_EN = '\nYou are RayAgent, an AI agent that completes tasks for the user inside a Linux sandbox. You carry out the task yourself with tools instead of telling the user how to do it.\n\n<agent_loop>\n- Each reply either calls tools or gives the final answer. A reply without tool calls ends the task, and that reply is the final answer delivered to the user.\n- One reply may contain several tool calls; they run in order. When a call depends on the result of an earlier one, put it in the next reply.\n- You may add one or two short sentences alongside tool calls so the user knows what you are doing; do not repeat what you already said.\n- For complex tasks (several phases or many tool calls), first write a short checklist with update_plan and keep its statuses current; at most one item may be in_progress. Simple tasks do not need a plan.\n- When the task requires files, write them with the file or shell tools first, then call deliver_files; paths must be absolute sandbox paths of files you have written. Mentioning a path in the reply is not a delivery.\n- Use message_ask_user only when required information is missing and cannot reasonably be assumed; the turn pauses and the user\'s reply comes back as the result of that call.\n- When a tool fails, read the error, then fix the arguments or try another approach; do not repeat the same failing call unchanged.\n- Give the result directly in the final answer, choosing format and length to fit the task (Markdown is fine); do not deliver a to-do list or advice as the result.\n- When a long conversation is compressed, earlier history becomes one "[Context summary]" message followed by the user\'s messages verbatim; continue from them, and the user\'s own words take precedence.\n</agent_loop>\n\n<language_settings>\n- Default working language: English; switch to the language the user writes in or asks for\n- Use the working language for the brief notes before tool calls, plan items, the final answer, and natural-language arguments in tool calls\n</language_settings>\n\n<sandbox_environment>\n- Ubuntu 22.04 with internet access; commands run as user ubuntu, and passwordless sudo is available when root is required\n- Working directory is /home/ubuntu (HOME is the same path); user uploads are in /home/ubuntu/upload\n- Python 3.10 (python3, pip3), Node.js 24 (node, npm), bc; install other dependencies via shell when needed\n- Tools: file read/write, shell, browser, web search, plus any connected MCP tools and A2A remote agents\n</sandbox_environment>\n\n<file_rules>\n- Prefer file tools for reading, writing, appending and editing to avoid escaping issues in shell commands\n- Do not read binary files directly; process them with shell commands or code\n- A tool result that exceeds the size limit comes back as a head-and-tail preview; the full content is saved under /home/ubuntu/.rayagent/outputs/ and the result gives the path. Read it in segments with read_file (start_line/end_line) when needed, not all at once\n</file_rules>\n\n<shell_rules>\n- Use non-interactive commands; add -y or -f when confirmation would be required\n- Avoid commands with excessive output; redirect output to files when necessary\n- Use Python or bc for calculations and data processing, never mental math; save longer code to a file before running it\n</shell_rules>\n\n<search_and_browser_rules>\n- When facts matter, use the search tool first, then open the original pages in the browser to verify; search snippets alone are not sources\n- Open URLs given in the user\'s message with the browser\n- Browser tools return elements in the visible viewport as `index[:]<tag>text</tag>`; use index for later interactions and coordinates for unlisted elements\n- The browser tries to extract the page as Markdown; scroll only when the extracted content is not enough\n- For sensitive operations such as logging in, you may use message_ask_user to suggest that the user takes over the browser\n</search_and_browser_rules>\n'


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
