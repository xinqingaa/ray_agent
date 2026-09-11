# 课程素材索引

本文件按章维护素材、实现入口与观察重点，不记录制作状态或验证结果。阅读顺序与核心问题见[课程目录](README.md)，验证证据与待办见[制作进度](progress.md)。源码入口用于追踪调用链，不代替行为核对。

实验环境与运行方式见[基础实验](../labs/foundations/README.md)、[A2A 实验](../labs/a2a/README.md)；完整产品环境见[应用指南](../ray_agent/README.md)。历史综合示例的可用范围以所属实验指南为准。

## 第 01 章素材

研究入口用于核对产品职责；详细控制过程见第 06、07 章。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 请求成为任务 | [任务协调](../ray_agent/api/app/application/services/agent_service.py)：`_create_task` 准备资源与运行器，`chat` 接收消息并启动执行。 |
| 规划与执行的分工 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：仅核对存在 Planner 与执行器的职责分工；两层交接和失败路径见第七章核对入口。 |
| 内层工具反馈 | [Agent 基础循环](../ray_agent/api/app/domain/services/agents/base.py)：`invoke` 将工具结果带入下一次模型调用。 |
| 文件执行位置 | [文件工具](../ray_agent/api/app/domain/services/tools/file.py)：`read_file`、`write_file` 委托给沙箱接口。 |
| 事件与界面 | [任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)：`_put_and_add_event` 写入输出流与会话；[会话接口](../ray_agent/api/app/interfaces/endpoints/session_routes.py)：`chat` 映射为 SSE。 |

## 第 02 章素材

两个 `3_4` 脚本用于同模型同输入对照，协议基线为 OpenAI 兼容 Chat Completions。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/llm_settings.py` | 观察两个实验如何取得相同模型配置；配置方法见基础实验指南。 |
| `labs/foundations/3_4_Chat Completions API调用.py` 的 `main` | 消息正文、相同模型配置、HTTP 状态、完整 JSON 与结束原因。 |
| `labs/foundations/3_4_Chat Completions API流式调用.py` 的 `main` | 服务端与客户端两个 stream、正文增量、非正文块、结束标记与部分响应。 |
| `labs/foundations/tests/test_model_interaction.py` | 本地 HTTP 夹具；首段显示后才发送其余响应，验证客户端确实边接收边输出。 |
| [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) | 协议基线：messages、message / delta、finish_reason 与 data: [DONE]。 |
| [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | labs 实际调用的兼容服务说明。 |
| [Requests 响应体处理](https://requests.readthedocs.io/en/latest/user/advanced/#body-content-workflow) | stream=True 延迟读取响应体、逐步消费和关闭响应。 |

## 第 03 章素材

以 `3_7` 研究工具声明与结果回传，以 `3_8` / `3_9` 对照参数校验与结构化输出。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/3_7_为ReAct Agent添加计算工具.py` 的 `process_query` | 请求带 `tools`；按 `name` 查找实现；`arguments` 先解析再执行；结果以 `role: tool` 带回 `tool_call_id`；第二次调用 `tool_choice="none"`。 |
| `labs/foundations/3_8_Pydantic解析数据.py` | 不调用模型；合法 `arguments` 通过，非法年龄或邮箱失败。 |
| `labs/foundations/3_8_Pydantic结合Tool Calls实现数据提取.py` 的 `main` | 强制 `tool_choice` 抽取 schema；读取 `arguments`，不执行业务函数。 |
| `labs/foundations/3_9_JSON Output示例.py` | `response_format: json_object`，结构在 `content`。 |
| `labs/foundations/tests/test_tool_actions.py` | 本地夹具；无外部模型。 |
| [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) | `tools`、`tool_calls`、`finish_reason: tool_calls`、`role: tool`。 |
| `ray_agent/api/app/domain/services/agents/tool_call_compat.py` 的 `extract_embedded_tool_calls` | 若 `content` 是 Anthropic 风格 `tool_use`，补成 `tool_calls`；已有 `tool_calls` 则不改。 |

## 第 04 章素材

