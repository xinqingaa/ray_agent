# MCP and A2A in the product

[06](06-mcp-labs.md)、[07](07-a2a-labs.md) 已跑通协议闭环。本课只看产品如何当客户端：设置页添加、发现、调用、结果进工具层。

入口：`infrastructure/protocols/mcp.py`、`a2a.py`；`domain/services/tools/mcp.py`、`a2a.py`；`manus-settings.tsx`。接到产品的步骤见 [API：MCP/A2A](../ray_agent/api/README.md#mcpa2a)。Compose 里访问宿主机用 `host.docker.internal`。

产品不做 OAuth、MCP resources、A2A 多轮人工续接。仓库 `config.yaml` 保持空集合。lab 通过 ≠ 产品已验收。
