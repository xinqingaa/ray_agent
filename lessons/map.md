# Learning map

把阶段 3 的章节、labs 脚本和产品模块对齐。本文是对照表，不重复 [架构说明](../docs/architecture.md) 或 [PLAN](../PLAN.md) 中的阶段状态。

各课正文见 [教学入口](README.md)。安装与运行命令以对应 lab / 服务 README 为准。

## How to use this map

1. 按 **01 → 15** 学。01–08 是 Part A（脚本），09–15 是 Part B（产品）。
2. Part A 只跑 `labs/`，不要把脚本里的一次工具调用写成产品 Plan + ReAct。
3. 需要模型 Key 的脚本用本机环境变量，不必先起 Compose。
4. Part B 从 [09](09-run-the-application.md) 才启动产品。B 不重讲脚本，只对照「A 里见过的现象落在产品哪里」。
5. 主张页面上的真实任务时，启动步骤链到 [运行指南](../ray_agent/README.md)。

## Part A · Labs（01–08）

| # | Lesson | 本课建立的能力 | 主线脚本 | 环境 |
|---|---|---|---|---|
| 01 | [Model API](01-model-api.md) | 发出一次 Chat Completions | `labs/foundations/3_4_DeepSeek API调用.py` | uv + Key |
| 02 | [Streaming output](02-streaming-output.md) | 同一类调用改成流式 | `3_4_DeepSeek API流式调用.py`；可选 `3_10` | uv + Key |
| 03 | [Tool calling and structured output](03-tool-calling.md) | tool calls、Pydantic、JSON | `3_7`、`3_8` 两条、`3_9` | uv + Key |
| 04 | [Context and ReAct](04-context-and-react.md) | 上下文长度；思考→调用→观察 | `4_2`、`4_3`；可选 `4_4` | uv + Key |
| 05 | [Async HTTP](05-async-http.md) | 同步 vs 异步，为 SSE 打底 | `4_5` 同步/异步、`4_6_FastAPI-Demo.py` | uv，无 Key |
| 06 | [MCP labs](06-mcp-labs.md) | stdio / Streamable HTTP 发现与调用 | Required：`6_7` 两个客户端、`6_9` 服务端+客户端 | 基线无 Key |
| 07 | [A2A labs](07-a2a-labs.md) | Agent Card、SDK 客户端、手写 JSON-RPC | `labs/a2a`：`main` → `client` / `httpx_a2a` | uv，无 Key |
| 08 | [Browser and CDP](08-browser-and-cdp.md) | 本机连浏览器的概念 | `10-6`；`10-4` 仅对照 | 视脚本，无 Compose |

A 结束时应能：调模型、看流式、看工具调用、跑一个 ReAct、跑通 MCP/A2A 闭环、知道 CDP 是什么。还没有 Planner、Redis、沙箱容器、设置页。

## Part B · RayAgent（09–15）

| # | Lesson | 本课建立的能力 | 对上 A | 环境 |
|---|---|---|---|---|
| 09 | [Run the application](09-run-the-application.md) | 起服务；UI → 规划 → 工具 → SSE → 历史走通一遍 | （第一次看整机） | Compose + Key |
| 10 | [Models and tools in the product](10-models-and-tools-in-the-product.md) | `LLM_*`、`BaseTool`、内置工具组装 | 01–03 | 读代码；可对照 09 |
| 11 | [Plan and ReAct](11-plan-and-react.md) | 外层拆步/更新/总结，内层才是 04 那种循环 | 04（labs 没有 Planner） | 09 的同一条任务 |
| 12 | [State and events](12-state-and-events.md) | 会话状态、Postgres、Redis、SSE、刷新后历史 | 05 | Compose |
| 13 | [Sandbox and storage](13-sandbox-and-storage.md) | 动态/已有沙箱、文件/Shell/浏览器、存储 | 08 + 09 的写文件 | Compose |
| 14 | [MCP and A2A in the product](14-mcp-and-a2a-in-the-product.md) | 设置页、夹具、产品只做发现/调用 | 06、07 | Compose + 夹具 |
| 15 | [Failure and change points](15-failure-and-change-points.md) | 取消、上限、断连、回收；改工具/策略先看哪些文件 | 全部 | Compose |