`4_1` 的文件保存在进程内存中；与一次执行后锁死工具、递归再请求的脚本对照。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/4_1_工具反馈循环.py` 的 `process_query` | 无 `tool_calls` 则停；有则执行并再请求，不带 `tool_choice="none"`；超过 `max_iterations` 报错。 |
| `labs/foundations/3_7_为ReAct Agent添加计算工具.py`、`4_3_ReAct Agent为LLM添加CoT.py` | 第二次调用 `tool_choice="none"`；`4_3` 的 CoT 标签与流式拼包不构成循环。 |
| `labs/foundations/4_4_ReAct+CoT实现企业业务表单填写.py` 的 `process_query` | 有 `tool_calls` 时 `self.process_query()` 递归再请求；无迭代上限；不是 Planner。 |
| `labs/foundations/tests/test_agent_loop.py` | 本地夹具；无外部模型。 |
| `ray_agent/api/app/domain/services/agents/base.py` 的 `invoke` | 产品内层：无 `tool_calls` 则 `break`，`max_iterations` 用尽则报错。 |

## 第 05 章素材

示意消息与字符统计用于观察请求工作集，不能证明产品具备长期记忆、语义摘要或检索能力。

| 依据 | 核对重点 |
|---|---|
| `labs/foundations/5_1_观察请求工作集.py` | 三份示意消息快照，检查写入与读取观察何时出现。字符统计采用自定义口径；`request_chars` 没有累加角色包装，不能当作真实 token 数或服务端请求长度。 |
| `labs/foundations/4_1_工具反馈循环.py` 的 `process_query` | 更新后的 `messages` 与 `tools` 交给下一次调用，整表再送，不压缩。 |
| `labs/foundations/4_2_计算消息上下文长度.py` | `encode` 与 `apply_chat_template` 使用不同正文，不能把差值归因于模板；依赖完整本地词表。 |
| `labs/foundations/tests/test_request_context.py` | 本地夹具，验证示意数据与输出；不验证模型行为或残缺消息的协议有效性。 |
| `ray_agent/api/app/domain/services/agents/base.py` | `_ensure_memory` 按会话和 Agent 名加载；`_add_to_memory` 追加保存；`_invoke_llm` 读取消息并另取工具说明。 |
| `ray_agent/api/app/domain/models/memory.py` 的 `compact` | 清理 `browser_view`、`browser_navigate` 结果和 `reasoning_content`，不生成语义摘要，不按 token 预算检索。 |
| `ray_agent/api/app/domain/services/flows/planner_react.py` | 步骤成功后调用执行器 `compact_memory`，随后进入计划更新；清理后的记忆会保存。 |

## 第 06 章素材

共同任务：在沙箱工作目录创建 hello.txt，写入 hello，再读取并总结。逐次核对来源、接收方、传递内容及观察依据；不能预设步骤数和工具调用数。实际任务与文件标识见 progress，源码概括不等于完整出站请求记录。

| 依据 | 核对重点 |
|---|---|
| [应用协调](../ray_agent/api/app/application/services/agent_service.py) 的 `chat`、`_create_task` | 会话关联、沙箱与浏览器资源准备、输入事件、任务启动和输出消费。 |
| [执行器](../ray_agent/api/app/domain/services/agents/react.py) 的 `execute_step` 与 [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) | 原始目标与步骤组装；按角色保存消息；工具声明；工具结果以 `role: tool` 和调用 ID 带入后续请求。 |
| [计划流程](../ray_agent/api/app/domain/services/flows/planner_react.py) | 初始计划、步骤中的工具调用、步骤结果交回后的计划更新与总结。 |
| [任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py) | `_handle_tool_event` 为文件记录自动读取预览并同步；`_sync_message_attachments_to_storage` 按最终附件路径再次同步。预览字段与原始工具结果不同。 |
| [会话事件适配](../ray_agent/api/app/interfaces/schemas/event.py)、[文件接口](../ray_agent/api/app/interfaces/endpoints/file_routes.py) | 页面字段的保留范围；最终文件 ID 与下载接口。 |
| 新任务事件、定向日志、沙箱及存储文件、Web 页面 | 区分模型发起的工具调用与程序的自动读取；核对文件在沙箱、存储与下载响应中的字节、终态及刷新后的历史。 |

## 第 07 章素材

深入追踪外层计划与内层反馈。可改编[嵌套循环图素材](assets/01-nested-loops.svg)，该图尚非现行教材，使用前核对课号、图注和风格。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 外层计划推进与失败分支 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：`invoke` 在创建计划、执行步骤、更新计划与总结之间推进；步骤 `FAILED` 时结束本轮，不进入 `update_plan`。静态事实与实际失败观察分别记录。 |
| 内层反馈与交回结果 | [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)：`invoke` 消费工具结果并继续调用；结合计划流程核对步骤结果如何交回外层。 |
| 步骤、调用与模型角色 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py) 与 Agent 基类：步骤数不等于工具调用数；核对角色的模型配置、计划更新调用与对应成本。 |

## 第 08 章素材

[应用协调](../ray_agent/api/app/application/services/agent_service.py)、[运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)。

观察重点：核对取消、超时、迭代上限、预算与人工介入，区分已有控制与能力差距。

## 第 09 章素材

[领域模型](../ray_agent/api/app/domain/models/)、[存储](../ray_agent/api/app/infrastructure/storage/)。

观察重点：追踪中断后的状态、环境与副作用；历史可查看不能证明可恢复执行。

## 第 10 章素材

[领域事件](../ray_agent/api/app/domain/models/event.py)、[接口事件](../ray_agent/api/app/interfaces/schemas/event.py)、[前端事件](../ray_agent/ui/src/lib/session-events.ts)；基础实验 `4_5` 同步/异步、`4_6` FastAPI。

观察重点：核对实时流与历史的可见范围；异步与 SSE 示例不证明完整追踪体系。

## 第 11 章素材

[沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[沙箱指南](../ray_agent/sandbox/README.md)。

观察重点：检查环境生命周期、路径、进程与网络访问边界。

## 第 12 章素材

[工具](../ray_agent/api/app/domain/services/tools/)、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/)。

观察重点：区分工具返回、沙箱文件、界面记录与交付文件，核对同步链路。

## 第 13 章素材

`labs/foundations/10-6`、`10-4`；[沙箱指南](../ray_agent/sandbox/README.md)。

观察重点：区分本机浏览器实验与产品沙箱，观察页面状态如何反馈给模型。

## 第 14 章素材

基础实验 MCP 示例；[MCP 适配](../ray_agent/api/app/infrastructure/protocols/mcp.py)。

观察重点：观察发现、调用、结果与连接生命周期；手写协议示例用于对照 SDK 职责。

## 第 15 章素材

[A2A 实验](../labs/a2a/README.md)；[A2A 适配](../ray_agent/api/app/infrastructure/protocols/a2a.py)。

观察重点：对照 SDK 与手写客户端，核对远程任务状态如何映射为本地工具结果。

## 第 16 章素材

[API 指南](../ray_agent/api/README.md)、任务运行器、Agent 基类与资源适配层。

观察重点：围绕任务样本、结果检查与失败场景研究验证方法，现有测试不等于任务评估体系。

## 第 17 章素材

[架构说明](../docs/architecture.md)、[工作区调研](../docs/workspace-harness-research.md)。

观察重点：核对跨会话状态、项目指令、环境及产物的衔接；调研方案不是已有能力。
