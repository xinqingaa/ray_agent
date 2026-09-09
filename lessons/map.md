# Learning Map

本文维护课程的素材与实现入口。阅读顺序见 [目录](README.md)，设计边界见 [课程约定](AGENTS.md)，制作及验证状态见 [progress](progress.md)。以下源码是研究入口，不代替对完整调用链的核对。

## Chapter materials

| 章节 | 素材与实现入口 | 环境边界 |
|---|---|---|
| [01 · 认识 RayAgent：从一句请求到任务完成](01-the-rayagent-system.md) | [架构说明](../docs/architecture.md)；[作者核对入口](#chapter-01-evidence) | 概念阅读，无需启动服务 |
| [02 · 与模型交互](02-model-interaction.md) | `labs/foundations/3_4` 同模型同输入对照；[作者核对入口](#chapter-02-evidence) | foundations 环境 + 模型配置 |
| [03 · 工具与行动](03-tools-and-actions.md) | `labs/foundations/3_7`、`3_8`、`3_9` | foundations 环境；按脚本配置模型 |
| [04 · Agent Loop 与 ReAct](04-agent-loop-and-react.md) | `labs/foundations/4_3`、`4_4`；核对真实反馈与终止控制 | foundations 环境 + 模型配置 |
| [05 · 上下文与记忆](05-context-and-memory.md) | `labs/foundations/4_2` 及循环脚本中的消息构造 | foundations 环境；按脚本配置模型 |
| [06 · 运行 RayAgent：观察一条完整任务](06-run-rayagent-one-complete-task.md) | [应用指南](../ray_agent/README.md)；共同文件任务 | Compose + 模型配置 |
| [07 · 规划与内外层循环](07-planning-and-nested-loops.md) | [计划流程](../ray_agent/api/app/domain/services/flows/planner_react.py)、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) | 源码；对照第 06 章任务 |
| [08 · 任务执行与控制](08-task-execution-and-control.md) | [应用协调](../ray_agent/api/app/application/services/agent_service.py)、[运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py) | 源码；运行观察使用产品环境 |
| [09 · 状态与持久化](09-state-and-persistence.md) | [领域模型](../ray_agent/api/app/domain/models/)、[存储](../ray_agent/api/app/infrastructure/storage/) | 源码；产品历史与状态观察 |
| [10 · 事件与流式传递](10-events-and-streaming.md) | [领域事件](../ray_agent/api/app/domain/models/event.py)、[接口事件](../ray_agent/api/app/interfaces/schemas/event.py)、[前端事件](../ray_agent/ui/src/lib/session-events.ts)；异步 labs | 产品环境；异步实验使用 foundations 环境 |
| [11 · 沙箱与执行环境](11-sandbox-and-execution-environment.md) | [沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[沙箱指南](../ray_agent/sandbox/README.md) | 产品与沙箱环境 |
| [12 · 文件与任务产物](12-files-and-artifacts.md) | [工具](../ray_agent/api/app/domain/services/tools/)、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/) | 产品环境；复用文件任务 |
| [13 · 浏览器如何成为工具](13-browser-as-a-tool.md) | `labs/foundations/10-6`、`10-4`；[沙箱指南](../ray_agent/sandbox/README.md) | 本机浏览器实验与产品沙箱分别配置 |
| [14 · 通过 MCP 接入外部工具](14-external-tools-with-mcp.md) | MCP labs；[MCP 适配](../ray_agent/api/app/infrastructure/protocols/mcp.py) | 独立客户端／服务端；产品夹具见 API 指南 |
| [15 · 通过 A2A 协作远程 Agent](15-agent-collaboration-with-a2a.md) | `labs/a2a`；[A2A 适配](../ray_agent/api/app/infrastructure/protocols/a2a.py) | 独立 A2A 环境；产品夹具见 API 指南 |
| [16 · 可靠性与验证](16-reliability-and-verification.md) | [API 指南](../ray_agent/api/README.md)、任务运行器、Agent 基类与资源适配层 | 按具体故障场景准备产品环境 |
| [17 · 从会话走向项目工作区](17-from-sessions-to-workspaces.md) | [架构说明](../docs/architecture.md)、[工作区调研](../docs/workspace-harness-research.md) | 先静态核对现状，运行结论另行验证 |

## Chapter 01 evidence

以下供作者核对第一章的机制说明，不作为正文中的阅读要求。验证状态维护在 progress。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 请求成为任务 | [任务协调](../ray_agent/api/app/application/services/agent_service.py)：`_create_task` 准备资源与运行器，`chat` 接收消息并启动执行。 |
| 外层计划推进 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：`invoke` 在创建计划、执行步骤、更新计划与总结之间推进。步骤 `FAILED` 时结束本轮，不进入 `update_plan`。 |
| 内层工具反馈 | [Agent 基础循环](../ray_agent/api/app/domain/services/agents/base.py)：`invoke` 将工具结果带入下一次模型调用。 |
| 文件执行位置 | [文件工具](../ray_agent/api/app/domain/services/tools/file.py)：`read_file`、`write_file` 委托给沙箱接口。 |
| 事件与界面 | [任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)：`_put_and_add_event` 写入输出流与会话；[会话接口](../ray_agent/api/app/interfaces/endpoints/session_routes.py)：`chat` 映射为 SSE。 |

## Chapter 02 evidence

作者以两个 `3_4` 脚本研究请求、完整响应与流式消费。正文按需展示结构和关键调用，不附 RayAgent 源码清单。协议基线是 OpenAI 兼容 Chat Completions；产品客户端是 `OpenAILLM`，与本章脚本同类不同套。Anthropic Messages 与 `tool_calls` 分流不在本章展开。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/3_4_DeepSeek API调用.py` 的 `main` | 消息正文、相同模型配置、HTTP 状态、完整 JSON 与结束原因。 |
| `labs/foundations/3_4_DeepSeek API流式调用.py` 的 `main` | 服务端与客户端两个 stream、正文增量、非正文块、结束标记与部分响应。 |
| `labs/foundations/tests/test_model_interaction.py` | 本地 HTTP 夹具；首段显示后才发送其余响应，验证客户端确实边接收边输出。 |
| [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) | 协议基线：messages、message / delta、finish_reason 与 data: [DONE]。 |
| [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | labs 实际调用的兼容服务说明。 |
| [Requests 响应体处理](https://requests.readthedocs.io/en/latest/user/advanced/#body-content-workflow) | stream=True 延迟读取响应体、逐步消费和关闭响应。 |

运行入口维护在 foundations README；当前验证结果与真实服务缺口维护在 progress。

## Shared product observation

第 06 章建立共同任务：在沙箱工作目录创建 hello.txt，写入 hello，再读取并总结。后续从同一任务观察计划、工具、状态、事件和文件流转。

该任务有阶段 1 的历史验收记录；各章使用的实际观察仍需验证。启动条件见 [应用指南](../ray_agent/README.md)，协议夹具见 [API 指南](../ray_agent/api/README.md#mcpa2a)，不在正文或仓库配置中复制本地凭据。

## Lab inventory

以下记录材料用途与环境条件，不设置读者参与档位。

安装方式见各目录 README。`foundations/` 顶层脚本与 `a2a/` 使用各自的 `pyproject.toml` / `uv.lock`。`demo-code/` 与 `2-2 code/` 是独立环境。

### foundations：模型与工具

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `3_4_DeepSeek API调用.py` | 02 | 读 `DEEPSEEK_API_KEY` |
| `3_4_DeepSeek API流式调用.py` | 02 | 流式输出 |
| `3_5_Kimi多模态API测试.py` | — | 对照／范围外；多模态，非产品主路径，第 02 章正文未使用 |
| `3_6_OpenAI SDK重构代码.py` | — | 对照／范围外；SDK 写法对照，第 02 章正文未使用 |
| `3_6_OpenAI SDK重构多模态LLM调用.py` | — | 对照／范围外；多模态 SDK，第 02 章正文未使用 |
| `3_7_为ReAct Agent添加计算工具.py` | 03 | 工具调用 |
| `3_8_Pydantic解析数据.py` | 03 | 结构化解析 |
| `3_8_Pydantic结合Tool Calls实现数据提取.py` | 03 | schema + tool calls |
| `3_9_DeepSeek JSON Output示例.py` | 03 | JSON 输出 |
| `3_10_使用流式输出提升响应速度.py` | — | 对照／范围外；另一份流式脚本，第 02 章正文只用 `3_4` |
| `3_11_DeepSeek语音播报助手.py` | — | 历史或范围外参考；语音，产品主路径不覆盖 |

### foundations：上下文、ReAct、异步

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `4_2_计算消息上下文长度.py` | 05 | 上下文长度 |
| `4_3_ReAct Agent为LLM添加CoT.py` | 04 | 工具调用示例；是否足以展示持续反馈须核对实际控制流 |
| `4_4_ReAct+CoT实现企业业务表单填写.py` | 04 | 多步表单，仍不是产品 Planner |
| `4_5_同步咖啡店.py` | 10 | 同步对照 |
| `4_5_异步咖啡店.py` | 10 | 异步对照 |
| `4_6_FastAPI-Demo.py` | 10 | 异步 HTTP |
| `4_6_FastAPI-Docs.py` | 10 | 文档示例 |

### foundations：MCP

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `mcp_client_2026.py` | 14 | 辅助模块，非独立实验；固定 MCP `2026-07-28`，供客户端脚本引用 |
| `6_6_mcp-server-demo.py` | 14 | stdio 计算器服务端；`6_7` 客户端会拉起同类服务 |
| `6_7_mcp-client-demo.py` | 14 | 已验证：发现 `calculator`，结果 `42`；无需 Key |
| `6_7_mcp-client-with-exit-stack.py` | 14 | 同上，关注生命周期 |
| `6_7_ReAct-Agent-with-mcp.py` | 14 | 已适配 MCP 2.2，需要模型 Key |
| `6_9_mcp-code.py` | 14 | Streamable HTTP 服务端 |
| `6_9_mcp-client.py` | 14 | 已验证：发现 `run_code`，结果 `42`；需先起服务端 |
| `6_5_无MCP SDK调用高德MCP.py` | 14 | 手写协议对照，需外部凭据 |
| `6_8_mcp-bash.py` | 14 | 依赖本机 Shell |
| `6_10_mcp-external-api.py` | 14 | 外部服务 |
| `6_11_mcp-client-connect-api.py` | 14 | 需 `BAIDU_MCP_TOKEN`，对端须支持目标协议 |

### foundations：浏览器

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `10-6 使用Playwright简化CDP连接.py` | 13 | CDP / Playwright 概念，不是产品沙箱 |
| `10-4 browser-use本地操控实例.py` | 13 | 对照，不代表产品实现 |
| `10-4 browser-use远程操控实例.py` | 13 | 对照，不代表产品实现 |

### foundations：历史综合参考

| 入口 | 挂课 | 备注 |
| --- | --- | --- |
| `demo-code/demo-llm.py`、`demo-agent.py` | — | 历史或范围外参考；独立环境，非阶段 2 协议基线 |
| `2-2 code/weather/` | 15 | 历史或范围外参考；旧综合 / 旧 SDK 参考 |
| `2-2 code/ui/` | 15 | 历史或范围外参考；依赖仓库未包含的上游模块，不能写成可运行示例 |

### a2a

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `main.py` | 15 | 1.0 Agent Card + 路由，监听 `9999` |
| `agent_executor.py` | 15 | 默认确定性回复；可切模型模式 |
| `client.py` | 15 | SDK 客户端；期望 `A2A_LAB_OK:ray-agent-lab` |
| `httpx_a2a.py` | 15 | 手写 JSON-RPC 对照 |

A2A 基线无需模型 Key。`A2A_LAB_MODE=deepseek` 需要模型配置，不属于已验证验收。