## Shared product observation

09 / 11 / 12 / 13 共用一条最小观察，不必每课另发明任务：

在 http://localhost:8088 新会话发送「在沙箱工作目录创建一个文本文件，写入 hello，再读取并告诉我内容」。对照计划步数、`write_file` / `read_file`、刷新后历史。

该任务在阶段 1 已作为产品闭环验收过。本阶段复跑后再写入各课观察。未复跑前标 `unverified`。

14 另用 [API 开发指南](../ray_agent/api/README.md#mcpa2a) 的本地夹具，不要把夹具地址写进仓库 `config.yaml`。

## Index by topic

方便按产品主题反查，不是学习顺序。

| 主题 | 课 |
|---|---|
| 模型 API / 流式 | 01、02、10 |
| 工具调用与结构化输出 | 03、10 |
| ReAct | 04、11 |
| 规划 | 11 |
| 异步 HTTP / SSE / 持久化 | 05、12 |
| 浏览器 / 沙箱 / 存储 | 08、13 |
| MCP | 06、14 |
| A2A | 07、14 |
| 失败与修改入口 | 15 |
| 一次完整产品对话 | 09 |

## Lab inventory

档位含义：

| 档位 | 含义 |
|---|---|
| Required | 写该课正文前应跑通，并把输出写进 lesson |
| Recommended | 有密钥或本机条件时建议跑 |
| Optional | 对照或外部依赖，不作阶段 3 验收 |
| Skip / Out of scope | 地图中点名，不作为教学内容 |
| Support | 被其他脚本引用的辅助模块，不是独立练习 |

安装方式见各目录 README。`foundations/` 顶层脚本与 `a2a/` 使用各自的 `pyproject.toml` / `uv.lock`。`demo-code/` 与 `2-2 code/` 是独立环境。

### foundations：模型与工具

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `3_4_DeepSeek API调用.py` | Required | 01 | 读 `DEEPSEEK_API_KEY` |
| `3_4_DeepSeek API流式调用.py` | Required | 02 | 流式输出 |
| `3_5_Kimi多模态API测试.py` | Optional | 01 | 多模态，非产品主路径 |
| `3_6_OpenAI SDK重构代码.py` | Optional | 01 | SDK 写法对照 |
| `3_6_OpenAI SDK重构多模态LLM调用.py` | Optional | 01 | 多模态 SDK |
| `3_7_为ReAct Agent添加计算工具.py` | Required | 03 | 工具调用 |
| `3_8_Pydantic解析数据.py` | Required | 03 | 结构化解析 |
| `3_8_Pydantic结合Tool Calls实现数据提取.py` | Required | 03 | schema + tool calls |
| `3_9_DeepSeek JSON Output示例.py` | Required | 03 | JSON 输出 |
| `3_10_使用流式输出提升响应速度.py` | Optional | 02 | 流式体验 |
| `3_11_DeepSeek语音播报助手.py` | Skip | — | 语音，产品主路径不覆盖 |

### foundations：上下文、ReAct、异步

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `4_2_计算消息上下文长度.py` | Required | 04 | 上下文长度 |
| `4_3_ReAct Agent为LLM添加CoT.py` | Required | 04 | 最小 ReAct |
| `4_4_ReAct+CoT实现企业业务表单填写.py` | Optional | 04 | 多步表单，仍不是产品 Planner |
| `4_5_同步咖啡店.py` | Required | 05 | 同步对照 |
| `4_5_异步咖啡店.py` | Required | 05 | 异步对照 |
| `4_6_FastAPI-Demo.py` | Required | 05 | 异步 HTTP |
| `4_6_FastAPI-Docs.py` | Optional | 05 | 文档示例 |

### foundations：MCP

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `mcp_client_2026.py` | Support | 06 | 固定 MCP `2026-07-28`，供客户端脚本引用 |
| `6_6_mcp-server-demo.py` | Recommended | 06 | stdio 计算器服务端；`6_7` 客户端会拉起同类服务 |
| `6_7_mcp-client-demo.py` | Required | 06 | 已验证：发现 `calculator`，结果 `42`；无需 Key |
| `6_7_mcp-client-with-exit-stack.py` | Required | 06 | 同上，关注生命周期 |
| `6_7_ReAct-Agent-with-mcp.py` | Optional | 06 | 已适配 MCP 2.2，需要模型 Key |
| `6_9_mcp-code.py` | Required | 06 | Streamable HTTP 服务端 |
| `6_9_mcp-client.py` | Required | 06 | 已验证：发现 `run_code`，结果 `42`；需先起服务端 |
| `6_5_无MCP SDK调用高德MCP.py` | Optional | 06 | 手写协议对照，需外部凭据 |
| `6_8_mcp-bash.py` | Optional | 06 | 依赖本机 Shell |
| `6_10_mcp-external-api.py` | Optional | 06 | 外部服务 |
| `6_11_mcp-client-connect-api.py` | Optional | 06 | 需 `BAIDU_MCP_TOKEN`，对端须支持目标协议 |

### foundations：浏览器

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `10-6 使用Playwright简化CDP连接.py` | Required | 08 | CDP / Playwright 概念，不是产品沙箱 |
| `10-4 browser-use本地操控实例.py` | Optional | 08 | 对照，不代表产品实现 |
| `10-4 browser-use远程操控实例.py` | Optional | 08 | 对照，不代表产品实现 |

### foundations：历史综合（不进教学基线）

| 入口 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `demo-code/demo-llm.py`、`demo-agent.py` | Out of scope | — | 独立环境，非阶段 2 协议基线 |
| `2-2 code/weather/` | Out of scope | 07 仅点名 | 旧综合 / 旧 SDK 参考 |
| `2-2 code/ui/` | Out of scope | 07 仅点名 | 依赖仓库未包含的上游模块，不能写成可运行示例 |

### a2a

| 脚本 | 档位 | 挂课 | 备注 |
|---|---|---|---|
| `main.py` | Required | 07 | 1.0 Agent Card + 路由，监听 `9999` |
| `agent_executor.py` | Required | 07 | 默认确定性回复；可切模型模式 |
| `client.py` | Required | 07 | SDK 客户端；期望 `A2A_LAB_OK:ray-agent-lab` |
| `httpx_a2a.py` | Required | 07 | 手写 JSON-RPC 对照 |

A2A 基线无需模型 Key。`A2A_LAB_MODE=deepseek` 为 Optional，不属于已验证验收。

## Product modules (quick index)

路径相对于仓库根。详细职责见架构说明与各服务 README。主要在 Part B 使用。

| 主题 | 路径 | 挂课 |
|---|---|---|
| 会话入口 | `ray_agent/api/app/interfaces/endpoints/session_routes.py` | 09、12 |
| 任务准备 | `ray_agent/api/app/application/services/agent_service.py` | 09 |
| 任务运行 | `ray_agent/api/app/domain/services/agent_task_runner.py` | 09、15 |
| 外层规划 | `ray_agent/api/app/domain/services/flows/planner_react.py` | 11 |
| 内层 Agent | `domain/services/agents/base.py`、`react.py`、`planner.py`、`step_guard.py` | 10、11、15 |
| 工具声明 | `ray_agent/api/app/domain/services/tools/` | 10、13、14 |
| 协议适配 | `ray_agent/api/app/infrastructure/protocols/` | 14、15 |
| 事件与 SSE | `domain/models/event.py`、`interfaces/schemas/event.py` | 12 |
| 任务流 | `infrastructure/external/task/redis_stream_task.py` | 12 |
| 沙箱 | `docker_sandbox.py`；`ray_agent/sandbox/` | 13 |
| 前端事件 | `ray_agent/ui/src/lib/session-events.ts`、`hooks/use-session-detail.ts` | 12 |
| 设置与协议 | `manus-settings.tsx`；`ray_agent/api/README.md` 的 MCP/A2A 节 | 14 |

## Writing status

| 文档 | 状态 |
|---|---|
| 本地图 | 已按 01–15、Part A/B 重排；路径来自现有 README / 架构说明，本机尚未按表复跑 |
| 01–15 | 骨架：只写本课做什么、跑什么、不讲什么 |

填写某一课时：打开本表对应行 → 跑列出的 lab 或看列出的产品路径 → 用观察写正文 → 未跑步骤保留 `unverified`。
