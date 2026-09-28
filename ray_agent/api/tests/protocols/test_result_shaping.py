"""W2 验收 7：MCP 夹具返回 20,000 字符文本，模型只收到预览；完整内容在截断前落盘，用 read_file 能读到尾部标记。

真实 MCP 客户端与夹具服务、真实 Agent 循环与结果整形；模型用 ScriptedLLM，沙箱文件用内存替身。
"""
import json

import pytest

from app.domain.models.app_config import MCPConfig, MCPServerConfig
from app.domain.models.event import ToolEvent, ToolEventStatus
from app.domain.models.message import Message
from app.domain.services.context.shaping import output_path
from app.domain.services.tools.mcp import MCPTool
from app.infrastructure.protocols.mcp import MCPClientManager, tool_name
from tests.support.loop_harness import InMemorySandbox, make_loop
from tests.support.scripted_llm import Dynamic, text, tool_call


def _read_tail(request):
    """按预览给出的路径与总行数，读取最后 20 行。"""
    preview = json.loads(request.last_tool_content)["data"]
    return tool_call("read_file", {"filepath": preview["full_output_path"],
                                   "start_line": preview["total_lines"] - 20, "end_line": preview["total_lines"]},
                     id="c-tail")


@pytest.mark.anyio
async def test_mcp_long_text_is_previewed_and_tail_is_readable(servers):
    manager = MCPClientManager(MCPConfig(mcpServers={'test': MCPServerConfig(url=servers['mcp'] + '/mcp')}))
    mcp_tool = MCPTool(manager)
    await mcp_tool.initialize()
    try:
        assert not manager.errors, manager.errors
        sandbox = InMemorySandbox()

        async def write_output(path, content):
            result = await sandbox.write_file(path, content)
            assert result.success

        name = tool_name('test', 'long_text')
        h = make_loop([tool_call(name, {"length": 20000}, id="c-mcp"), Dynamic(_read_tail), text("尾部是标记")],
                      sandbox=sandbox, extra_tools=[mcp_tool], write_output=write_output,
                      tool_policy={"mcp:*": "allow"})
        events = [e async for e in h.loop.invoke(Message(message="调用 long_text 并读尾部"))]

        preview_content = h.llm.requests[1].last_tool_content
        assert len(preview_content) <= 8000 and "MCP_TAIL_MARKER" in preview_content  # 预览含尾段
        preview = json.loads(preview_content)["data"]
        path = output_path("c-mcp")
        assert preview["full_output_path"] == path and preview["total_chars"] > 20000
        # 完整内容来自截断前：20,000 字符的原文整段在文件里
        assert "mcp-line-00000" in sandbox.files[path] and sandbox.files[path].count("mcp-line-") >= 350
        tail = json.loads(h.llm.requests[2].last_tool_content)
        assert tail["success"] and "mcp-line-00356" in tail["data"]["content"]
        assert "\nMCP_TAIL_MARKER\n" in tail["data"]["content"]
        called = [e for e in events if isinstance(e, ToolEvent) and e.status == ToolEventStatus.CALLED]
        assert called[0].shaping.full_output_path == path
        assert called[1].shaping is None
    finally:
        await mcp_tool.cleanup()
