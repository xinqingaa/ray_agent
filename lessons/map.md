# Learning map

把阶段 3 的章节、labs 脚本和产品模块对齐。本文是对照表，不重复 [架构说明](../docs/architecture.md) 或 [PLAN](../PLAN.md) 中的阶段状态。

各课正文见 [教学入口](README.md)。安装与运行命令以对应 lab / 服务 README 为准。

## How to use this map

1. 按 01 → 09 的顺序学习；后面的课默认前面的概念已经建立。
2. 先跑该课标为 Required / Recommended 的 lab（若有），再读产品入口。
3. 一条 lab 里的工具调用不能当成产品 Plan + ReAct 已验证。
4. 需要模型密钥的脚本，在本机环境变量中配置，不必先起产品 Compose。
5. 主张「页面上的真实任务」时，再按 [运行指南](../ray_agent/README.md) 启动产品。

## Lesson order

| Lesson | Area | 先建立的概念 | Labs | 产品入口 | 运行条件 | PLAN 完成标准 |
|---|---|---|---|---|---|---|
| [01 Application flow](01-application-flow.md) | Application flow | 一次对话经过哪些模块 | 无对应 lab（避免用练习冒充产品闭环） | UI `sessions/[id]`；`session_routes` → `AgentService` → `AgentTaskRunner` → `PlannerReActFlow` | 第一稿可读代码；验收需 Compose + 写文件任务 | 完整链路 |
| [02 Models and tool calling](02-models-and-tool-calling.md) | Models and tools | Chat Completions、流式、tool calls、结构化输出 | Recommended：`3_4`、`3_7`、`3_8`、`3_9`；Optional：`3_5`、`3_6`、`3_10`；Skip：`3_11` | 模型适配；`tools/base.py`、`tool.py`、`tool_call_compat.py` | 本机 uv + 模型 Key | 模型与工具 |
| [03 ReAct loop](03-react-loop.md) | Models and tools | 思考 → 调用 → 观察 → 再思考 | Recommended：`4_2`、`4_3`、`4_4`；有 Key 可加 `6_7_ReAct-Agent-with-mcp` | `agents/base.py`、`react.py`、`step_guard.py`、react prompts | 本机 uv + Key | ReAct 分工 |
| [04 Planning](04-planning.md) | Planning | 外层拆步、更新计划、总结；内层才是 ReAct | 无对应 lab（须写明：ReAct 脚本 ≠ Planner） | `flows/planner_react.py`、`agents/planner.py`、planner prompts | 读代码 + 日后看页面计划面板 | Plan 与 ReAct 分工 |
| [05 State and events](05-state-and-events.md) | State and events | 会话状态、事件落库、Redis 流、SSE、刷新后历史 | Recommended：`4_5` 同步/异步、`4_6` FastAPI | `domain/models/event.py`；`interfaces/schemas/event.py`；`redis_stream_task.py`；UI `session-events.ts` | lab 不用 Docker；看实时流需 Compose | 状态归属、存储位置 |
| [06 Sandbox](06-sandbox.md) | Sandbox | 文件 / Shell / 浏览器 / 存储；动态 vs 已有沙箱 | Recommended：`10-6`；`10-4` 仅作对照 | `tools/file.py` `shell.py` `browser.py`；`docker_sandbox.py`；沙箱服务；UI VNC | 文件任务要 Compose；浏览器另验 | 沙箱与存储 |
| [07 MCP](07-mcp.md) | Protocols | 发现与调用；stdio vs Streamable HTTP | Required：`6_7` 两个客户端、`6_9` 服务端+客户端；Contrast：`6_5`；Optional：`6_8` `6_10` `6_11` | `infrastructure/protocols/mcp.py`；`tools/mcp.py`；设置页；协议夹具 | 基线只要 uv；接到产品要 Compose + 夹具 | MCP 与产品接入 |
| [08 A2A](08-a2a.md) | Protocols | Agent Card、SDK 客户端、手写 JSON-RPC | Required：`labs/a2a` 的 `main` / `client` / `httpx_a2a`；Optional：模型模式；Out of scope：`2-2 code/` | `infrastructure/protocols/a2a.py`；`tools/a2a.py`；设置页；协议夹具 | 基线只要 uv，无 Key | A2A 与产品接入 |
| [09 Failure behavior](09-failure-behavior.md) | Failure behavior | 取消、迭代上限、断连、资源释放、协议失败 | 无独立失败 lab；可借用夹具固定失败 | `step_guard.py`、`task_error.py`、任务取消、MCP 连接随任务取消、沙箱 TTL | 读代码先写；取消/失败要 Compose | 失败与限制；改工具/策略的入口 |

