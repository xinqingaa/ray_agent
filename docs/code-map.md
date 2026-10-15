# 代码地图

本文按机制索引 API、UI 与沙箱的实现及定向检查。首次接手从主执行路径开始，具体改动按主题追查；服务内部目录职责见所属 README 的代码导航。

## 怎么读

| 服务 | 实现根目录 | 检查根目录 |
|---|---|---|
| API | [api/app](../ray_agent/api/app) | [api/tests](../ray_agent/api/tests) |
| UI | [ui/src](../ray_agent/ui/src) | [ui/scripts](../ray_agent/ui/scripts) |
| 沙箱 | [sandbox/app](../ray_agent/sandbox/app) | [sandbox/tests](../ray_agent/sandbox/tests) |

各主题列出实现入口与定向检查；[主执行路径](#主执行路径)用于首次定位，专题索引用于按影响继续追查。源码是当前行为的最终依据，测试帮助理解约定与覆盖范围；测试存在不表示当前版本已通过运行验证。

## 主执行路径

| 路径环节 | 主入口 | 继续核对 |
|---|---|---|
| 接收会话请求 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `chat()` | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()` 受理消息与运行，`_create_task()` 组装执行资源 |
| 组织一次执行 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()` | `_prepare_run()` 准备快照，`_process()` 进入循环，`_finish()` 保存等待或终态；项目保护经应用协调器处理 |
| 请求模型与决定下一动作 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `invoke()`、`_loop()` | 模型请求、容量、计划及成果反馈分别查下方主题；模型参数与通信编码在基础设施适配 |
| 执行工具 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `run()` | 执行前处理模式与策略，工具声明连接具体适配，结果按调用 ID 回填 |
| 保存事实与展示 | [run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) | 运行器提交事件，前端 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 派生视图；数据库提交和外部副作用分别判断 |

## Agent 循环与工具管线

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 单循环：补充消息、模型请求、多调用执行、有限结束反馈与答复 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `AgentLoop.invoke()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 模型重试、输出截断与请求上限 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_request_model()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py) |
| 请求预算的提醒与收尾 | [run_budget.py](../ray_agent/api/app/domain/services/run_budget.py)：`budget_phase()`、`FinalizeGuard`；循环 `_advance_budget()`；审批计数在 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_budget_used_before_approval()` | [test_run_budget.py](../ray_agent/api/tests/core/test_run_budget.py) |
| 工具三段管线：解析校验、执行一次、耗时 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `ToolPipeline.run()`、`add_before()`、`add_after()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 工具策略授权：规则匹配、deny 短路、ask 挂起 | [tool_policy.py](../ray_agent/api/app/domain/services/tool_policy.py)：`resolve_policy()`、`ToolPolicyGuard`；规则 [app_config.py](../ray_agent/api/app/domain/models/app_config.py)，别名 [mcp.py](../ray_agent/api/app/infrastructure/protocols/mcp.py) | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py) |
| Plan 模式执行前检查 | [plan_mode.py](../ray_agent/api/app/domain/services/plan_mode.py) 的 `PlanModeGuard`（注册在 `ToolPolicyGuard` 之前）；后缀 [plan_mode.py](../ray_agent/api/app/domain/services/prompts/plan_mode.py) | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 审批续接 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `resume_approval()`；运行器入口为 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_process_approval()` | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 悬空调用补结果与续接 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `repair_dangling_calls()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 计划清单工具 | [plan.py](../ray_agent/api/app/domain/services/tools/plan.py) 的 `PlanTool`，数据结构见 [plan.py](../ray_agent/api/app/domain/models/plan.py) | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_state_persistence.py](../ray_agent/api/tests/core/test_state_persistence.py)、[test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py) |
| 稳定阶段、范围与成果核验 | [plan.py 模型](../ray_agent/api/app/domain/models/plan.py)、[plan.py 工具](../ray_agent/api/app/domain/services/tools/plan.py)、[task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py)；循环 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) | [test_staged_plan.py](../ray_agent/api/tests/core/test_staged_plan.py)、[check-plan-progress.cjs](../ray_agent/ui/scripts/check-plan-progress.cjs)；[成果机制](harness.md#核验与成果交付) |
| 计划事务承接 | [plan_acceptance.py](../ray_agent/api/app/domain/models/plan_acceptance.py)、[run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 的 `start()` 与 [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()` | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) 的计划承接并发用例 |
| 构建身份 | [build_identity.py](../ray_agent/api/build_identity.py)、[build-identity.cjs](../ray_agent/ui/scripts/build-identity.cjs)、[check-builds.py](../ray_agent/scripts/check-builds.py) | [test_build_identity.py](../ray_agent/api/tests/core/test_build_identity.py) |
| 计划核对与稳定身份展示 | [plan_progress.py](../ray_agent/api/app/domain/services/plan_progress.py) 的 `PlanProgress`；前端 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 与 [plan-bar.tsx](../ray_agent/ui/src/components/run/plan-bar.tsx) | [test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py)、[check-plan-progress.cjs](../ray_agent/ui/scripts/check-plan-progress.cjs) |
| 提示词与任务语义规划 | [system.py](../ray_agent/api/app/domain/services/prompts/system.py)、[计划模式](../ray_agent/api/app/domain/services/prompts/plan_mode.py)及 [英文提示](../ray_agent/api/app/domain/services/prompts/en/)；[工具说明](../ray_agent/api/app/domain/services/tools/plan.py)与 [plan_progress.py](../ray_agent/api/app/domain/services/plan_progress.py) | [test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)；[规划语义设计](plan/long-task-trust-and-delivery.md#规划语义时机与清单粒度) |
| 脚本化模型与循环测试夹具 | [scripted_llm.py](../ray_agent/api/tests/support/scripted_llm.py)、[loop_harness.py](../ray_agent/api/tests/support/loop_harness.py)（相对 `ray_agent/api/`） | [test_scripted_llm.py](../ray_agent/api/tests/core/test_scripted_llm.py) |

## 上下文与记忆

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 消息序列组装、按轮切分与整体替换 | [memory.py](../ray_agent/api/app/domain/models/memory.py) 的 `rounds()`、`replace()`；按模型回传规则删除推理字段为 `strip_reasoning()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 请求前容量估算：四部分构成、usage 校准、可用上限与水位 | [budget.py](../ray_agent/api/app/domain/services/context/budget.py) 的 `ContextBudget`、`ContextEstimate`；由 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_ensure_capacity()` 在每轮 `turn(started)` 前调用 | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 自动压缩：范围选择、用户原文重新注入、摘要请求 | [compaction.py](../ray_agent/api/app/domain/services/context/compaction.py) 与 [compactor.py](../ray_agent/api/app/domain/services/context/compactor.py) 的 `Compactor`；循环内调用在 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)；提示词 [compact.py](../ray_agent/api/app/domain/services/prompts/compact.py)（英文版在 `prompts/en/`） | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 请求装配与固定输入检查 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_request_messages()`；[budget.py](../ray_agent/api/app/domain/services/context/budget.py) 的 `fixed_input_estimate()` | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 长期笔记写入与冻结背景 | [project.py 提示](../ray_agent/api/app/domain/services/prompts/project.py)、[project_notes.py](../ray_agent/api/app/domain/services/tools/project_notes.py)；冻结入口 [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)，版本协调 [project_memory_service.py](../ray_agent/api/app/application/services/project_memory_service.py) | [test_project_memory_pg.py](../ray_agent/api/tests/core/test_project_memory_pg.py) |
| 对话摘要材料与近期选择 | [summary_material.py](../ray_agent/api/app/domain/services/summary_material.py)、[db_session_repository.py](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py) 的 `summary_material()`、`recent_summaries()` | [test_project_memory_pg.py](../ray_agent/api/tests/core/test_project_memory_pg.py) |
| 手动压缩接口 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `compact_session()`；路由 [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `POST /sessions/{id}/compact` | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)、[test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 工具结果整形与落盘 | [shaping.py](../ray_agent/api/app/domain/services/context/shaping.py) 的 `ResultShaper`（工具管线执行后段最后一个处理函数），写文件经 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_write_output()`；协议截断前的完整内容见 [common.py](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `keep_full_content()` | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_result_shaping.py](../ray_agent/api/tests/protocols/test_result_shaping.py) |
| 沙箱 Shell 输出上限 | [shell.py](../ray_agent/sandbox/app/services/shell.py)（沙箱）的 `append_output()` | — |
| Shell 初次返回与进程组终止 | [shell.py](../ray_agent/sandbox/app/services/shell.py)（沙箱）的 `exec_command()`、`_terminate_process_group()`；API 侧等待上限在 [docker_sandbox.py](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 的 `bound_shell_wait_seconds()` | [test_shell_service.py](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱） |
| 模型调用、流式组装、`finish_reason`、可重试错误与上下文超长拒绝 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)（协议选择、语义流完整终态、空闲超时）；[Responses 转换](../ray_agent/api/app/infrastructure/external/llm/responses.py) 处理输入、推理回传与错误分类、[llm.py](../ray_agent/api/app/domain/external/llm.py) 的 `LLMRequestError` 与 `on_delta` | [test_responses_api.py](../ray_agent/api/tests/core/test_responses_api.py)、[test_openai_stream.py](../ray_agent/api/tests/core/test_openai_stream.py)、[test_llm_api_key.py](../ray_agent/api/tests/core/test_llm_api_key.py)、[test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 内嵌工具调用的兼容解析 | [tool_call_compat.py](../ray_agent/api/app/domain/services/agents/tool_call_compat.py) | [test_tool_call_compat.py](../ray_agent/api/tests/core/test_tool_call_compat.py) |
| token 用量记账 | [llm.py](../ray_agent/api/app/domain/models/llm.py)、[usage.py](../ray_agent/api/app/infrastructure/external/llm/usage.py) | [test_llm_usage.py](../ray_agent/api/tests/core/test_llm_usage.py) |

## 工具与动作

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 工具声明、反射收集与方法分发 | [base.py](../ray_agent/api/app/domain/services/tools/base.py) 的 `tool()`、`BaseTool.get_tools()`、`has_tool()`、`invoke()` 与 `_filter_parameters()` | — |
| 工具集装配与模型声明汇总 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `build_default_tools()` 与 `AgentLoop` 构造；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 加入项目笔记；[tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `schemas()`、`find_toolkit()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 参数解析、顶层校验与执行短路 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `parse_arguments()`、`validate_arguments()`；内置参数过滤在 [base.py](../ray_agent/api/app/domain/services/tools/base.py)，核验参数检查在 [task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py) | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_staged_plan.py](../ray_agent/api/tests/core/test_staged_plan.py) |
| 模式、策略与读取并发的独立判断 | [plan_mode.py](../ray_agent/api/app/domain/services/plan_mode.py) 的 `PLAN_MODE_ALLOWED`、[tool_policy.py](../ray_agent/api/app/domain/services/tool_policy.py) 的 `resolve_policy()`；[agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_independent_reads()`，执行段并发在 [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `read_batch()` | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)、[test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_visual_resources.py](../ray_agent/api/tests/core/test_visual_resources.py) |
| 文件、Shell、浏览器、检索工具 | [tools](../ray_agent/api/app/domain/services/tools) 的 `file.py`、`shell.py`、`browser.py`、`search.py`、`web.py`。Shell 等待秒数经沙箱适配截断到 HTTP 超时以内 | [test_shell_service.py](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱，覆盖执行返回与进程组） |
| 用户提问工具 | [message.py](../ray_agent/api/app/domain/services/tools/message.py)（调用由 `AgentLoop` 拦截为等待） | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 工具结果结构 | [tool_result.py](../ray_agent/api/app/domain/models/tool_result.py) | — |

## 事件、观测与投影

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 领域事件模型 | [event.py](../ray_agent/api/app/domain/models/event.py) | [test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py)、[test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py) |
| 写入顺序：先数据库事务、后通知 | [run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 请求重建 | [request_rebuild.py](../ray_agent/api/app/domain/services/request_rebuild.py) | [test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py) |
| 工具事件加工与预览填充 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event()` | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py) |
| SSE 投影与字段省略 | [event.py](../ray_agent/api/app/interfaces/schemas/event.py) | [test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py) |
| 文本增量、首字延迟与失败尝试 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) 组装；[agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 回调与尝试；[run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 发布；[session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 映射 | [test_streaming_loop.py](../ray_agent/api/tests/core/test_streaming_loop.py)、[test_openai_stream.py](../ray_agent/api/tests/core/test_openai_stream.py) |
| SSE、会话详情与请求读取 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py)、[test_streaming_loop.py](../ray_agent/api/tests/core/test_streaming_loop.py) |

## 状态与持久化

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 会话状态与计划快照 | [session.py](../ray_agent/api/app/domain/models/session.py)；计划读取为 [event.py](../ray_agent/api/app/domain/models/event.py) 的 `latest_plan()` | [test_state_persistence.py](../ray_agent/api/tests/core/test_state_persistence.py) |
| 运行与事件仓库 | [run_repository.py](../ray_agent/api/app/domain/repositories/run_repository.py)、[event_repository.py](../ray_agent/api/app/domain/repositories/event_repository.py)；实现为 [db_run_repository.py](../ray_agent/api/app/infrastructure/repositories/db_run_repository.py)、[db_event_repository.py](../ray_agent/api/app/infrastructure/repositories/db_event_repository.py) | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 仓库接口与工作单元 | [uow.py](../ray_agent/api/app/domain/repositories/uow.py)、[db_uow.py](../ray_agent/api/app/infrastructure/repositories/db_uow.py) | [test_db_uow.py](../ray_agent/api/tests/core/test_db_uow.py) |
| 输入流与事件通知 | 输入流 [redis_stream_message_queue.py](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py)；事件通知 [redis_event_notifier.py](../ray_agent/api/app/infrastructure/external/message_queue/redis_event_notifier.py)；列表与项目目录通知 [catalog_notifier.py](../ray_agent/api/app/infrastructure/external/message_queue/catalog_notifier.py) | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py)（事件通知用内存替身）、[test_catalog_refresh.py](../ray_agent/api/tests/core/test_catalog_refresh.py) |

## 任务控制与生命周期

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 消息受理、事件流与停止 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()`、`stream_events()`、`stop_session()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py)、[test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 运行器主循环与终态写入 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()`、`_finish()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py)、[test_task_error.py](../ray_agent/api/tests/core/test_task_error.py) |
| 停止后的进程收尾 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `stop_processes()` | [test_agent_task_runner_cancel.py](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) |
| 启动扫描 | [run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 的 `interrupt_running()`，由 [main.py](../ray_agent/api/app/main.py) 在开始接收请求前调用 | [test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py)、[test_agent_task_runner_cancel.py](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) |
| 进程内任务注册表与会话锁 | [redis_stream_task.py](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)、[session_locks.py](../ray_agent/api/app/domain/services/session_locks.py) | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 等待用户与续接 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `WaitEvent` 分支 | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 审批答复、失效与重启处理 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py)、[agent_service.py](../ray_agent/api/app/application/services/agent_service.py)：`reply_approval()`；失效与补齐 [approvals.py](../ray_agent/api/app/domain/services/approvals.py)，启动入口 [main.py](../ray_agent/api/app/main.py) | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 运行中补充消息 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_drain_injected_messages()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 预算与超时配置 | [app_config.py](../ray_agent/api/app/domain/models/app_config.py)、[config.py](../ray_agent/api/core/config.py) | — |

## 执行环境

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 沙箱创建、连接与销毁 | [docker_sandbox.py](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)；项目卷解析 [managed_storage.py](../ray_agent/api/app/infrastructure/external/project/managed_storage.py)；限额 [config.py](../ray_agent/api/core/config.py) | [test_docker_sandbox_ip.py](../ray_agent/api/tests/core/test_docker_sandbox_ip.py)、[test_docker_sandbox_project.py](../ray_agent/api/tests/core/test_docker_sandbox_project.py) |
| 项目路径校验与只读浏览 | [project_paths.py](../ray_agent/api/app/domain/services/project_paths.py)；文件 [local_project_files.py](../ray_agent/api/app/infrastructure/external/project/local_project_files.py) | [test_project_paths.py](../ray_agent/api/tests/core/test_project_paths.py)、[test_project_files.py](../ray_agent/api/tests/core/test_project_files.py) |
| 会话项目绑定与接口 | [project_service.py](../ray_agent/api/app/application/services/project_service.py)；路由 [project_routes.py](../ray_agent/api/app/interfaces/endpoints/project_routes.py) 与会话内 `project/*` 在 [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) | [test_w10_project_session.py](../ray_agent/api/tests/core/test_w10_project_session.py) |
| 浏览器真实视口与恢复 | [playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) 的 `set_viewport()` / `restore_viewports()`；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的运行快照与收尾 | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) 的真实视口与 CDP 续接检查 |
| 浏览器连接（CDP） | [playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) | — |
| 浏览器正文、元素引用、输入与日志 | [playwright_browser_fun.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser_fun.py) 的 `OBSERVE_PAGE`；[playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) 的 `view_page()`、`_target()`、`input()`、`console_view()`；工具声明在 [browser.py](../ray_agent/api/app/domain/services/tools/browser.py) | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) |
| 公开网页读取 | [web.py](../ray_agent/api/app/domain/services/tools/web.py)、[web_content.py](../ray_agent/api/app/infrastructure/external/browser/web_content.py)；沙箱 [web.py](../ray_agent/sandbox/app/services/web.py) 与 [web.py](../ray_agent/sandbox/app/interfaces/endpoints/web.py) | [test_web_fetch.py](../ray_agent/sandbox/tests/test_web_fetch.py) |
| 按需资源、图像引用与临时图回收 | [lazy_resources.py](../ray_agent/api/app/application/services/lazy_resources.py)、[vision.py](../ray_agent/api/app/domain/services/context/vision.py)、[visual_artifacts.py](../ray_agent/api/app/application/services/visual_artifacts.py)；传输在 [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)，并发执行在 [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) | [test_visual_resources.py](../ray_agent/api/tests/core/test_visual_resources.py)、[test_protocols.py](../ray_agent/api/tests/protocols/test_protocols.py)、[test_run_events_pg.py](../ray_agent/api/tests/core/test_run_events_pg.py) |
| 浏览器截图与结果投影 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)：`_handle_tool_event()`、`_capture_screenshot()`；内容 [event.py](../ray_agent/api/app/domain/models/event.py)、[SSE 映射](../ray_agent/api/app/interfaces/schemas/event.py)；[本地存储](../ray_agent/api/app/infrastructure/external/file_storage/local_file_storage.py)、[COS](../ray_agent/api/app/infrastructure/external/file_storage/cos_file_storage.py) | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) |
| 沙箱画面转发（VNC WebSocket） | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `vnc_websocket()` | — |
| 沙箱侧文件与 Shell 服务 | [file.py](../ray_agent/sandbox/app/services/file.py)、[shell.py](../ray_agent/sandbox/app/services/shell.py)（沙箱）。服务进程以 ubuntu 运行，配置在 [supervisord.conf](../ray_agent/sandbox/supervisord.conf) | [test_shell_service.py](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱） |
| 沙箱侧存活时间与销毁 | [supervisor.py](../ray_agent/sandbox/app/services/supervisor.py)（沙箱） | — |

### 批次与耗时观察

| 观察环节 | 实现入口 |
|---|---|
| 模型批次参数 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)：`_responses_kwargs()`、`_request_kwargs()` |
| 顺序执行及失败后的推进 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)：`_loop()` |
| 准备资源 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)：`_create_task()`；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)：`invoke()` |
| 工具及后处理耗时 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py)：`_record_duration()`、`stages_ms`；准备阶段另记日志 |
| 前端结果与失败投影 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts)：`buildResult()`、`readSuccess()` |

## 会话标题

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 临时标题、异步生成、手动优先与 AI 建议 | [title_service.py](../ray_agent/api/app/application/services/title_service.py)、[agent_service.py](../ray_agent/api/app/application/services/agent_service.py)；界面 [rename-session-dialog.tsx](../ray_agent/ui/src/components/rename-session-dialog.tsx) | [test_title_service.py](../ray_agent/api/tests/core/test_title_service.py) |

## 托管项目与记忆

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 文件操作与旧写入者 | [project_operations.py](../ray_agent/api/app/domain/services/project_operations.py)、[project_file_coordinator.py](../ray_agent/api/app/domain/services/project_file_coordinator.py) | [test_project_operations_pg.py](../ray_agent/api/tests/core/test_project_operations_pg.py) |
| 上传、快照、恢复与下载 | [project_file_service.py](../ray_agent/api/app/application/services/project_file_service.py)、[snapshot_disk.py](../ray_agent/api/app/infrastructure/external/project/snapshot_disk.py)、[file_io.py](../ray_agent/api/app/infrastructure/external/project/file_io.py) | [test_project_uploads.py](../ray_agent/api/tests/core/test_project_uploads.py)、[test_project_snapshots_pg.py](../ray_agent/api/tests/core/test_project_snapshots_pg.py)、[test_project_download.py](../ray_agent/api/tests/core/test_project_download.py) |
| 项目背景、版本化笔记、摘要与冻结 | [project_memory_service.py](../ray_agent/api/app/application/services/project_memory_service.py)、[summary_material.py](../ray_agent/api/app/domain/services/summary_material.py) | [test_project_memory_pg.py](../ray_agent/api/tests/core/test_project_memory_pg.py) |
| 数据清理任务与资源删除 | [data_cleanup_service.py](../ray_agent/api/app/application/services/data_cleanup_service.py)、[db_data_cleanup_repository.py](../ray_agent/api/app/infrastructure/repositories/db_data_cleanup_repository.py)、[data_cleanup_resources.py](../ray_agent/api/app/infrastructure/external/project/data_cleanup_resources.py)、[data_admission.py](../ray_agent/api/app/interfaces/data_admission.py) | [test_data_cleanup_pg.py](../ray_agent/api/tests/core/test_data_cleanup_pg.py)、[test_data_cleanup_resources.py](../ray_agent/api/tests/core/test_data_cleanup_resources.py)、[test_data_cleanup_routes.py](../ray_agent/api/tests/core/test_data_cleanup_routes.py) |
| 附件与交付项目副本 | [project_delivery_service.py](../ray_agent/api/app/application/services/project_delivery_service.py) | [test_project_attachments_pg.py](../ray_agent/api/tests/core/test_project_attachments_pg.py)、[test_project_delivery_pg.py](../ray_agent/api/tests/core/test_project_delivery_pg.py) |
| 导入审核树 | [project-upload-dialog.tsx](../ray_agent/ui/src/components/project-upload-dialog.tsx)、[project-upload-tree.tsx](../ray_agent/ui/src/components/project-upload-tree.tsx)、[project-upload.ts](../ray_agent/ui/src/lib/project-upload.ts) | [check-project-upload-tree.cjs](../ray_agent/ui/scripts/check-project-upload-tree.cjs) |
| 记忆编辑、冲突与历史草稿 | [project-memory-panel.tsx](../ray_agent/ui/src/components/project-memory-panel.tsx) | [check-project-memory.cjs](../ray_agent/ui/scripts/check-project-memory.cjs) |
| 导航与工作台 | [left-panel.tsx](../ray_agent/ui/src/components/left-panel.tsx)、[project-workspace.tsx](../ray_agent/ui/src/components/project-workspace.tsx)、[managed-project-pane.tsx](../ray_agent/ui/src/components/workbench/managed-project-pane.tsx) | [check-project-navigation-recovery.cjs](../ray_agent/ui/scripts/check-project-navigation-recovery.cjs)、[check-workbench-recovery.cjs](../ray_agent/ui/scripts/check-workbench-recovery.cjs) |

## 外部协议

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| MCP 发现、别名路由、调用 | [mcp.py](../ray_agent/api/app/infrastructure/protocols/mcp.py) 的 `tool_name()` | — |
| A2A 卡片读取、委派、轮询、取消 | [a2a.py](../ray_agent/api/app/infrastructure/protocols/a2a.py) | — |
| 结果截断与错误归一 | [common.py](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `describe_content()` | — |
| 协议工具与网关 | [tools](../ray_agent/api/app/domain/services/tools) 的 `mcp.py`、`a2a.py`、`protocol_gateway.py` | — |
| 可运行实验 | [a2a](../labs/a2a)（仓库根） | — |

## 文件与交付

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 上传同步进沙箱 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_sync_file_to_sandbox()` | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py) |
| 文件交付为附件 | [deliver.py](../ray_agent/api/app/domain/services/tools/deliver.py) 的 `DeliverTool`，交付函数为 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_deliver_file()` | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py)、[test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 文件元数据与仓库 | [file.py](../ray_agent/api/app/domain/models/file.py)、[db_file_repository.py](../ray_agent/api/app/infrastructure/repositories/db_file_repository.py) | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py) |
| 存储适配 | [file_storage](../ray_agent/api/app/infrastructure/external/file_storage) 的 `local_file_storage.py`、`cos_file_storage.py` | [test_file_storage_settings.py](../ray_agent/api/tests/core/test_file_storage_settings.py) |
| 统一只读预览 | [file_preview_service.py](../ray_agent/api/app/application/services/file_preview_service.py)、[file_preview.py](../ray_agent/api/app/domain/models/file_preview.py)、[file_preview](../ray_agent/api/app/infrastructure/external/file_preview)、[preview_routes.py](../ray_agent/api/app/interfaces/endpoints/preview_routes.py) | [test_file_preview.py](../ray_agent/api/tests/core/test_file_preview.py) |
| 附件 ZIP 与原文件下载 | [file_service.py](../ray_agent/api/app/application/services/file_service.py)、[file_routes.py](../ray_agent/api/app/interfaces/endpoints/file_routes.py) | [test_file_preview.py](../ray_agent/api/tests/core/test_file_preview.py) |

### 用户图片

| 环节 | 入口 |
|---|---|
| 受理与编码 | [attachment_images.py](../ray_agent/api/app/application/services/attachment_images.py)、[image_input.py](../ray_agent/api/app/infrastructure/external/file_storage/image_input.py) |
| 能力校验与沙箱同步 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)、[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) |
| 消息装配与容量 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)、[vision.py](../ray_agent/api/app/domain/services/context/vision.py) |
| 普通识图与工具识别规则 | [image_input.py 提示](../ray_agent/api/app/domain/services/prompts/image_input.py) |
| 定向检查 | [test_attachment_images.py](../ray_agent/api/tests/core/test_attachment_images.py) |

## 前端

| 机制 | 主要入口 |
|---|---|
| 事件订阅与视图投影 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `projectSession` 与 `resolveOutputRate`、[session-view.ts](../ray_agent/ui/src/lib/session-view.ts)、[use-session-detail.ts](../ray_agent/ui/src/hooks/use-session-detail.ts)。文本增量不进入带序号的事件列表。[session-events.ts](../ray_agent/ui/src/lib/session-events.ts) 只做事件归一化 |
| 接口请求 | [api](../ray_agent/ui/src/lib/api) 的 `session.ts`（含 `compact`、审批答复 `replyApproval`）、`project.ts`、`config.ts`（含工具策略）、`file.ts`、`fetch.ts` |
| 输入框命令注册表 | [commands.ts](../ray_agent/ui/src/lib/commands.ts)、[slash-trigger.ts](../ray_agent/ui/src/lib/slash-trigger.ts)、[input-command-menu.tsx](../ray_agent/ui/src/components/input-command-menu.tsx) |
| 首页与图片输入 | [page.tsx](../ray_agent/ui/src/app/page.tsx)、[chat-input.tsx](../ray_agent/ui/src/components/chat-input.tsx)、[composer-images.ts](../ray_agent/ui/src/lib/composer-images.ts)；选择 [model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx)，草稿 [drafts.ts](../ray_agent/ui/src/lib/drafts.ts)；[检查](../ray_agent/ui/scripts/check-composer-images.cjs) |
| 上下文占用与用量详情 | [context-ring.tsx](../ray_agent/ui/src/components/run/context-ring.tsx) |
| 项目选择器与会话标题项目信息 | [project-picker.tsx](../ray_agent/ui/src/components/project-picker.tsx)；会话页 [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx) |
| 文件与图片共享查看器 | [preview](../ray_agent/ui/src/components/preview)、[preview.ts](../ray_agent/ui/src/lib/api/preview.ts)（HTML 新标签页打开为 `openPreviewTab`，隔离响应头为 [preview_routes.py](../ray_agent/api/app/interfaces/endpoints/preview_routes.py) 的 `HTML_CSP`），恢复检查 [check-workbench-recovery.cjs](../ray_agent/ui/scripts/check-workbench-recovery.cjs) |
| 侧栏会话状态与未查看圆点 | [run-status.tsx](../ray_agent/ui/src/components/run/run-status.tsx)、[session-item.tsx](../ray_agent/ui/src/components/session-item.tsx)；完成计数 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)；清除 [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx) |
| 工作台项目页 | [project-pane.tsx](../ray_agent/ui/src/components/workbench/project-pane.tsx)；页签在 [workbench.tsx](../ray_agent/ui/src/components/workbench/workbench.tsx) |
| 历史计划查看 | [plan-list-dialog.tsx](../ray_agent/ui/src/components/run/plan-list-dialog.tsx)，历史归并在 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) |
| 「按计划执行」 | [run-end-bar.tsx](../ray_agent/ui/src/components/run/run-end-bar.tsx) 的 `PlanExecuteBar`，有效性判断在会话视图投影与会话页 |
| 审批条目与审批卡 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `approval` 分支；[approval-card.tsx](../ray_agent/ui/src/components/run/approval-card.tsx)；提交 [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx) 的 `handleApproval` |
| 会话页 | [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx)：状态条、时间线、计划条、输入框，以及对话与开发者视图切换 |
| 主区执行状态与消息文件引用 | [run-status.tsx](../ray_agent/ui/src/components/run/run-status.tsx) 按当前活动显示状态；[message-file-links.ts](../ray_agent/ui/src/lib/message-file-links.ts)、[markdown-content.tsx](../ray_agent/ui/src/components/markdown-content.tsx) 解析已交付文件，版本快照在 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts)；检查 [check-chat-progress.cjs](../ray_agent/ui/scripts/check-chat-progress.cjs) |
| 回复下方统计 | [timeline-item.tsx](../ray_agent/ui/src/components/run/timeline-item.tsx)、[status-bar.tsx](../ray_agent/ui/src/components/run/status-bar.tsx)；口径函数 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `resolveOutputRate` |
| 运行视图 | [run](../ray_agent/ui/src/components/run) |
| 工作台 | [workbench.tsx](../ray_agent/ui/src/components/workbench/workbench.tsx)：终端、浏览器正文/状态/按需截图、会话文件 |
| 开发者显隐策略 | [use-developer-mode.ts](../ray_agent/ui/src/hooks/use-developer-mode.ts)：hook、区域工厂与浏览器偏好；检查 [check-developer-mode.cjs](../ray_agent/ui/scripts/check-developer-mode.cjs) |
| 开发者视图 | [developer-view.tsx](../ray_agent/ui/src/components/developer/developer-view.tsx) |
| 设置页 | [settings](../ray_agent/ui/src/components/settings)，路由 `/settings`；工具策略分区为 `tool-policy-section.tsx` |
| 组件状态目录 | [page.tsx](../ray_agent/ui/src/app/dev/components/page.tsx)，仅开发模式 |

### 项目界面入口

项目主页、文件与记忆分区见 [project-workspace.tsx](../ray_agent/ui/src/components/project-workspace.tsx)、[project-files-page.tsx](../ray_agent/ui/src/components/project-files-page.tsx)、[project-memory-page.tsx](../ray_agent/ui/src/components/project-memory-page.tsx)；数据确认与后台进度见 [data-cleanup-dialog.tsx](../ray_agent/ui/src/components/data-cleanup-dialog.tsx)、[data-cleanup-notice.tsx](../ray_agent/ui/src/components/data-cleanup-notice.tsx)。

## 装配与配置

| 机制 | 主要入口 |
|---|---|
| 依赖组装 | [service_dependencies.py](../ray_agent/api/app/interfaces/service_dependencies.py) |
| 应用启动与关闭 | [main.py](../ray_agent/api/app/main.py) |
| 运行时配置 | [config.py](../ray_agent/api/core/config.py) |
| 模型、协议、预算与工具策略配置 | [app_config.py](../ray_agent/api/app/domain/models/app_config.py)、[app_config_service.py](../ray_agent/api/app/application/services/app_config_service.py)；设置接口在 [app_config_routes.py](../ray_agent/api/app/interfaces/endpoints/app_config_routes.py) |
| 反向代理与路由 | [default.conf](../ray_agent/nginx/conf.d/default.conf)（仓库根） |

## 模型配置与切换

选择时机、冻结边界与主循环、压缩、辅助请求的分工见 [Harness 模型选择与请求分工](harness.md#模型选择与请求分工)。

| 机制 | 代码 | 验证 |
|---|---|---|
| 厂商档位、温度兼容性与采样优先级 | [model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py)、[app_config_service.py](../ray_agent/api/app/application/services/app_config_service.py) | [test_model_configuration.py](../ray_agent/api/tests/core/test_model_configuration.py)、[test_model_catalog.py](../ray_agent/api/tests/core/test_model_catalog.py) |
| 内部端点环境读取、模型到端点映射与 GPT 续接 | [llm_endpoints.py](../ray_agent/api/app/domain/models/llm_endpoints.py)、[endpoint_settings.py](../ray_agent/api/app/infrastructure/external/llm/endpoint_settings.py)、[model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) | [test_llm_endpoints.py](../ray_agent/api/tests/core/test_llm_endpoints.py)、[test_llm_api_key.py](../ray_agent/api/tests/core/test_llm_api_key.py) |
| 默认预算一次迁移 | [file_app_config_repository.py](../ray_agent/api/app/infrastructure/repositories/file_app_config_repository.py) | 同上配置检查 |
| 会话切换原子保存、完整请求只读估算 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 set_model / preview_context | 同上配置检查 |
| 会话参数绑定与运行模型恢复 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `_remember_model()`、`_bind_sampling()`、`_llm_for_run()`；[model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) 的 `choose_sampling()`、`model_request()` | [test_model_configuration.py](../ray_agent/api/tests/core/test_model_configuration.py)、[test_llm_endpoints.py](../ray_agent/api/tests/core/test_llm_endpoints.py) |
| 标题与项目摘要的辅助请求选择 | [model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) 的 `auxiliary_call()`；调用方 [title_service.py](../ray_agent/api/app/application/services/title_service.py)、[project_memory_service.py](../ray_agent/api/app/application/services/project_memory_service.py)；历史压缩另查[上下文与记忆](#上下文与记忆) | [test_title_service.py](../ray_agent/api/tests/core/test_title_service.py)、[test_model_catalog.py](../ray_agent/api/tests/core/test_model_catalog.py)、[test_project_memory_pg.py](../ray_agent/api/tests/core/test_project_memory_pg.py) |
| 模型设置草稿、动态思考滑块与选择 | [llm-section.tsx](../ray_agent/ui/src/components/settings/llm-section.tsx)、[model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx)、[model-selection.ts](../ray_agent/ui/src/lib/model-selection.ts) | [check-model-configuration.cjs](../ray_agent/ui/scripts/check-model-configuration.cjs) |

运行命令维护在所属服务指南；历史验证概况见[维护与优化计划](plan/README.md#关键验收)。

模型偏好的前端链路：[model-preference.ts](../ray_agent/ui/src/lib/model-preference.ts) 管理同源本地选择，[model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx) 恢复并在确认后保存，[chat-input.tsx](../ray_agent/ui/src/components/chat-input.tsx) 传递实际发送选择。
