# MCP tools and product integration

Status: stub
Area: Protocols
Prerequisites: [02](02-models-and-tool-calling.md)、[03](03-react-loop.md)

## 1. Learning objectives and prerequisites

- 能说明 MCP `2026-07-28` 下 stdio 与 Streamable HTTP 两条已验证闭环在观察什么。
- 能找到产品客户端，并列出产品**不做**的能力（OAuth、resources 等）。
- 能区分「lab 客户端调用本地计算器」与「产品主循环把 MCP 当工具」。
- 前置：基线脚本无需模型 Key。接到产品需 Compose + 夹具。入口：[基础实验](../labs/foundations/README.md)、[API：MCP/A2A](../ray_agent/api/README.md#mcpa2a)。

## 2. Essential concepts and a runnable example

| 档位 | 脚本（`labs/foundations/`） |
|---|---|
| Support | `mcp_client_2026.py`（固定协议版本，不是独立练习） |
| Recommended | `6_6_mcp-server-demo.py` |
| Required | `6_7_mcp-client-demo.py`、`6_7_mcp-client-with-exit-stack.py` |
| Required | `6_9_mcp-code.py`（先起）+ `6_9_mcp-client.py` |
| Recommended | `6_7_ReAct-Agent-with-mcp.py`（需 Key） |
| Optional | `6_5_无MCP SDK调用高德MCP.py`、`6_8_mcp-bash.py`、`6_10_mcp-external-api.py`、`6_11_mcp-client-connect-api.py` |

已验证期望（阶段 2，本机复跑前可引用 labs README，复跑后改为当次输出）：

- `6_7`：发现 `calculator`，结果 `42`
- `6_9`：发现 `run_code`，结果 `42`

手写 `6_5` 用于看「不用 SDK 要自己处理什么」，不代表产品手写协议。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 官方 Client 适配 | `ray_agent/api/app/infrastructure/protocols/mcp.py` |
| 工具端口 | `domain/services/tools/mcp.py`、`protocol_gateway.py` |
| 设置页 | `ray_agent/ui/src/components/manus-settings.tsx`；`components/tool-use/mcp-tool.tsx` |
| 本地夹具 | `ray_agent/api/README.md` 中 `run-protocol-fixtures.sh` |

产品：每个连接由独立任务拥有；发现、调用、退出 SDK 上下文都在该任务里；调用者取消会关连接。禁用项不探测。Docker Desktop 里 API 访问宿主机用 `host.docker.internal`。

旧 MCP `sse` 传输已移除；页面任务事件 SSE 与 MCP 传输不是一回事。

## 4. Design rationale, limitations, and relevant failure behavior

- 产品只做发现、调用和结果展示。
- `called` 只表示调用结束；页面看 `outcome.success`。
- 工具失败可能让当前任务整轮结束；连测时把故意失败放在最后。
- 仓库 `config.yaml` 保持空集合；运行中配置在容器内，手改仓库 yaml 不会立刻生效。

## 5. Understanding checks or a focused observation experiment

- 为什么 `6_7` 通过不能写成「产品 MCP 已验收」？还缺哪几步？
- stdio 配置必须出现哪些字段？漏写 `transport` 会怎样（读设置/校验代码后填写）？
- 取消正在进行的 MCP 调用时，应观察到连接被关掉。依据哪个实现？