## Shared product observation

产品起来后，01 / 04 / 05 / 06 共用一条最小观察，不必每课另发明任务：

在 http://localhost:8088 新会话发送「在沙箱工作目录创建一个文本文件，写入 hello，再读取并告诉我内容」。对照计划步数、`write_file` / `read_file`、刷新后历史。

该任务在阶段 1 已作为产品闭环验收过。本阶段复跑时再写入各课的观察记录。未复跑前标 `unverified`。

协议接到产品时，另用 [API 开发指南](../ray_agent/api/README.md#mcpa2a) 中的本地夹具，不要把夹具地址写进仓库 `config.yaml`。

## Lab inventory

档位含义：

| 档位 | 含义 |
|---|---|
| Required | 写该课正文前应跑通，并把输出写进 lesson |
| Recommended | 有密钥或本机条件时建议跑，帮助对照产品 |
| Optional | 对照或外部依赖，不作阶段 3 验收 |
| Skip / Out of scope | 地图中点名，不作为教学内容 |
| Support | 被其他脚本引用的辅助模块，不是独立练习 |

安装方式见各目录 README。`foundations/` 顶层脚本与 `a2a/` 使用各自的 `pyproject.toml` / `uv.lock`。`demo-code/` 与 `2-2 code/` 是独立环境。

### foundations：模型与工具

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `3_4_DeepSeek API调用.py` | Recommended | 02 | 读 `DEEPSEEK_API_KEY` |
| `3_4_DeepSeek API流式调用.py` | Recommended | 02 | 流式输出 |
| `3_5_Kimi多模态API测试.py` | Optional | 02 | 多模态，非产品主路径 |
| `3_6_OpenAI SDK重构代码.py` | Optional | 02 | SDK 写法对照 |
| `3_6_OpenAI SDK重构多模态LLM调用.py` | Optional | 02 | 多模态 SDK |
| `3_7_为ReAct Agent添加计算工具.py` | Recommended | 02 | 工具调用 |
| `3_8_Pydantic解析数据.py` | Recommended | 02 | 结构化解析 |
| `3_8_Pydantic结合Tool Calls实现数据提取.py` | Recommended | 02 | schema + tool calls |
| `3_9_DeepSeek JSON Output示例.py` | Recommended | 02 | JSON 输出 |
| `3_10_使用流式输出提升响应速度.py` | Optional | 02 / 05 | 流式体验 |
| `3_11_DeepSeek语音播报助手.py` | Skip | — | 语音，产品主路径不覆盖 |

### foundations：上下文、ReAct、异步

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `4_2_计算消息上下文长度.py` | Recommended | 03 | 上下文长度 |
| `4_3_ReAct Agent为LLM添加CoT.py` | Recommended | 03 | 最小 ReAct |
| `4_4_ReAct+CoT实现企业业务表单填写.py` | Recommended | 03 | 多步表单，仍不是产品 Planner |
| `4_5_同步咖啡店.py` | Recommended | 05 | 同步对照 |
| `4_5_异步咖啡店.py` | Recommended | 05 | 异步对照 |
| `4_6_FastAPI-Demo.py` | Recommended | 05 | 异步 HTTP |
| `4_6_FastAPI-Docs.py` | Optional | 05 | 文档示例 |

### foundations：MCP

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `mcp_client_2026.py` | Support | 07 | 固定 MCP `2026-07-28`，供客户端脚本引用 |
| `6_6_mcp-server-demo.py` | Recommended | 07 | stdio 计算器服务端；`6_7` 客户端会拉起同类服务 |
| `6_7_mcp-client-demo.py` | Required | 07 | 已验证：发现 `calculator`，结果 `42`；无需 Key |
| `6_7_mcp-client-with-exit-stack.py` | Required | 07 | 同上，关注生命周期 |
| `6_7_ReAct-Agent-with-mcp.py` | Recommended | 03 / 07 | 已适配 MCP 2.2，需要模型 Key |
| `6_9_mcp-code.py` | Required | 07 | Streamable HTTP 服务端 |
| `6_9_mcp-client.py` | Required | 07 | 已验证：发现 `run_code`，结果 `42`；需先起服务端 |
| `6_5_无MCP SDK调用高德MCP.py` | Optional | 07 | 手写协议对照，需外部凭据 |
| `6_8_mcp-bash.py` | Optional | 07 | 依赖本机 Shell |
| `6_10_mcp-external-api.py` | Optional | 07 | 外部服务 |
| `6_11_mcp-client-connect-api.py` | Optional | 07 | 需 `BAIDU_MCP_TOKEN`，对端须支持目标协议 |

### foundations：浏览器

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `10-6 使用Playwright简化CDP连接.py` | Recommended | 06 | CDP / Playwright 概念 |
| `10-4 browser-use本地操控实例.py` | Optional | 06 | 对照，不代表产品实现 |
| `10-4 browser-use远程操控实例.py` | Optional | 06 | 对照，不代表产品实现 |

### foundations：历史综合（不进教学基线）

| 入口 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `demo-code/demo-llm.py`、`demo-agent.py` | Out of scope | — | 独立环境，非阶段 2 协议基线 |
| `2-2 code/weather/` | Out of scope | 08 仅点名 | 旧综合 / 旧 SDK 参考 |
| `2-2 code/ui/` | Out of scope | 08 仅点名 | 依赖仓库未包含的上游模块，不能写成可运行示例 |

### a2a

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `main.py` | Required | 08 | 1.0 Agent Card + 路由，监听 `9999` |
| `agent_executor.py` | Required | 08 | 默认确定性回复；可切模型模式 |
| `client.py` | Required | 08 | SDK 客户端；期望 `A2A_LAB_OK:ray-agent-lab` |
| `httpx_a2a.py` | Required | 08 | 手写 JSON-RPC 对照 |

A2A 基线无需模型 Key。`A2A_LAB_MODE=deepseek` 为 Optional，不属于已验证验收。

## Product modules (quick index)

路径相对于仓库根。详细职责见架构说明与各服务 README。

| 主题 | 路径 |
|---|---|
| 会话入口 | `ray_agent/api/app/interfaces/endpoints/session_routes.py` |
| 任务准备 | `ray_agent/api/app/application/services/agent_service.py` |
| 任务运行 | `ray_agent/api/app/domain/services/agent_task_runner.py` |
| 外层规划 | `ray_agent/api/app/domain/services/flows/planner_react.py` |
| 内层 Agent | `ray_agent/api/app/domain/services/agents/base.py`、`react.py`、`planner.py`、`step_guard.py` |
| 工具声明 | `ray_agent/api/app/domain/services/tools/` |
| 协议适配 | `ray_agent/api/app/infrastructure/protocols/` |
| 事件与 SSE | `ray_agent/api/app/domain/models/event.py`、`interfaces/schemas/event.py` |
| 任务流 | `ray_agent/api/app/infrastructure/external/task/redis_stream_task.py` |
| 沙箱 | `ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py`；`ray_agent/sandbox/` |
| 前端事件 | `ray_agent/ui/src/lib/session-events.ts`、`hooks/use-session-detail.ts` |
| 设置与协议 | `ray_agent/ui/src/components/manus-settings.tsx`；`ray_agent/api/README.md` 的 MCP/A2A 节 |

## Writing status

| 文档 | 状态 |
|---|---|
| 本地图 | 骨架已建，路径来自现有 README / 架构说明，本机尚未按表复跑 labs |
| 01–09 | stub：元数据与五段标题已就绪，正文待写 |

填写某一课时：打开本表对应行 → 读列出的产品文件 → 跑列出的 lab → 用观察写正文 → 未跑步骤保留 `unverified`。
