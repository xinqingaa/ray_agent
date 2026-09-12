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
| [模型适配](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[用量解析](../ray_agent/api/app/infrastructure/external/llm/usage.py) | 对照实际参数、服务端 usage 与缺失用量；调用配置记录不包含密钥，产品累计在第 10 章展开。 |

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
| [文件工具](../ray_agent/api/app/domain/services/tools/file.py)、[工具基类](../ray_agent/api/app/domain/services/tools/base.py) | 核对工具名称、绝对路径说明、覆盖/追加参数与实现是否一致；描述对照是教学方法，不能当作模型效果实测。授权与环境限制分别在第 08、11 章追踪。 |

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
| `ray_agent/api/app/domain/services/flows/planner_react.py` | 正常步骤返回后调用 `compact_memory` 并更新计划；`FAILED` 在清理前中止，不按模型 `success` 字段决定是否清理。 |
| [预设角色提示](../ray_agent/api/app/domain/services/prompts/)、[依赖组装](../ray_agent/api/app/interfaces/service_dependencies.py) | 区分当前预设提示与通用的项目指令、技能按需加载设计；以资料 A 的日期、条件、来源检查压缩前后材料，不预设产品已有技能加载器。 |

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

第 06 章任务用于观察步骤内部多次行动与计划收缩；正文另用两步骤教学示意解释外层继续，不作为新增运行证据。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 外层推进与失败出口 | [规划执行流程](../ray_agent/api/app/domain/services/flows/planner_react.py)：`invoke` 选择步骤、处理 `FAILED`、更新与总结；两个角色使用同一 LLM 对象。 |
| 计划生成与合并 | [Planner](../ray_agent/api/app/domain/services/agents/planner.py)：禁止工具调用；`update_plan` 保留已结束前缀、替换剩余列表，无未结束步骤时不合并。对照[规划提示](../ray_agent/api/app/domain/services/prompts/planner.py)。 |
| 内层收口与步骤结果 | [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) 的 `invoke`；[执行器](../ray_agent/api/app/domain/services/agents/react.py) 的 `execute_step`：原始请求与步骤输入、结构化结果处理、`success` 和状态分离。 |
| 步骤选择 | [计划模型](../ray_agent/api/app/domain/models/plan.py)：`Step.done`、`Plan.get_next_step`；已结束不等于结果成功。 |
| 外部设计比较 | [Codex App Server](https://learn.chatgpt.com/docs/app-server)：计划更新事件、运行中补充输入、取消与审批；接口资料不证明产品全部内部循环结构。[Anthropic 模式说明](https://www.anthropic.com/engineering/building-effective-agents)：按任务比较可组合模式与代价，不按循环数量判断优劣。 |
| 确定性流程验证 | [双循环测试](../ray_agent/api/tests/core/test_planner_react_flow.py)：保留真实 Flow、Planner、ReAct 和工具分发，替换模型、存储与沙箱。观察第二步继续、计划收缩、`success=false`、无待办时不追加、解析失败出口；不证明真实模型规划质量。运行入口见 [API 测试指南](../ray_agent/api/README.md#测试与数据库迁移)。 |

## 第 08 章素材

[应用协调](../ray_agent/api/app/application/services/agent_service.py)、[运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)。

补充入口：[Agent 配置](../ray_agent/api/app/domain/models/app_config.py)、[基础循环](../ray_agent/api/app/domain/services/agents/base.py)、[取消测试](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py)、[Shell 服务](../ray_agent/sandbox/app/services/shell.py)。

观察重点：区分模型不再行动、程序超限、等待输入、取消请求与取消确认；区分次数上限、单次超时、总时限、token 记账与强制预算。沿一次长操作检查后台进程是否结束、终态何时保存、资源何时释放。审批应绑定具体动作与资源，不能把询问用户当成完整授权系统；同会话重复提交的承接与排他范围也需核对。

## 第 09 章素材

[领域模型](../ray_agent/api/app/domain/models/)、[会话仓库](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py)、[工作单元](../ray_agent/api/app/infrastructure/repositories/db_uow.py)、[任务注册](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)。

观察重点：分别追踪动作未发出、动作已生效但结果未保存、结果已保存但页面未收到三个窗口。核对执行位置、文件和进程是否保留，以及重复执行是否改变结果；区分数据库记录、进程内注册和恢复依据。讨论幂等键、结果查询与并发所有权所需条件，不将这些通用策略写成现有保证。

## 第 10 章素材

[领域事件](../ray_agent/api/app/domain/models/event.py)、[接口事件](../ray_agent/api/app/interfaces/schemas/event.py)、[前端事件](../ray_agent/ui/src/lib/session-events.ts)；基础实验 `4_5` 同步/异步、`4_6` FastAPI。

补充入口：[模型适配](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[用量累计](../ray_agent/api/app/domain/models/token_usage.py)、[用量测试](../ray_agent/api/tests/core/test_llm_usage.py)、[任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[应用配置](../ray_agent/api/app/application/services/app_config_service.py)。

观察重点：沿用户请求、计划、模型调用、工具、产物建立关联表，核对实际 ID、耗时、状态与缺失记录。区分实时展示、历史、用量累计和完整追踪；未返回用量不是零消耗。记录模型、参数、提示与工具版本、环境初态，解释观测脱敏和保留范围；异步与 SSE 示例不证明评估或追踪体系。

## 第 11 章素材

[沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[沙箱指南](../ray_agent/sandbox/README.md)。

补充入口：[沙箱文件服务](../ray_agent/sandbox/app/services/file.py)、[Shell 服务](../ray_agent/sandbox/app/services/shell.py)、[服务依赖](../ray_agent/api/app/interfaces/service_dependencies.py)。

观察重点：检查环境生命周期、路径、进程与网络限制实际在哪里执行。用临时目录及本地服务设计越界读写、外部发送与资源清理观察；区分提示约束、审批、技术隔离。同会话复用与不同会话的资源归属需要分别核对，不能仅凭容器存在就认定租户隔离完备。

## 第 12 章素材

[工具](../ray_agent/api/app/domain/services/tools/)、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/)。

补充入口：[文件应用服务](../ray_agent/api/app/application/services/file_service.py)、[文件接口](../ray_agent/api/app/interfaces/endpoints/file_routes.py)、任务运行器中的文件与附件同步。

观察重点：区分工具返回、沙箱文件、界面记录与交付文件，核对内容、文件 ID、来源与同步时机。设计写入后未同步、同步后断连、同路径再次覆盖的场景，检查用户拿到哪个版本，以及访问范围和资源清理如何确定。

## 第 13 章素材

`labs/foundations/10-6`、`10-4`；[沙箱指南](../ray_agent/sandbox/README.md)。

补充入口：[浏览器工具](../ray_agent/api/app/domain/services/tools/browser.py)、[浏览器适配](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py)、[记忆清理](../ray_agent/api/app/domain/models/memory.py)。

观察重点：区分本机浏览器实验与产品沙箱；检查页面、截图与文本何时失效，状态如何反馈。用本地页面嵌入要求读取无关文件的文字，追踪资料与指令的信任边界；结合第 05 章说明清理旧观察后何时需要重新读取，不将提示注入防护默认写成已有能力。

## 第 14 章素材

基础实验 MCP 示例；[MCP 适配](../ray_agent/api/app/infrastructure/protocols/mcp.py)。

观察重点：观察发现、调用、结果与连接生命周期；手写协议示例用于对照 SDK 职责。结合 [API 协议指南](../ray_agent/api/README.md#mcpa2a) 与 [协议边界测试](../ray_agent/api/tests/protocols/test_edges.py)核对版本、认证配置、超时和取消。远端工具说明与结果的可信范围、外部副作用、敏感配置记录需单独解释，不能将认证成功当成每个动作都已获准。

## 第 15 章素材

[A2A 实验](../labs/a2a/README.md)；[A2A 适配](../ray_agent/api/app/infrastructure/protocols/a2a.py)。

观察重点：对照 SDK 与手写客户端，核对远程任务状态如何映射为本地工具结果；沿协议边界测试确认失败、超时、取消传播与资源释放。区分本地调用结束、远程任务结束和远程产物验收；讨论重复提交与结果查询的条件。A2A 接入不等于本地多 Agent 任务认领、并行汇合或共享状态。

## 第 16 章素材

[API 指南](../ray_agent/api/README.md)、任务运行器、Agent 基类与资源适配层。

补充入口：[双循环夹具](../ray_agent/api/tests/core/test_planner_react_flow.py)、[用量测试](../ray_agent/api/tests/core/test_llm_usage.py)、[取消测试](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py)、[协议边界测试](../ray_agent/api/tests/protocols/test_edges.py)、[Agent 评估方法](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)。

观察重点：设计包含文件交付、资料报告、失败纠正、长操作取消、压缩后继续的小型任务集；逐项定义初始环境、允许行动、预期产物、评分规则与失败分类。固定模型和运行配置比较一次改动，保留每次试验结果，观察成功率、耗时和可得用量；校验评分器，允许有效轨迹差异。故障实验承接第 08、09 章的窗口，检查重复副作用；区分程序分支夹具与真实模型评估，现有 API 测试不等于端到端任务验收。

## 第 17 章素材

[架构说明](../docs/architecture.md)、[工作区调研](../docs/workspace-harness-research.md)。

观察重点：核对跨会话状态、项目指令、环境及产物的衔接；调研方案不是已有能力。用暂停后交接同一项目的情境，明确目录、产物版本、待办、已验证结论和未决条件由谁保存。讨论并发修改归属、版本控制与隔离的必要性，用任务收益评估演进方案，不以增加自动化或多 Agent 数量作为完成标准。
