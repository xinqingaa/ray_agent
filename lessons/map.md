# Learning Map

本文维护课程的素材与实现入口。阅读顺序见 [目录](README.md)，设计边界见 [课程约定](AGENTS.md)，制作及验证状态见 [progress](progress.md)。以下源码是研究入口，不代替对完整调用链的核对。

## Chapter materials

| 章节 | 素材与实现入口 | 环境边界 |
|---|---|---|
| [01 · 认识 Agent Harness：从一句请求到任务完成](01-the-rayagent-system.md) | [架构说明](../docs/architecture.md)；[作者核对入口](#chapter-01-evidence) | 概念阅读，无需启动服务 |
| [02 · 与模型交互](02-model-interaction.md) | `labs/foundations/3_4` 同模型同输入对照；[作者核对入口](#chapter-02-evidence) | foundations 环境 + 模型配置 |
| [03 · 工具与行动](03-tools-and-actions.md) | `labs/foundations/3_7`、`3_8`、`3_9`；[作者核对入口](#chapter-03-evidence) | foundations 环境；按脚本配置模型 |
| [04 · Agent Loop 与 ReAct](04-agent-loop-and-react.md) | `labs/foundations/4_1`、`4_3`、`4_4`；[作者核对入口](#chapter-04-evidence) | foundations 环境；按脚本配置模型 |
| [05 · 上下文与记忆](05-context-and-memory.md) | `labs/foundations/5_1`、`4_1` 的消息构造；`4_2` 对照长度；[作者核对入口](#chapter-05-evidence) | foundations 环境；主观察不需要模型 |
| [06 · 从 Agent Loop 到完整 Harness](06-run-rayagent-one-complete-task.md) | [应用指南](../ray_agent/README.md)；共同文件任务 | Compose + 模型配置 |
| [07 · 规划与内外层循环](07-planning-and-nested-loops.md) | [计划流程](../ray_agent/api/app/domain/services/flows/planner_react.py)、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)；[嵌套循环图素材](assets/01-nested-loops.svg)（待改编素材，非现行教材；制作本章时调整课号、图注及风格） | 源码；对照第 06 章任务 |
| [08 · 任务执行与控制](08-task-execution-and-control.md) | [应用协调](../ray_agent/api/app/application/services/agent_service.py)、[运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py) | 源码；运行观察使用产品环境 |
| [09 · 状态与持久化](09-state-and-persistence.md) | [领域模型](../ray_agent/api/app/domain/models/)、[存储](../ray_agent/api/app/infrastructure/storage/) | 源码；产品历史与状态观察 |
| [10 · 事件与可观察性](10-events-and-streaming.md) | [领域事件](../ray_agent/api/app/domain/models/event.py)、[接口事件](../ray_agent/api/app/interfaces/schemas/event.py)、[前端事件](../ray_agent/ui/src/lib/session-events.ts)；异步 labs | 产品环境；异步实验使用 foundations 环境 |
| [11 · 沙箱与执行环境](11-sandbox-and-execution-environment.md) | [沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[沙箱指南](../ray_agent/sandbox/README.md) | 产品与沙箱环境 |
| [12 · 文件与任务产物](12-files-and-artifacts.md) | [工具](../ray_agent/api/app/domain/services/tools/)、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/) | 产品环境；复用文件任务 |
| [13 · 浏览器如何成为工具](13-browser-as-a-tool.md) | `labs/foundations/10-6`、`10-4`；[沙箱指南](../ray_agent/sandbox/README.md) | 本机浏览器实验与产品沙箱分别配置 |
| [14 · 通过 MCP 接入外部工具](14-external-tools-with-mcp.md) | MCP labs；[MCP 适配](../ray_agent/api/app/infrastructure/protocols/mcp.py) | 独立客户端／服务端；产品夹具见 API 指南 |
| [15 · 通过 A2A 协作远程 Agent](15-agent-collaboration-with-a2a.md) | `labs/a2a`；[A2A 适配](../ray_agent/api/app/infrastructure/protocols/a2a.py) | 独立 A2A 环境；产品夹具见 API 指南 |
| [16 · 可靠性、验证与评估](16-reliability-and-verification.md) | [API 指南](../ray_agent/api/README.md)、任务运行器、Agent 基类与资源适配层 | 按具体故障场景准备产品环境 |
| [17 · 长任务与项目工作区](17-from-sessions-to-workspaces.md) | [架构说明](../docs/architecture.md)、[工作区调研](../docs/workspace-harness-research.md) | 先静态核对现状，运行结论另行验证 |

## Chapter 01 evidence

以下核对第一章项目介绍、职责解释与设计选择所需的实现事实；正文通过自然语言、任务例子和图解说明联系，具体调用链留给后续章节。这些入口供作者核对，不作为读者的阅读要求。验证状态维护在 progress。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 请求成为任务 | [任务协调](../ray_agent/api/app/application/services/agent_service.py)：`_create_task` 准备资源与运行器，`chat` 接收消息并启动执行。 |
| 规划与执行的分工 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：仅核对存在 Planner 与执行器的职责分工；两层交接和失败路径见第七章核对入口。 |
| 内层工具反馈 | [Agent 基础循环](../ray_agent/api/app/domain/services/agents/base.py)：`invoke` 将工具结果带入下一次模型调用。 |
| 文件执行位置 | [文件工具](../ray_agent/api/app/domain/services/tools/file.py)：`read_file`、`write_file` 委托给沙箱接口。 |
| 事件与界面 | [任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)：`_put_and_add_event` 写入输出流与会话；[会话接口](../ray_agent/api/app/interfaces/endpoints/session_routes.py)：`chat` 映射为 SSE。 |

## Chapter 02 evidence

作者以两个 `3_4` 脚本研究请求、完整响应与流式消费。正文按需展示结构和关键调用，不附 RayAgent 源码清单。协议基线是 OpenAI 兼容 Chat Completions；产品客户端是 `OpenAILLM`，与本章脚本同类不同套。配置使用 `LLM_*`，可与 `ray_agent/.env` 同一组。Anthropic Messages 与 `tool_calls` 分流不在本章展开。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/llm_settings.py` | `LLM_API_KEY`、`LLM_MODEL_NAME`、`LLM_BASE_URL`；本目录 `.env` 优先，缺项回读产品 `.env`。 |
| `labs/foundations/3_4_Chat Completions API调用.py` 的 `main` | 消息正文、相同模型配置、HTTP 状态、完整 JSON 与结束原因。 |
| `labs/foundations/3_4_Chat Completions API流式调用.py` 的 `main` | 服务端与客户端两个 stream、正文增量、非正文块、结束标记与部分响应。 |
| `labs/foundations/tests/test_model_interaction.py` | 本地 HTTP 夹具；首段显示后才发送其余响应，验证客户端确实边接收边输出。 |
| [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) | 协议基线：messages、message / delta、finish_reason 与 data: [DONE]。 |
| [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | labs 实际调用的兼容服务说明。 |
| [Requests 响应体处理](https://requests.readthedocs.io/en/latest/user/advanced/#body-content-workflow) | stream=True 延迟读取响应体、逐步消费和关闭响应。 |

运行入口维护在 foundations README；当前验证结果与真实服务缺口维护在 progress。

## Chapter 03 evidence

作者以 `3_7` 研究声明、`tool_calls` 执行与 `role: tool` 回传，以 `3_8` / `3_9` 对照结构化输出。正文按需展示结构和关键调用，不附 RayAgent 源码清单。协议基线仍是 OpenAI 兼容 Chat Completions；`3_7` 的类名含 ReAct，控制流是一次执行后 `tool_choice="none"`，不是第 04 章的反馈循环。配置使用 `LLM_*`。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/3_7_为ReAct Agent添加计算工具.py` 的 `process_query` | 请求带 `tools`；按 `name` 查找实现；`arguments` 先解析再执行；结果以 `role: tool` 带回 `tool_call_id`；第二次调用 `tool_choice="none"`。 |
| `labs/foundations/3_8_Pydantic解析数据.py` | 不调用模型；合法 `arguments` 通过，非法年龄或邮箱失败。 |
| `labs/foundations/3_8_Pydantic结合Tool Calls实现数据提取.py` 的 `main` | 强制 `tool_choice` 抽取 schema；读取 `arguments`，不执行业务函数。 |
| `labs/foundations/3_9_JSON Output示例.py` | `response_format: json_object`，结构在 `content`。 |
| `labs/foundations/tests/test_tool_actions.py` | 本地夹具；无外部模型。 |
| [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) | `tools`、`tool_calls`、`finish_reason: tool_calls`、`role: tool`。 |
| `ray_agent/api/app/domain/services/agents/tool_call_compat.py` 的 `extract_embedded_tool_calls` | 若 `content` 是 Anthropic 风格 `tool_use`，补成 `tool_calls`；已有 `tool_calls` 则不改。正文不展开 Messages API。 |

运行入口维护在 foundations README；当前验证结果与真实服务缺口维护在 progress。

## Chapter 04 evidence

作者先讲与技术栈无关的最小 Agent Loop：正常路径处理允许执行的行动、回传观察并再次决策，终端消息是正常收口条件；取消、超限和等待可改变这条路径。再落到 Chat Completions 的 `tool_calls` / `role: tool`，以 `4_1` 核对继续与停止，以一次执行后锁死工具的脚本和递归再请求的脚本对照。`4_1` 的文件在进程内存中；产品内层另有迭代上限与事件，外层计划在第 07 章。配置使用 `LLM_*`。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/4_1_工具反馈循环.py` 的 `process_query` | 无 `tool_calls` 则停；有则执行并再请求，不带 `tool_choice="none"`；超过 `max_iterations` 报错。 |
| `labs/foundations/3_7_为ReAct Agent添加计算工具.py`、`4_3_ReAct Agent为LLM添加CoT.py` | 第二次调用 `tool_choice="none"`；`4_3` 的 CoT 标签与流式拼包不构成循环。 |
| `labs/foundations/4_4_ReAct+CoT实现企业业务表单填写.py` 的 `process_query` | 有 `tool_calls` 时 `self.process_query()` 递归再请求；无迭代上限；不是 Planner。 |
| `labs/foundations/tests/test_agent_loop.py` | 本地夹具；无外部模型。 |
| `ray_agent/api/app/domain/services/agents/base.py` 的 `invoke` | 产品内层：无 `tool_calls` 则 `break`，`max_iterations` 用尽则报错。正文不展开外层计划。 |

运行入口维护在 foundations README；当前验证结果与真实服务缺口维护在 progress。

## Chapter 05 evidence

本章先讲通用的上下文组成、任务内与跨任务记忆、写入与检索、容量约束和信息取舍，再以实验与产品作对照。资料报告场景及三张图是教学示意，不能作为产品已实现长期记忆、摘要或检索的证据。主观察不需要 `LLM_*`。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/5_1_观察请求工作集.py` | 三份示意消息快照，检查写入与读取观察何时出现。字符统计采用自定义口径；`request_chars` 没有累加角色包装，不能当作真实 token 数或服务端请求长度。 |
| `labs/foundations/4_1_工具反馈循环.py` 的 `process_query` | 更新后的 `messages` 与 `tools` 交给下一次调用，整表再送，不压缩。 |
| `labs/foundations/4_2_计算消息上下文长度.py` | `encode` 与 `apply_chat_template` 使用不同正文，不能把差值归因于模板；依赖完整本地词表。 |
| `labs/foundations/tests/test_request_context.py` | 本地夹具，验证示意数据与输出；不验证模型行为或残缺消息的协议有效性。 |
| `ray_agent/api/app/domain/services/agents/base.py` | `_ensure_memory` 按会话和 Agent 名加载；`_add_to_memory` 追加保存；`_invoke_llm` 读取消息并另取工具说明。 |
| `ray_agent/api/app/domain/models/memory.py` 的 `compact` | 清理 `browser_view`、`browser_navigate` 结果和 `reasoning_content`，不生成语义摘要，不按 token 预算检索。 |
| `ray_agent/api/app/domain/services/flows/planner_react.py` | 步骤成功后调用执行器 `compact_memory`，随后进入计划更新；清理后的记忆会保存。 |

通用概念的外部依据就地链接在正文中，包括 Anthropic 上下文工程与窗口说明、LangGraph 记忆概览，以及《Lost in the Middle》的特定实验结论。运行入口维护在 foundations README；验证结果与真实服务缺口维护在 progress。

## Chapter 07 evidence

本节承接原第一章的两层循环素材，供第七章深入讲解；第六章只辨认一次真实任务中的角色交接。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 外层计划推进与失败分支 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：`invoke` 在创建计划、执行步骤、更新计划与总结之间推进；步骤 `FAILED` 时结束本轮，不进入 `update_plan`。静态事实与实际失败观察分别记录。 |
| 内层反馈与交回结果 | [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)：`invoke` 消费工具结果并继续调用；结合计划流程核对步骤结果如何交回外层。 |
| 步骤、调用与模型角色 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py) 与 Agent 基类：步骤数不等于工具调用数；核对角色的模型配置、计划更新调用与对应成本。 |

## Shared product observation

第 06 章以文件任务观察完整 Harness：在沙箱工作目录创建 hello.txt，写入 hello，再读取并总结。按下表核对交接，不再绘制职责总图。后续在适用时复用，长任务、恢复和评估可补充独立场景。

| 交接 | 研究入口 | 需要取得的观察 |
|---|---|---|
| 消息进入任务 | [应用协调](../ray_agent/api/app/application/services/agent_service.py)、[运行器](../ray_agent/api/app/domain/services/agent_task_runner.py) | 谁接收消息、准备任务并启动执行；记录对应任务。 |
| 信息进入模型 | [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) | 本次消息与工具说明由谁准备；区分实际请求证据与根据源码推断的输入。 |
| 工具结果进入后续决策 | [文件工具](../ray_agent/api/app/domain/services/tools/file.py)、Agent 基类与计划流程 | 实际写入、读取调用及对应结果；结果交回谁，谁发起后续调用，不预设步骤或调用次数。 |
| 文件成为可访问产物 | 运行器、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/) 与会话事件 | 区分工具返回、界面记录、沙箱文件和交付文件；核对路径、内容及关联关系。 |

该任务有阶段 1 的历史验收记录；各章使用的实际观察仍需验证。启动条件见 [应用指南](../ray_agent/README.md)，协议夹具见 [API 指南](../ray_agent/api/README.md#mcpa2a)，不在正文或仓库配置中复制本地凭据。

## 后续主题的材料边界

| 主题 | 已有研究入口 | 制作时需补充的证据 |
|---|---|---|
| 执行控制 | 任务协调、运行器、Agent 基类与任务适配 | 承接第三、四章的授权与暂停边界，分别核对取消、超时、迭代上限、预算和人工介入；没有对应实现时标为通用策略或能力差距。 |
| 状态与恢复 | 领域模型、存储与会话历史 | 承接第一章的历史与恢复区别，追踪中断后的状态、环境和副作用；不能以历史可查看证明可恢复执行。 |
| 事件可观察性 | 领域事件、接口事件与前端消费 | 核对现有事件能看见什么、看不见什么；SSE 与异步 labs 不证明完整追踪体系。 |
| 环境访问边界 | 沙箱适配与当前配置 | 承接第三章的操作范围问题，检查路径、进程和网络的实际限制；审批流程归第八章。 |
| 验证与评估 | API 测试入口、运行器和失败路径 | 承接第一、四章的结果依据，用任务样本和失败场景设计检查与重复运行方法；现有测试不等于已经建立任务评估体系。 |
| 长任务与工作区 | 当前架构与工作区调研 | 核对跨会话状态、项目指令、环境及产物如何衔接；调研中的演进方案不是已有能力。 |

具体制作状态与待验证项目维护在 progress；本表只说明证据范围，不另设进度。

## Lab inventory

以下记录材料用途与环境条件，不设置读者参与档位。

安装方式见各目录 README。`foundations/` 顶层脚本与 `a2a/` 使用各自的 `pyproject.toml` / `uv.lock`。`demo-code/` 与 `2-2 code/` 是独立环境。

### foundations：模型与工具

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `3_4_Chat Completions API调用.py` | 02 | 读 `LLM_*` |
| `3_4_Chat Completions API流式调用.py` | 02 | 流式输出；读 `LLM_*` |
| `3_5_Kimi多模态API测试.py` | — | 对照／范围外；多模态，非产品主路径，第 02 章正文未使用 |
| `3_6_OpenAI SDK重构代码.py` | — | 对照／范围外；SDK 写法对照，第 02 章正文未使用 |
| `3_6_OpenAI SDK重构多模态LLM调用.py` | — | 对照／范围外；多模态 SDK，第 02 章正文未使用 |
| `3_7_为ReAct Agent添加计算工具.py` | 03 | 一次工具执行；类名含 ReAct，不是持续反馈循环 |
| `3_8_Pydantic解析数据.py` | 03 | 无模型；校验 `arguments` 字符串 |
| `3_8_Pydantic结合Tool Calls实现数据提取.py` | 03 | 强制 tool_choice 抽取，不执行业务函数 |
| `3_9_JSON Output示例.py` | 03 | JSON 在 `content`，不是 tool_calls |
| `3_10_使用流式输出提升响应速度.py` | — | 对照／范围外；另一份流式脚本，第 02 章正文只用 `3_4` |
| `3_11_语音播报助手.py` | — | 历史或范围外参考；语音，产品主路径不覆盖 |

### foundations：上下文、ReAct、异步

| 脚本 | 挂课 | 备注 |
| --- | --- | --- |
| `4_1_工具反馈循环.py` | 04 | 最小循环；内存写/读；带 `max_iterations` |
| `5_1_观察请求工作集.py` | 05 | 三拍请求清单；无外部模型 |
| `4_2_计算消息上下文长度.py` | 05 | 对照长度；需完整词表，当前 unverified |
| `4_3_ReAct Agent为LLM添加CoT.py` | 04 | 与 `3_7` 同类：一次执行后 `tool_choice="none"` |
| `4_4_ReAct+CoT实现企业业务表单填写.py` | 04 | 递归再请求；无上限；不是产品 Planner |
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
