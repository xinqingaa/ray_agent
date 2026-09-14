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

文件任务用于串联正常控制，缺少路径与长操作分别用于观察等待和取消。区分代码事实、确定性夹具和真实产品；本地进程实验不能与 API 替身测试拼接为端到端证据。

| 核对内容 | 实现入口与观察重点 |
|---|---|
| 启动、补充输入与重复提交 | [应用协调](../ray_agent/api/app/application/services/agent_service.py) 的 `chat`、`_create_task`；[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py) 的 `invoke` 与注册表；[输入流](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py) 的 `pop`。核对实例内防重入、消息不去重，以及弹出锁不覆盖会话任务创建。 |
| 输入生效时刻 | [运行器](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke`：事件发布之后检查新输入；不是只在计划步骤结束时检查。 |
| 等待与继续 | [消息工具](../ray_agent/api/app/domain/services/tools/message.py)、[执行器](../ray_agent/api/app/domain/services/agents/react.py) 的 `execute_step`、[Flow](../ray_agent/api/app/domain/services/flows/planner_react.py) 的状态分支、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) 的 `roll_back`。核对新运行器加载历史计划和提问回复；消息结构修整不撤销副作用，询问也不等于动作绑定的审批。 |
| 取消与清理 | `AgentService.stop_session`、`RedisStreamTask.cancel`、运行器的 `_persist_terminal_state`、`_cleanup_tools`、`destroy`。区分接口返回、注册移除、终态写入、协程退出和环境销毁；[会话状态](../ray_agent/api/app/domain/models/session.py) 没有单独的 cancelled。 |
| 控制夹具 | [执行控制测试](../ray_agent/api/tests/core/test_task_execution_control.py)、[取消测试](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py)。固定输入交接时刻，核对新消息切换、等待续接、重复提交、取消时清理未完成、内层迭代边界。运行命令及替身范围归 [API 指南](../ray_agent/api/README.md#测试与数据库迁移)。 |
| 实际 Shell 进程 | [Shell 服务](../ray_agent/sandbox/app/services/shell.py) 的 `exec_command`、`wait_process`、`kill_process`；[本地观察脚本](../ray_agent/sandbox/scripts/check_shell_control.py)。检查调用协程取消后进程和文件是否继续变化，显式终止后核对退出码并回收资源。运行条件归[沙箱指南](../ray_agent/sandbox/README.md#任务控制观察)。 |
| 次数、时间与消耗 | [Agent 配置](../ray_agent/api/app/domain/models/app_config.py)、`BaseAgent.invoke/_invoke_llm/_invoke_tool`、[模型适配](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[用量累计](../ray_agent/api/app/domain/models/token_usage.py)。区分迭代、尝试次数、请求超时、总时限、单次输出限制和记账；不预设统一任务预算。 |
| 通用取消语义 | [Python 3.12 asyncio](https://docs.python.org/3.12/library/asyncio-task.html#task-cancellation)：取消请求、异常传播与清理；不据此推断远端进程已停止。 |

## 第 09 章素材

| 研究问题 | 实现入口与观察重点 |
|---|---|
| 状态归属与提交 | [会话](../ray_agent/api/app/domain/models/session.py)、[计划](../ray_agent/api/app/domain/models/plan.py)、[Memory](../ray_agent/api/app/domain/models/memory.py)、[数据库会话模型](../ray_agent/api/app/infrastructure/models/session.py)、[会话仓库](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py)、[工作单元](../ray_agent/api/app/infrastructure/repositories/db_uow.py)。区分领域对象、序列化表示、仓库更新与事务提交，核对持久化字段及未保存的执行位置。 |
| 动作与记录间隔 | [Agent 基类](../ray_agent/api/app/domain/services/agents/base.py) 的 `invoke/_invoke_llm/_add_to_memory/roll_back`、[任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event/_put_and_add_event`。追踪 calling、实际动作、called、预览同步、输出发布、事件保存及工具结果进入 Memory 的顺序；消息回滚不撤销外部副作用。 |
| 等待后重新组装 | [应用协调](../ray_agent/api/app/application/services/agent_service.py)、[规划执行流](../ray_agent/api/app/domain/services/flows/planner_react.py)、[执行器](../ray_agent/api/app/domain/services/agents/react.py)。核对新任务、新 Flow、按环境 ID 尝试连接原工作位置、角色记忆加载与提问配对；`get_latest_plan` 读取最新 PlanEvent，不自动合并后续 StepEvent。正文配图区分第八章的控制退出与本章读取的记录。 |
| 历史与执行者 | [任务注册](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)、[Redis 队列](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py)、[会话路由](../ray_agent/api/app/interfaces/endpoints/session_routes.py)、[前端详情加载](../ray_agent/ui/src/hooks/use-session-detail.ts)、[页面事件处理](../ray_agent/ui/src/lib/session-events.ts)。输入取出时删除，输出按游标读取；前端合并步骤进度不等于后台恢复计划；进程内注册不随 Redis 消息自动恢复。 |
| 执行位置与存储 | 会话保存环境 ID，只作为引用。容器查找、跨会话文件分离与回收见 [第 11 章素材](#第-11-章素材) 和[沙箱连接说明](../ray_agent/sandbox/README.md#与-api-连接)；附件同步见 [第 12 章素材](#第-12-章素材)。本章只核对该 ID 能否指向仍存在的工作文件。 |
| 定向验证 | [状态夹具](../ray_agent/api/tests/core/test_state_persistence.py)、[控制夹具](../ray_agent/api/tests/core/test_task_execution_control.py)、[API 测试入口](../ray_agent/api/README.md#测试与数据库迁移)。检查交接快照、临时文件、序列化重建与存储失败分支；真实同会话观察及缺口归[制作进度](progress.md#第-09-章状态与持久化)。 |

观察重点：分别追踪动作未发出、动作已生效但结果未保存、结果已保存但页面未收到三个窗口。说明保存的是事件、Memory 还是产物；补充输出先发布、数据库后提交的反向窗口。幂等键、结果查询、检查点与并发所有权属于通用设计条件，不作为现有保证；系统性故障实测由第 16 章承接。

## 第 10 章素材

| 研究问题 | 实现入口与观察重点 |
|---|---|
| 事件生成与投影 | [领域事件](../ray_agent/api/app/domain/models/event.py)、[接口映射](../ray_agent/api/app/interfaces/schemas/event.py)、[任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py)、[会话路由](../ray_agent/api/app/interfaces/endpoints/session_routes.py)。工具原结果与预览分开；计划字段投影、事件时间取整、实时和历史共用映射。 |
| 模型响应与用量 | [模型适配](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)、[用量解析](../ray_agent/api/app/infrastructure/external/llm/usage.py)、[用量累计](../ray_agent/api/app/domain/models/token_usage.py)。完整响应与产品 SSE 分开；重试、缺失字段和重复记录影响记账覆盖。 |
| 前端接收与归并 | [SSE 接收](../ray_agent/ui/src/lib/api/fetch.ts)、[聊天请求](../ray_agent/ui/src/lib/api/session.ts)、[详情 hook](../ray_agent/ui/src/hooks/use-session-detail.ts)、[事件投影](../ray_agent/ui/src/lib/session-events.ts)、[时间格式](../ray_agent/ui/src/lib/utils.ts)。JSON event_id 游标、输入后步骤分组、tool_call_id 阶段合并。正文只保留「解析层也会丢事件」；EOF 无空行与 CRLF 分块限制的复现见 [UI 指南](../ray_agent/ui/README.md#事件观察) 和本地脚本，不算 SSE 规范符合性通过。 |
| 关联与记录范围 | [运行日志](../ray_agent/api/app/infrastructure/logging/logging.py)、[应用配置](../ray_agent/api/app/application/services/app_config_service.py)。会话前缀不是完整 trace；区分当时调用参数与当前配置，检查输入片段、工具结果和 DEBUG 响应的记录范围。 |
| 本地验证 | [事件用例](../ray_agent/api/tests/core/test_event_observability.py)、[既有用量用例](../ray_agent/api/tests/core/test_llm_usage.py)、[UI 观察脚本](../ray_agent/ui/scripts/check-event-observability.cjs)。运行入口归 [API 指南](../ray_agent/api/README.md#测试与数据库迁移)与 [UI 指南](../ray_agent/ui/README.md#事件观察)；限制观测不算标准符合性通过。 |
| 通用概念 | [HTML SSE 标准](https://html.spec.whatwg.org/multipage/server-sent-events.html)、[OpenTelemetry 信号](https://opentelemetry.io/docs/concepts/signals/)。规范用于核对文本事件边界，信号分类用于解释日志、指标与追踪；不据此宣称产品已经集成完整体系。 |

真实关联样例复用第九章同会话任务，运行与本次复核证据归 [制作进度](progress.md#第-10-章事件与可观察性)。按会话关联输入、计划、调用、用量和附件，明确父步骤、模型请求、重试与精确计时字段的缺口。基础实验 `4_5` 同步/异步、`4_6` FastAPI 仅为异步等待的辅助材料，不代替产品事件或追踪验证。

## 第 11 章素材

| 研究问题 | 实现入口与观察重点 |
|---|---|
| 执行位置与请求落地 | [沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[文件服务](../ray_agent/sandbox/app/services/file.py)、[Shell 服务](../ray_agent/sandbox/app/services/shell.py)。文件/Shell 走 HTTP，浏览器走 CDP；Docker Socket 是管理权限，不挂进动态容器。 |
| 会话与环境复用 | [应用协调](../ray_agent/api/app/application/services/agent_service.py) 的 `_create_task`。按 `sandbox_id` 查找运行中容器；任务 ID 可换，环境 ID 不必换。 |
| 路径、身份与网络 | 文件路径无目录白名单；Shell 只设置 `cwd`。Supervisor 以 root 运行；动态容器接入同一 `SANDBOX_NETWORK`，代理变量不是目标白名单。配额、TTL 变量名与已有沙箱销毁差异见制作进度，不占正文主线。 |
| 生命周期 | `create` / `get` / `destroy`、运行器 `finally` 不销毁沙箱。`done` 不等于回收；显式删除与到期回收分开核对。 |
| 本地验证 | [路径与 Shell 观察](../ray_agent/sandbox/scripts/check_environment_boundaries.py)、[容器观察](../ray_agent/api/scripts/check_sandbox_environment.py)。入口归 [沙箱指南](../ray_agent/sandbox/README.md#执行环境观察) 与 [API 指南](../ray_agent/api/README.md#沙箱环境观察)。第八章单进程取消观察仍独立。 |

观察重点：工作目录约定、每会话一个容器、任务结束就删除，都是策略而不是默认事实。同会话复用与不同会话文件分离要分别核对，不能仅凭容器存在就认定租户隔离完备。运行与缺口归 [制作进度](progress.md#第-11-章沙箱与执行环境)。

## 第 12 章素材

| 研究问题 | 实现入口与观察重点 |
|---|---|
| 工具与消息中的文件内容 | [文件工具](../ray_agent/api/app/domain/services/tools/file.py)、[沙箱文件服务](../ray_agent/sandbox/app/services/file.py)、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)。读取结果可含正文，经工具消息加入 Memory；工作文件与消息快照不自动一致。 |
| 两类同步触发 | [任务运行器](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event`：`file` + `called` + `filepath`；`_sync_message_attachments_to_storage`：消息附件路径。Shell 写入不自动走文件分支，截图 URL 放工具事件，不加入当前文件列表。 |
| 替换顺序与身份 | 同文件 `_sync_file_to_storage`；[会话仓库](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py) 的 `get_file_by_path`、`remove_file`、`add_file`。按路径查旧条目，先上传，再在同一事务内按旧 ID 删除并添加；生产关闭 autoflush，删除方法显式 flush，保证随后 SQL 追加使用新值。已有重复条目及并发唯一性不在该修复保证内。 |
| 当前引用与历史引用 | [事件模型](../ray_agent/api/app/domain/models/event.py)、[会话模型](../ray_agent/api/app/infrastructure/models/session.py)、[接口事件](../ray_agent/api/app/interfaces/schemas/event.py)、[前端附件投影](../ray_agent/ui/src/lib/session-events.ts)、[文件预览](../ray_agent/ui/src/components/file-preview-panel.tsx)。`files` 替换不重写 `events` 的附件 ID，预览和下载按所选 ID 取副本。 |
| 输入同步与失败反馈 | 运行器 `_sync_file_to_sandbox`、`_sync_message_attachments_to_sandbox`、`_run_flow` 和 `invoke`。输入落在 `/home/ubuntu/upload/{filename}`；交付全部失败发错误事件，正常收尾记 failed，部分失败未触发全空检查。 |
| 存储与访问 | [文件存储协议](../ray_agent/api/app/domain/external/file_storage.py)、[本地实现](../ray_agent/api/app/infrastructure/external/file_storage/local_file_storage.py)、[文件应用服务](../ray_agent/api/app/application/services/file_service.py)、[文件接口](../ray_agent/api/app/interfaces/endpoints/file_routes.py)、[会话接口](../ray_agent/api/app/interfaces/endpoints/session_routes.py)。ID → 元数据 → key → 字节；没有副本删除流程。 |
| 确定性核对 | [文件产物用例](../ray_agent/api/tests/core/test_file_artifacts.py)、[数据库与存储观察](../ray_agent/api/scripts/check_file_artifacts.py)。命令、连接条件和边界见 [API 指南](../ray_agent/api/README.md#文件与产物观察)。 |

观察重点：用先交付 A、覆盖、再交付 B、重新下载 A 的时间推演，区分工作路径、当前列表、历史附件与存储副本。删除某个列表条目不等于所有引用消失。验证记录与未覆盖条件归[制作进度](progress.md#第-12-章文件与任务产物)。

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

[架构说明](../docs/architecture.md)、[工作区调研](../docs/workspace-harness-research.md)、[Harness 能力评估](../docs/harness-capability-review-2026-09-14.md)。

观察重点：核对跨会话状态、项目指令、环境及产物的衔接；调研方案不是已有能力。用暂停后交接同一项目的情境，明确目录、产物版本、待办、已验证结论和未决条件由谁保存。讨论并发修改归属、版本控制与隔离的必要性，用任务收益评估演进方案，不以增加自动化或多 Agent 数量作为完成标准。
