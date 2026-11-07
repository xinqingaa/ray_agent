# 代码地图

本文按机制索引核心（API）、UI、桌面宿主与共享契约的实现及定向检查。首次接手从主执行路径开始，具体改动按主题追查；服务内部目录职责见所属 README 的代码导航。

## 怎么读

| 服务 | 实现根目录 | 检查根目录 |
|---|---|---|
| API | [api/app](../ray_agent/api/app) | [api/tests](../ray_agent/api/tests) |
| UI | [ui/src](../ray_agent/ui/src) | [ui/scripts](../ray_agent/ui/scripts) |
| 桌面宿主 | [desktop/src](../ray_agent/desktop/src) | [contract.rs](../ray_agent/desktop/src/contract.rs) 的 `cargo test`；运行检查见[桌面开发指南](../ray_agent/desktop/README.md#检查) |
| 共享契约 | 契约模型在 API 中，生成结果在 [contracts/generated](../ray_agent/contracts/generated) | [test_contracts.py](../ray_agent/api/tests/core/test_contracts.py)、[generate.mjs](../ray_agent/contracts/scripts/generate.mjs) 的 `npm run check` |

各主题列出实现入口与定向检查；[主执行路径](#主执行路径)用于首次定位，专题索引用于按影响继续追查。源码是当前行为的最终依据，测试帮助理解约定与覆盖范围；测试存在不表示当前版本已通过运行验证。

## 主执行路径

| 路径环节 | 主入口 | 继续核对 |
|---|---|---|
| 接收会话请求 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `chat()` | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()` 同事务受理消息、运行与持久输入，`_create_task()` 按能力声明组装运行器 |
| 组织一次执行 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()` | `_prepare_run()` 准备快照，`_take_message()` 从持久输入取消息，`_process()` 进入循环，`_finish()` 保存等待或终态 |
| 请求模型与决定下一动作 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `invoke()`、`_loop()` | 模型请求、容量、计划及成果反馈分别查下方主题；模型参数与通信编码在基础设施适配 |
| 执行工具 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `run()` | 执行前处理模式与策略，工具声明连接具体适配，结果按调用 ID 回填 |
| 保存事实与展示 | [run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) | 运行器把事件、记忆与输入消费同事务提交，前端 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 派生视图；数据库提交和外部副作用分别判断 |

## 共享契约

契约的分层、生成命令、版本规则与使用约定见[契约指南](../ray_agent/contracts/README.md)。

| 机制 | 主要入口 | 定向检查 |
|---|---|---|
| 身份类型、相对路径、可访问根与版本引用 | [identity.py](../ray_agent/api/app/domain/models/identity.py) | [test_contracts.py](../ray_agent/api/tests/core/test_contracts.py) |
| 结构化错误：代码、异常与 HTTP 状态映射 | [error.py](../ray_agent/api/app/domain/models/error.py)、[exceptions.py](../ray_agent/api/app/application/errors/exceptions.py)、[exception_handlers.py](../ray_agent/api/app/interfaces/errors/exception_handlers.py)；界面 [fetch.ts](../ray_agent/ui/src/lib/api/fetch.ts) 的 `ApiError` | 同上；[check-send-recovery.cjs](../ray_agent/ui/scripts/check-send-recovery.cjs) |
| 响应包装 | [base.py](../ray_agent/api/app/interfaces/schemas/base.py) | [test_contracts.py](../ray_agent/api/tests/core/test_contracts.py) |
| 长操作 | 模型 [operation.py](../ray_agent/api/app/domain/models/operation.py)，接口视图 [operation.py](../ray_agent/api/app/interfaces/schemas/operation.py)，查询、取消与重试路由 [operation_routes.py](../ray_agent/api/app/interfaces/endpoints/operation_routes.py) | 同上；[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) 的后台任务用例 |
| 能力声明与当前上报 | [capability.py](../ray_agent/api/app/domain/models/capability.py)、[capability_service.py](../ray_agent/api/app/application/services/capability_service.py) | 同上 |
| 版本、启动参数、握手与状态 | [core.py](../ray_agent/api/app/interfaces/schemas/core.py)、[core_descriptor.py](../ray_agent/api/app/interfaces/core_descriptor.py)（存储版本取自业务库迁移）、[status_routes.py](../ray_agent/api/app/interfaces/endpoints/status_routes.py)、[sidecar.py](../ray_agent/api/sidecar.py) | 同上；[test_status_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_status_routes.py)（真实生命周期） |
| 事件信封与联合类型 | [event.py](../ray_agent/api/app/interfaces/schemas/event.py) 的 `SessionEvent`、`StreamEvent`、`EventMapper` | 同上；[test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py) |
| 执行与平台端口 | [workspace_files.py](../ray_agent/api/app/domain/external/workspace_files.py)、[process_executor.py](../ray_agent/api/app/domain/external/process_executor.py)、[browser_session.py](../ray_agent/api/app/domain/external/browser_session.py)、[runtime_components.py](../ray_agent/api/app/domain/external/runtime_components.py) | [test_contracts.py](../ray_agent/api/tests/core/test_contracts.py)（值类型） |
| 导出与生成 | [contracts.py](../ray_agent/api/scripts/contracts.py)、[generate.mjs](../ray_agent/contracts/scripts/generate.mjs) | `npm run check`；API 契约测试中的过期检查 |
| 界面引用生成类型 | [types.ts](../ray_agent/ui/src/lib/api/types.ts)，路径别名在 [tsconfig.json](../ray_agent/ui/tsconfig.json) | UI 的 lint 与构建 |
| 宿主对齐 | [contract.rs](../ray_agent/desktop/src/contract.rs) | `cargo test` |

## Agent 循环与工具管线

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 单循环：补充消息、模型请求、多调用执行、有限结束反馈与答复 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `AgentLoop.invoke()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 模型重试、输出截断与请求上限 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_request_model()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py) |
| 请求预算的提醒与收尾 | [run_budget.py](../ray_agent/api/app/domain/services/run_budget.py)：`budget_phase()`、`FinalizeGuard`；循环 `_advance_budget()`；审批计数在 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_budget_used_before_approval()` | [test_run_budget.py](../ray_agent/api/tests/core/test_run_budget.py) |
| 工具三段管线：解析校验、执行一次、耗时 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `ToolPipeline.run()`、`add_before()`、`add_after()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 工具策略授权：规则匹配、deny 短路、ask 挂起 | [tool_policy.py](../ray_agent/api/app/domain/services/tool_policy.py)：`resolve_policy()`、`ToolPolicyGuard`；规则 [app_config.py](../ray_agent/api/app/domain/models/app_config.py)，别名 [mcp.py](../ray_agent/api/app/infrastructure/protocols/mcp.py) | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py) |
| Plan 模式执行前检查 | [plan_mode.py](../ray_agent/api/app/domain/services/plan_mode.py) 的 `PlanModeGuard`（注册在 `ToolPolicyGuard` 之前）；后缀 [plan_mode.py](../ray_agent/api/app/domain/services/prompts/plan_mode.py) | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 审批续接 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `resume_approval()`；运行器入口为 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_process_approval()` | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 悬空调用补结果与续接 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `repair_dangling_calls()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 计划清单工具 | [plan.py](../ray_agent/api/app/domain/services/tools/plan.py) 的 `PlanTool`，数据结构见 [plan.py](../ray_agent/api/app/domain/models/plan.py) | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_state_persistence.py](../ray_agent/api/tests/core/test_state_persistence.py)、[test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py) |
| 稳定阶段、范围与成果核验 | [plan.py 模型](../ray_agent/api/app/domain/models/plan.py)、[plan.py 工具](../ray_agent/api/app/domain/services/tools/plan.py)、[task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py)；循环 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) | [test_staged_plan.py](../ray_agent/api/tests/core/test_staged_plan.py)、[check-plan-progress.cjs](../ray_agent/ui/scripts/check-plan-progress.cjs)；[成果机制](harness.md#核验与成果交付) |
| 计划事务承接 | [plan_acceptance.py](../ray_agent/api/app/domain/models/plan_acceptance.py)、[run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 的 `start()` 与 [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()` | [test_sqlite_round_trips.py](../ray_agent/api/tests/core/test_sqlite_round_trips.py) 的计划承接并发用例 |
| 构建身份 | [build_identity.py](../ray_agent/api/build_identity.py)，冻结时由 [rayagent-core.spec](../ray_agent/api/rayagent-core.spec) 写入清单 | [test_build_identity.py](../ray_agent/api/tests/core/test_build_identity.py) |
| 计划核对与稳定身份展示 | [plan_progress.py](../ray_agent/api/app/domain/services/plan_progress.py) 的 `PlanProgress`；前端 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 与 [plan-bar.tsx](../ray_agent/ui/src/components/run/plan-bar.tsx) | [test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py)、[check-plan-progress.cjs](../ray_agent/ui/scripts/check-plan-progress.cjs) |
| 提示词与任务语义规划 | [system.py](../ray_agent/api/app/domain/services/prompts/system.py)、[计划模式](../ray_agent/api/app/domain/services/prompts/plan_mode.py)及 [英文提示](../ray_agent/api/app/domain/services/prompts/en/)；[工具说明](../ray_agent/api/app/domain/services/tools/plan.py)与 [plan_progress.py](../ray_agent/api/app/domain/services/plan_progress.py) | [test_plan_progress.py](../ray_agent/api/tests/core/test_plan_progress.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)；[规划语义](harness.md#计划清单) |
| 脚本化模型与循环测试夹具 | [scripted_llm.py](../ray_agent/api/tests/support/scripted_llm.py)、[loop_harness.py](../ray_agent/api/tests/support/loop_harness.py)（相对 `ray_agent/api/`） | [test_scripted_llm.py](../ray_agent/api/tests/core/test_scripted_llm.py) |

## 上下文与记忆

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 消息序列组装、按轮切分与整体替换 | [memory.py](../ray_agent/api/app/domain/models/memory.py) 的 `rounds()`、`replace()`；按模型回传规则删除推理字段为 `strip_reasoning()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 请求前容量估算：四部分构成、usage 校准、可用上限与水位 | [budget.py](../ray_agent/api/app/domain/services/context/budget.py) 的 `ContextBudget`、`ContextEstimate`；由 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_ensure_capacity()` 在每轮 `turn(started)` 前调用 | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 自动压缩：范围选择、用户原文重新注入、摘要请求 | [compaction.py](../ray_agent/api/app/domain/services/context/compaction.py) 与 [compactor.py](../ray_agent/api/app/domain/services/context/compactor.py) 的 `Compactor`；循环内调用在 [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)；提示词 [compact.py](../ray_agent/api/app/domain/services/prompts/compact.py)（英文版在 `prompts/en/`） | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 请求装配与固定输入检查 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_request_messages()`；[budget.py](../ray_agent/api/app/domain/services/context/budget.py) 的 `fixed_input_estimate()` | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py) |
| 工作方式（带版本短文本、提议确认、模板） | 领域 [working_style.py](../ray_agent/api/app/domain/models/working_style.py)；服务 [working_style_service.py](../ray_agent/api/app/application/services/working_style_service.py)；路由 [instruction_routes.py](../ray_agent/api/app/interfaces/endpoints/instruction_routes.py)；界面 [working-style-settings.tsx](../ray_agent/ui/src/components/workspace/working-style-settings.tsx) | [test_memory_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_memory_routes.py)、[test_memory_isolation.py](../ray_agent/api/tests/core/test_memory_isolation.py) |
| 工作区长期记忆（条目／来源／变更／抑制／提炼规则） | 领域 [workspace_memory.py](../ray_agent/api/app/domain/models/workspace_memory.py)、[memory_rules.py](../ray_agent/api/app/domain/services/memory_rules.py)；服务 [memory_service.py](../ray_agent/api/app/application/services/memory_service.py)；路由 [memory_routes.py](../ray_agent/api/app/interfaces/endpoints/memory_routes.py)；工具 [tools/memory.py](../ray_agent/api/app/domain/services/tools/memory.py)；界面 [memory-panel.tsx](../ray_agent/ui/src/components/workspace/memory-panel.tsx) | [test_memory_isolation.py](../ray_agent/api/tests/core/test_memory_isolation.py)、[test_memory_extraction_rules.py](../ray_agent/api/tests/core/test_memory_extraction_rules.py) |
| 自动提炼与会话摘要后台任务 | 登记与处理 [memory_jobs.py](../ray_agent/api/app/application/services/memory_jobs.py)；提炼端口 [memory_extractor.py](../ray_agent/api/app/application/services/memory_extractor.py)；材料选择 [summary_material.py](../ray_agent/api/app/domain/services/summary_material.py)；生成 [session_summary.py](../ray_agent/api/app/application/services/session_summary.py)；`OperationKind.MEMORY_EXTRACTION`／`SESSION_SUMMARY` 在 [main.py](../ray_agent/api/app/main.py) 注册 | [test_memory_extraction_rules.py](../ray_agent/api/tests/core/test_memory_extraction_rules.py)、[test_memory_context_runtime.py](../ray_agent/api/tests/core/test_memory_context_runtime.py) |
| 检索端口与 FTS5／中文分词底座 | 分词 [chinese_tokenize.py](../ray_agent/api/app/domain/services/chinese_tokenize.py)；检索服务 [retrieval_service.py](../ray_agent/api/app/application/services/retrieval_service.py)；仓库 [db_search_repository.py](../ray_agent/api/app/infrastructure/repositories/db_search_repository.py)；路由 [retrieval_routes.py](../ray_agent/api/app/interfaces/endpoints/retrieval_routes.py)；本包接入记忆与会话摘要，文件片段留给 P6 | [test_memory_isolation.py](../ray_agent/api/tests/core/test_memory_isolation.py) |
| 上下文装配与运行背景清单（本次参考） | [context_assembly.py](../ray_agent/api/app/application/services/context_assembly.py)、[run_context.py](../ray_agent/api/app/domain/models/run_context.py)；运行衔接 [workspace_memory_runtime.py](../ray_agent/api/app/application/services/workspace_memory_runtime.py)；界面 [run-references.tsx](../ray_agent/ui/src/components/run/run-references.tsx) | [test_memory_context_runtime.py](../ray_agent/api/tests/core/test_memory_context_runtime.py) |
| 有来源的会话摘要 | 材料选择 [summary_material.py](../ray_agent/api/app/domain/services/summary_material.py)、[db_session_repository.py](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py) 的 `summary_material()`；生成与多会话预算 [session_summary.py](../ray_agent/api/app/application/services/session_summary.py)；持久化与检索接入见上行后台任务 | [test_summary_material.py](../ray_agent/api/tests/core/test_summary_material.py)、[test_memory_extraction_rules.py](../ray_agent/api/tests/core/test_memory_extraction_rules.py) |
| 手动压缩接口 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `compact_session()`；路由 [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `POST /sessions/{id}/compact` | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)、[test_sqlite_round_trips.py](../ray_agent/api/tests/core/test_sqlite_round_trips.py) |
| 工具结果整形与落盘 | [shaping.py](../ray_agent/api/app/domain/services/context/shaping.py) 的 `ResultShaper`（工具管线执行后段最后一个处理函数），完整内容经 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_write_output()` 写入会话工作目录；协议截断前的完整内容见 [common.py](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `keep_full_content()` | [test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py)、[test_result_shaping.py](../ray_agent/api/tests/protocols/test_result_shaping.py) |
| 模型调用、流式组装、`finish_reason`、可重试错误与上下文超长拒绝 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)（协议选择、语义流完整终态、空闲超时）；[Responses 转换](../ray_agent/api/app/infrastructure/external/llm/responses.py) 处理输入、推理回传与错误分类、[llm.py](../ray_agent/api/app/domain/external/llm.py) 的 `LLMRequestError` 与 `on_delta` | [test_responses_api.py](../ray_agent/api/tests/core/test_responses_api.py)、[test_openai_stream.py](../ray_agent/api/tests/core/test_openai_stream.py)、[test_llm_api_key.py](../ray_agent/api/tests/core/test_llm_api_key.py)、[test_context_governance.py](../ray_agent/api/tests/core/test_context_governance.py) |
| 内嵌工具调用的兼容解析 | [tool_call_compat.py](../ray_agent/api/app/domain/services/agents/tool_call_compat.py) | [test_tool_call_compat.py](../ray_agent/api/tests/core/test_tool_call_compat.py) |
| token 用量记账 | [llm.py](../ray_agent/api/app/domain/models/llm.py)、[usage.py](../ray_agent/api/app/infrastructure/external/llm/usage.py) | [test_llm_usage.py](../ray_agent/api/tests/core/test_llm_usage.py) |

## 工具与动作

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 工具声明、反射收集与方法分发 | [base.py](../ray_agent/api/app/domain/services/tools/base.py) 的 `tool()`、`BaseTool.get_tools()`、`has_tool()`、`invoke()` 与 `_filter_parameters()` | — |
| 工具集装配与模型声明汇总 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `build_default_tools()`（没有可访问范围时不加入文件工具，没有执行资源时不加入 Shell 与浏览器工具）与 `AgentLoop` 构造；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 按能力声明决定交付工具；[tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `schemas()`、`find_toolkit()` | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 参数解析、顶层校验与执行短路 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `parse_arguments()`、`validate_arguments()`；内置参数过滤在 [base.py](../ray_agent/api/app/domain/services/tools/base.py)，核验参数检查在 [task_outcomes.py](../ray_agent/api/app/domain/services/task_outcomes.py) | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py)、[test_staged_plan.py](../ray_agent/api/tests/core/test_staged_plan.py) |
| 模式、策略与读取并发的独立判断 | [plan_mode.py](../ray_agent/api/app/domain/services/plan_mode.py) 的 `PLAN_MODE_ALLOWED`、[tool_policy.py](../ray_agent/api/app/domain/services/tool_policy.py) 的 `resolve_policy()`；[agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_independent_reads()`，执行段并发在 [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `read_batch()` | [test_plan_mode_and_compact.py](../ray_agent/api/tests/core/test_plan_mode_and_compact.py)、[test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_visual_resources.py](../ray_agent/api/tests/core/test_visual_resources.py) |
| 文件工具 | [file.py](../ray_agent/api/app/domain/services/tools/file.py)：`read_file`、`write_file`、`replace_in_file`、`search_in_file`、`list_dir`、`find_files`，按 [file_scope.py](../ray_agent/api/app/domain/services/file_scope.py) 的可访问范围解析路径 | [test_file_tools.py](../ray_agent/api/tests/core/test_file_tools.py)、[test_workspaces.py](../ray_agent/api/tests/core/test_workspaces.py) |
| Shell、浏览器、检索工具 | [tools](../ray_agent/api/app/domain/services/tools) 的 `shell.py`、`browser.py`、`search.py`、`web.py`；前两者在本机执行端口接入前不进入工具集 | — |
| 用户提问工具 | [message.py](../ray_agent/api/app/domain/services/tools/message.py)（调用由 `AgentLoop` 拦截为等待） | [test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 工具结果结构 | [tool_result.py](../ray_agent/api/app/domain/models/tool_result.py) | — |

## 事件、观测与投影

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 领域事件模型 | [event.py](../ray_agent/api/app/domain/models/event.py) | [test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py)、[test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py) |
| 写入顺序：先数据库事务、后通知 | [run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 请求重建 | [request_rebuild.py](../ray_agent/api/app/domain/services/request_rebuild.py) | [test_turn_events_rebuild.py](../ray_agent/api/tests/core/test_turn_events_rebuild.py) |
| 工具事件加工与预览填充 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event()` | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py) |
| SSE 投影与字段省略 | [event.py](../ray_agent/api/app/interfaces/schemas/event.py) | [test_event_observability.py](../ray_agent/api/tests/core/test_event_observability.py) |
| SSE 响应收尾 | [streaming.py](../ray_agent/api/app/interfaces/streaming.py)：会话列表、会话事件与文件夹变更共用 | [test_event_stream_response.py](../ray_agent/api/tests/core/test_event_stream_response.py) |
| 文本增量、首字延迟与失败尝试 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) 组装；[agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py) 回调与尝试；[run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 发布；[session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 映射 | [test_streaming_loop.py](../ray_agent/api/tests/core/test_streaming_loop.py)、[test_openai_stream.py](../ray_agent/api/tests/core/test_openai_stream.py) |
| SSE、会话详情与请求读取 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py)（详情含 `workspace_id`，界面按它归位地址） | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py)、[test_streaming_loop.py](../ray_agent/api/tests/core/test_streaming_loop.py)、[test_workspace_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_workspace_routes.py) |

## 状态与持久化

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 会话状态与计划快照 | [session.py](../ray_agent/api/app/domain/models/session.py)；计划读取为 [event.py](../ray_agent/api/app/domain/models/event.py) 的 `latest_plan()` | [test_state_persistence.py](../ray_agent/api/tests/core/test_state_persistence.py) |
| 数据根与资源目录 | [paths.py](../ray_agent/api/core/paths.py) 的 `DataRoot`、`RESOURCE_ROOT` | [test_status_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_status_routes.py) |
| 业务库：WAL、写协调器、读连接池、busy 重试、实例锁、迁移与 schema 版本 | [sqlite.py](../ray_agent/api/app/infrastructure/storage/sqlite.py) 的 `Database`、`InstanceLock`、`migrate()`；迁移环境 [env.py](../ray_agent/api/alembic/env.py)，基线 [0001_baseline.py](../ray_agent/api/alembic/versions/0001_baseline.py)、[0002_workspaces.py](../ray_agent/api/alembic/versions/0002_workspaces.py)、[0003_write_protection.py](../ray_agent/api/alembic/versions/0003_write_protection.py)，ORM [models](../ray_agent/api/app/infrastructure/models) | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 取消下的连接收尾：驱动调用做完再交出取消，提交、回滚与归还连接不被打断 | [sqlite.py](../ray_agent/api/app/infrastructure/storage/sqlite.py) 的 `uninterrupted()`、`settle()`、`_Connection`、`Database.read_session()`／`write_session()`；流式补读在 [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `stream_events()` 与 [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `stream_sessions()` | [test_sqlite_cancellation.py](../ray_agent/api/tests/core/test_sqlite_cancellation.py) |
| 仓库接口与工作单元 | [uow.py](../ray_agent/api/app/domain/repositories/uow.py)、[db_uow.py](../ray_agent/api/app/infrastructure/repositories/db_uow.py)；真实库测试夹具 [sqlite_db.py](../ray_agent/api/tests/support/sqlite_db.py)（相对 `ray_agent/api/`） | 同上 |
| 运行与事件仓库 | [run_repository.py](../ray_agent/api/app/domain/repositories/run_repository.py)、[event_repository.py](../ray_agent/api/app/domain/repositories/event_repository.py)；实现为 [db_run_repository.py](../ray_agent/api/app/infrastructure/repositories/db_run_repository.py)、[db_event_repository.py](../ray_agent/api/app/infrastructure/repositories/db_event_repository.py) | 同上；[test_sqlite_round_trips.py](../ray_agent/api/tests/core/test_sqlite_round_trips.py) |
| 持久输入与受理记录 | [run_input.py](../ray_agent/api/app/domain/models/run_input.py)、[input_repository.py](../ray_agent/api/app/domain/repositories/input_repository.py)、[db_input_repository.py](../ray_agent/api/app/infrastructure/repositories/db_input_repository.py)；受理、读回与重新发起在 [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()`、`accepted_request()`、`resume_input()`，消费在 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_with_flow_state()` | 同上；[test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 事件与目录通知 | [local_notifier.py](../ray_agent/api/app/infrastructure/external/notification/local_notifier.py) 的 `LocalEventNotifier`、`CatalogNotifier` | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) 的通知失败与补读用例 |
| 后台任务框架 | [background_jobs.py](../ray_agent/api/app/application/services/background_jobs.py)、[background_job.py](../ray_agent/api/app/domain/models/background_job.py)、[db_job_repository.py](../ray_agent/api/app/infrastructure/repositories/db_job_repository.py) | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 工作区、文件夹登记与身份标记 | 模型 [workspace.py](../ray_agent/api/app/domain/models/workspace.py)；服务 [workspace_service.py](../ray_agent/api/app/application/services/workspace_service.py)（新建、打开、识别移动与复制、重新定位、归档、删除任务）；[folder_policy.py](../ray_agent/api/app/application/services/folder_policy.py)；文件夹访问 [folders.py](../ray_agent/api/app/infrastructure/external/workspace_files/folders.py)；仓库 [db_workspace_repository.py](../ray_agent/api/app/infrastructure/repositories/db_workspace_repository.py)；迁移 [0002_workspaces.py](../ray_agent/api/alembic/versions/0002_workspaces.py)；接口 [workspace_routes.py](../ray_agent/api/app/interfaces/endpoints/workspace_routes.py)、[workspace.py](../ray_agent/api/app/interfaces/schemas/workspace.py) | [test_workspaces.py](../ray_agent/api/tests/core/test_workspaces.py)、[test_workspace_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_workspace_routes.py)、[test_workspace_integrity.py](../ray_agent/api/tests/core/test_workspace_integrity.py) |
| 文件夹授权与宿主密钥 | [folder_grants.py](../ray_agent/api/app/application/services/folder_grants.py)、[host_access.py](../ray_agent/api/app/interfaces/host_access.py)、[host_routes.py](../ray_agent/api/app/interfaces/endpoints/host_routes.py)；宿主侧 [sidecar.rs](../ray_agent/desktop/src/sidecar.rs)；开发启动 [sidecar.py](../ray_agent/api/sidecar.py) | 同上；`cargo test` |
| 会话工作目录与可访问根 | [session_workdir.py](../ray_agent/api/app/infrastructure/external/workdir/session_workdir.py)、[db_root_repository.py](../ray_agent/api/app/infrastructure/repositories/db_root_repository.py)；创建与删除在 [session_service.py](../ray_agent/api/app/application/services/session_service.py) | 同上；[test_attachment_images.py](../ray_agent/api/tests/core/test_attachment_images.py) |
| 应用配置 | [db_app_config_repository.py](../ray_agent/api/app/infrastructure/repositories/db_app_config_repository.py)，服务 [app_config_service.py](../ray_agent/api/app/application/services/app_config_service.py) | [test_llm_api_key.py](../ray_agent/api/tests/core/test_llm_api_key.py) |
| 删除会话与清空业务数据（同时清工作区登记、备份与租约，不删文件夹与用户文件） | [session_service.py](../ray_agent/api/app/application/services/session_service.py) 的 `delete_session()`、[data_service.py](../ray_agent/api/app/application/services/data_service.py)、[data_routes.py](../ray_agent/api/app/interfaces/endpoints/data_routes.py) | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |

## 任务控制与生命周期

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 消息受理、事件流与停止 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()`、`stream_events()`、`stop_session()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py)、[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 启动所有权：受理后到任务登记 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `_schedule_start()`、`_start_run()`、`pending_starts()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 运行器主循环与终态写入 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()`、`_finish()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py)、[test_task_error.py](../ray_agent/api/tests/core/test_task_error.py) |
| 停止后的进程收尾 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `stop_processes()` | [test_agent_task_runner_cancel.py](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) |
| 启动扫描 | [main.py](../ray_agent/api/app/main.py) 的 `start_core()`：[run_ledger.py](../ray_agent/api/app/domain/services/run_ledger.py) 的 `interrupt_running()`、[approvals.py](../ray_agent/api/app/domain/services/approvals.py) 的 `interrupt_waiting_approvals()`、后台任务的 `recover()` | [test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 进程内任务注册表与会话锁 | [local_task.py](../ray_agent/api/app/infrastructure/external/task/local_task.py)、[session_locks.py](../ray_agent/api/app/domain/services/session_locks.py) | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 等待用户与续接 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `WaitEvent` 分支 | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py)、[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) 的重启用例 |
| 审批答复、失效与重启处理 | [session_routes.py](../ray_agent/api/app/interfaces/endpoints/session_routes.py)、[agent_service.py](../ray_agent/api/app/application/services/agent_service.py)：`reply_approval()`；失效与补齐 [approvals.py](../ray_agent/api/app/domain/services/approvals.py) | [test_tool_approval.py](../ray_agent/api/tests/core/test_tool_approval.py)、[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 运行中补充消息 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_drain_injected_messages()` | [test_task_execution_control.py](../ray_agent/api/tests/core/test_task_execution_control.py) |
| 预算与超时配置 | [app_config.py](../ray_agent/api/app/domain/models/app_config.py)、[config.py](../ray_agent/api/core/config.py) | — |

## 执行环境

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 本机执行 supervisor 与 ProcessExecutor | [execution/](../ray_agent/api/app/infrastructure/external/execution/)、[runtime.py](../ray_agent/api/app/infrastructure/external/execution/runtime.py) | [test_process_executor.py](../ray_agent/api/tests/core/test_process_executor.py) |
| 浏览器组件与会话 | [components/](../ray_agent/api/app/infrastructure/external/components/)、[local_session.py](../ray_agent/api/app/infrastructure/external/browser/local_session.py) | 能力声明与组件安装走 RuntimeComponents；浏览器资料目录在数据根 `browser-profiles/` |
| 浏览器连接（CDP，核心不装配） | [playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) | — |
| 浏览器真实视口与恢复 | [playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) 的 `set_viewport()` / `restore_viewports()`；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的运行快照与收尾 | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) 的真实视口与 CDP 续接检查 |
| 浏览器正文、元素引用、输入与日志 | [playwright_browser_fun.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser_fun.py) 的 `OBSERVE_PAGE`；[playwright_browser.py](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) 的 `view_page()`、`_target()`、`input()`、`console_view()`；工具声明在 [browser.py](../ray_agent/api/app/domain/services/tools/browser.py) | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) |
| 网页检索 | 实现 [bing_search.py](../ray_agent/api/app/infrastructure/external/search/bing_search.py) | [test_bing_search.py](../ray_agent/api/tests/core/test_bing_search.py) |
| 公开网页读取 | [web.py](../ray_agent/api/app/domain/services/tools/web.py)、端口 [web_reader.py](../ray_agent/api/app/domain/external/web_reader.py)、实现 [public_page.py](../ray_agent/api/app/infrastructure/external/web/public_page.py) | [test_web_fetch.py](../ray_agent/api/tests/core/test_web_fetch.py)、[test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) |
| 系统提示中的运行环境 | [system.py](../ray_agent/api/app/domain/services/prompts/system.py) 的 `RuntimeEnvironment`、`build_system_prompt()`，英文版在 `prompts/en/` | [test_system_prompt.py](../ray_agent/api/tests/core/test_system_prompt.py) |
| 按需资源、图像引用与临时图回收 | [vision.py](../ray_agent/api/app/domain/services/context/vision.py)、[visual_artifacts.py](../ray_agent/api/app/application/services/visual_artifacts.py)；传输在 [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)，并发执行在 [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) | [test_visual_resources.py](../ray_agent/api/tests/core/test_visual_resources.py)、[test_protocols.py](../ray_agent/api/tests/protocols/test_protocols.py)、[test_sqlite_round_trips.py](../ray_agent/api/tests/core/test_sqlite_round_trips.py) |
| 浏览器截图与结果投影 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)：`_handle_tool_event()`、`_capture_screenshot()`（交付截图先写入会话工作目录）；内容 [event.py](../ray_agent/api/app/domain/models/event.py)、[SSE 映射](../ray_agent/api/app/interfaces/schemas/event.py) | [test_browser_efficiency.py](../ray_agent/api/tests/core/test_browser_efficiency.py) |

### 批次与耗时观察

| 观察环节 | 实现入口 |
|---|---|
| 模型批次参数 | [openai_llm.py](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)：`_responses_kwargs()`、`_request_kwargs()` |
| 顺序执行及失败后的推进 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)：`_loop()` |
| 组装运行器 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)：`_create_task()`；[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)：`invoke()` |
| 工具及后处理耗时 | [tool_pipeline.py](../ray_agent/api/app/domain/services/flows/tool_pipeline.py)：`_record_duration()`、`stages_ms`；准备阶段另记日志 |
| 前端结果与失败投影 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts)：`buildResult()`、`readSuccess()` |

## 会话标题

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 临时标题、异步生成、手动优先与 AI 建议 | [title_service.py](../ray_agent/api/app/application/services/title_service.py)、[agent_service.py](../ray_agent/api/app/application/services/agent_service.py)；界面 [rename-session-dialog.tsx](../ray_agent/ui/src/components/rename-session-dialog.tsx) | [test_title_service.py](../ray_agent/api/tests/core/test_title_service.py) |

## 外部协议

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| MCP 发现、别名路由、调用 | [mcp.py](../ray_agent/api/app/infrastructure/protocols/mcp.py) 的 `tool_name()` | — |
| A2A 卡片读取、委派、轮询、取消 | [a2a.py](../ray_agent/api/app/infrastructure/protocols/a2a.py) | — |
| 结果截断与错误归一 | [common.py](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `describe_content()` | — |
| 协议工具与网关 | [tools](../ray_agent/api/app/domain/services/tools) 的 `mcp.py`、`a2a.py`、`protocol_gateway.py` | — |

## 文件与交付

| 机制 | 主要入口 | 回归测试 |
|---|---|---|
| 限根文件 IO：根身份、逐级 `openat`、不跟随链接、原子发布与版本冲突 | 端口 [workspace_files.py](../ray_agent/api/app/domain/external/workspace_files.py)，POSIX 实现 [posix.py](../ray_agent/api/app/infrastructure/external/workspace_files/posix.py)，排除与保留名规则 [file_rules.py](../ray_agent/api/app/domain/services/file_rules.py) | [test_workspace_files.py](../ray_agent/api/tests/core/test_workspace_files.py) |
| 一次运行的可访问范围与写入口 | [file_scope.py](../ray_agent/api/app/domain/services/file_scope.py) 的 `FileScope`、`FileWriteGate`、`WriteOwner`（模型工具对凭据、数据库与版本控制内部路径的拒绝在 `resolve()`，规则见 [file_rules.py](../ray_agent/api/app/domain/services/file_rules.py) 的 `denied_reason()`）；装配 [root_access.py](../ray_agent/api/app/application/services/root_access.py) 的 `RunFileAccess`；应用层写入口 [workspace_writer.py](../ray_agent/api/app/application/services/workspace_writer.py) 的 `WorkspaceWriter` | [test_workspaces.py](../ray_agent/api/tests/core/test_workspaces.py)、[test_write_protection.py](../ray_agent/api/tests/core/test_write_protection.py) |
| 工作区写入租约：取得、重入、停止收尾、重试收尾、启动扫描 | 模型 [write_lease.py](../ray_agent/api/app/domain/models/write_lease.py)；服务 [write_leases.py](../ray_agent/api/app/application/services/write_leases.py)；运行收尾接入 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `stop_processes()` 与 `invoke()`；仓库 [db_write_lease_repository.py](../ray_agent/api/app/infrastructure/repositories/db_write_lease_repository.py) | [test_write_protection.py](../ray_agent/api/tests/core/test_write_protection.py)、[test_workspace_integrity.py](../ray_agent/api/tests/core/test_workspace_integrity.py)、[test_agent_task_runner_cancel.py](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) |
| 写前备份与变更记录 | 模型 [file_change.py](../ray_agent/api/app/domain/models/file_change.py)；备份对象 [workspace_objects.py](../ray_agent/api/app/infrastructure/external/file_storage/workspace_objects.py)；仓库 [db_file_change_repository.py](../ray_agent/api/app/infrastructure/repositories/db_file_change_repository.py)；工作区删除与清空时的回收在 [workspace_service.py](../ray_agent/api/app/application/services/workspace_service.py) 的 `delete()` 与 [data_service.py](../ray_agent/api/app/application/services/data_service.py) | [test_write_protection.py](../ray_agent/api/tests/core/test_write_protection.py) |
| 撤销本次修改与最近修改的运行 | 服务 [file_history.py](../ray_agent/api/app/application/services/file_history.py)；接口 [workspace_history_routes.py](../ray_agent/api/app/interfaces/endpoints/workspace_history_routes.py)、[workspace_changes.py](../ray_agent/api/app/interfaces/schemas/workspace_changes.py) | [test_write_protection.py](../ray_agent/api/tests/core/test_write_protection.py) |
| 外部变更监视与推送 | 服务 [workspace_changes.py](../ray_agent/api/app/application/services/workspace_changes.py)（改绑后 `restart()` 切到新位置）；监视端口 [folder_watch.py](../ray_agent/api/app/domain/external/folder_watch.py)，watchfiles 实现 [watcher.py](../ray_agent/api/app/infrastructure/external/workspace_files/watcher.py)，重扫快照 [posix.py](../ray_agent/api/app/infrastructure/external/workspace_files/posix.py) 的 `snapshot_binding()`；事件 [workspace_change.py](../ray_agent/api/app/domain/models/workspace_change.py) | [test_write_protection.py](../ray_agent/api/tests/core/test_write_protection.py) |
| 按 `root_id` 加相对路径的文件接口 | [root_routes.py](../ray_agent/api/app/interfaces/endpoints/root_routes.py)、[root_access.py](../ray_agent/api/app/application/services/root_access.py) 的 `RootFileService`（宿主「显示位置」的解析是 `locate()`，路由在 [host_routes.py](../ray_agent/api/app/interfaces/endpoints/host_routes.py)）；预览在 [file_preview_service.py](../ray_agent/api/app/application/services/file_preview_service.py) | [test_workspace_routes.py](../ray_agent/api/tests/app/interfaces/endpoints/test_workspace_routes.py) |
| 附件放入工作区文件夹或会话工作目录 | [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_place_attachments()`、`_place_in_workspace()`、`_place_in_workdir()` | [test_workspaces.py](../ray_agent/api/tests/core/test_workspaces.py)、[test_attachment_images.py](../ray_agent/api/tests/core/test_attachment_images.py) |
| 文件交付为附件 | [deliver.py](../ray_agent/api/app/domain/services/tools/deliver.py) 的 `DeliverTool`，交付函数为 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_deliver_file()`（接受可访问范围内的文件，记录 `root_id` 与相对路径） | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py)、[test_agent_loop.py](../ray_agent/api/tests/core/test_agent_loop.py) |
| 文件元数据与仓库 | [file.py](../ray_agent/api/app/domain/models/file.py)、[db_file_repository.py](../ray_agent/api/app/infrastructure/repositories/db_file_repository.py) | [test_file_artifacts.py](../ray_agent/api/tests/core/test_file_artifacts.py) |
| 内容对象 | [local_file_storage.py](../ray_agent/api/app/infrastructure/external/file_storage/local_file_storage.py) | [test_visual_resources.py](../ray_agent/api/tests/core/test_visual_resources.py)、[test_sqlite_storage.py](../ray_agent/api/tests/core/test_sqlite_storage.py) |
| 统一只读预览 | [file_preview_service.py](../ray_agent/api/app/application/services/file_preview_service.py)、[file_preview.py](../ray_agent/api/app/domain/models/file_preview.py)、[file_preview](../ray_agent/api/app/infrastructure/external/file_preview)、[preview_routes.py](../ray_agent/api/app/interfaces/endpoints/preview_routes.py) | [test_file_preview.py](../ray_agent/api/tests/core/test_file_preview.py) |
| 附件 ZIP 与原文件下载 | [file_service.py](../ray_agent/api/app/application/services/file_service.py)、[file_routes.py](../ray_agent/api/app/interfaces/endpoints/file_routes.py) | [test_file_preview.py](../ray_agent/api/tests/core/test_file_preview.py) |

### 用户图片

| 环节 | 入口 |
|---|---|
| 受理与编码 | [attachment_images.py](../ray_agent/api/app/application/services/attachment_images.py)、[image_input.py](../ray_agent/api/app/infrastructure/external/file_storage/image_input.py) |
| 能力校验与附件放置 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py)、[agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py) |
| 消息装配与容量 | [agent_loop.py](../ray_agent/api/app/domain/services/flows/agent_loop.py)、[vision.py](../ray_agent/api/app/domain/services/context/vision.py) |
| 普通识图与工具识别规则 | [image_input.py 提示](../ray_agent/api/app/domain/services/prompts/image_input.py) |
| 定向检查 | [test_attachment_images.py](../ray_agent/api/tests/core/test_attachment_images.py) |

## 前端

| 机制 | 主要入口 |
|---|---|
| 事件订阅与视图投影 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `projectSession` 与 `resolveOutputRate`、[session-view.ts](../ray_agent/ui/src/lib/session-view.ts)、[use-session-detail.ts](../ray_agent/ui/src/hooks/use-session-detail.ts)。文本增量不进入带序号的事件列表。[session-events.ts](../ray_agent/ui/src/lib/session-events.ts) 只做事件归一化 |
| 接口请求 | [api](../ray_agent/ui/src/lib/api) 的 `session.ts`（含 `compact`、审批答复 `replyApproval`）、`config.ts`（含工具策略）、`file.ts`、`preview.ts`（预览、票据与下载）、`fetch.ts`（结构化错误 `ApiError`，地址与令牌经 [core-client.ts](../ray_agent/ui/src/lib/core-client.ts)）；事件、错误、响应包装与核心状态的类型来自[共享契约](#共享契约)的生成结果 |
| 输入框命令注册表 | [commands.ts](../ray_agent/ui/src/lib/commands.ts)、[slash-trigger.ts](../ray_agent/ui/src/lib/slash-trigger.ts)、[input-command-menu.tsx](../ray_agent/ui/src/components/input-command-menu.tsx)、[上下文圆环](../ray_agent/ui/src/components/run/context-ring.tsx)；[菜单检查](../ray_agent/ui/scripts/check-slash-command-menu.cjs) |
| 首页与图片输入 | [home.tsx](../ray_agent/ui/src/pages/home.tsx)（独立对话输入与工作区列表）、[use-start-task.ts](../ray_agent/ui/src/hooks/use-start-task.ts)（按草稿作用域创建会话）、[chat-input.tsx](../ray_agent/ui/src/components/chat-input.tsx)、[composer-images.ts](../ray_agent/ui/src/lib/composer-images.ts)；选择 [model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx)，草稿 [drafts.ts](../ray_agent/ui/src/lib/drafts.ts)（独立、`workspace:<id>`、`session:<id>` 三类作用域）；[检查](../ray_agent/ui/scripts/check-composer-images.cjs) |
| 上下文占用与用量详情 | [context-ring.tsx](../ray_agent/ui/src/components/run/context-ring.tsx) |
| 文件与图片共享查看器 | [preview](../ray_agent/ui/src/components/preview)、[preview.ts](../ray_agent/ui/src/lib/api/preview.ts)（预览对象 `PreviewSource` 分附件与文件夹文件两种，后者不提供下载；图片与 PDF 的票据地址为 `previewContentUrl`，HTML 交给系统浏览器为 `openPreviewTab`，隔离响应头为 [preview_routes.py](../ray_agent/api/app/interfaces/endpoints/preview_routes.py) 的 `HTML_CSP`），恢复检查 [check-workbench-recovery.cjs](../ray_agent/ui/scripts/check-workbench-recovery.cjs)，文件夹文件的地址与票据检查 [check-workspace-preview.cjs](../ray_agent/ui/scripts/check-workspace-preview.cjs) |
| 侧栏会话状态与未查看圆点 | [run-status.tsx](../ray_agent/ui/src/components/run/run-status.tsx)、[session-item.tsx](../ray_agent/ui/src/components/session-item.tsx)；完成计数 [agent_task_runner.py](../ray_agent/api/app/domain/services/agent_task_runner.py)；清除 [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx) |
| 历史计划查看 | [plan-list-dialog.tsx](../ray_agent/ui/src/components/run/plan-list-dialog.tsx)，历史归并在 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) |
| 「按计划执行」 | [run-end-bar.tsx](../ray_agent/ui/src/components/run/run-end-bar.tsx) 的 `PlanExecuteBar`，有效性判断在会话视图投影与会话页 |
| 审批条目与审批卡 | [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `approval` 分支；[approval-card.tsx](../ray_agent/ui/src/components/run/approval-card.tsx)；提交 [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx) 的 `handleApproval` |
| 会话页 | [session-detail-view.tsx](../ray_agent/ui/src/components/session-detail-view.tsx)：状态条、时间线、计划条、输入框，以及对话与开发者视图切换；传入 `workspace` 时右侧面板在文件夹与工作台之间切换，`runFooter` 接收最近一次运行的 id，渲染运行结束后的时间线末尾内容 |
| 主区执行状态与消息文件引用 | [run-status.tsx](../ray_agent/ui/src/components/run/run-status.tsx) 按当前活动显示状态；[message-file-links.ts](../ray_agent/ui/src/lib/message-file-links.ts)、[markdown-content.tsx](../ray_agent/ui/src/components/markdown-content.tsx) 解析已交付文件，版本快照在 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts)；检查 [check-chat-progress.cjs](../ray_agent/ui/scripts/check-chat-progress.cjs) |
| 回复排版与代码高亮 | [markdown-content.tsx](../ray_agent/ui/src/components/markdown-content.tsx)，高亮色在 [globals.css](../ray_agent/ui/src/globals.css) |
| 回复下方统计 | [timeline-item.tsx](../ray_agent/ui/src/components/run/timeline-item.tsx)、[status-bar.tsx](../ray_agent/ui/src/components/run/status-bar.tsx)；口径函数 [session-projection.ts](../ray_agent/ui/src/lib/session-projection.ts) 的 `resolveOutputRate` |
| 运行视图 | [run](../ray_agent/ui/src/components/run) |
| 工作台 | [workbench.tsx](../ray_agent/ui/src/components/workbench/workbench.tsx)：终端、浏览器正文/状态/按需截图、会话文件 |
| 工作区页面与路由 | [workspace.tsx](../ray_agent/ui/src/pages/workspace.tsx)：`WorkspaceLayout`（读取中、不存在、正在删除等状态）、`WorkspaceHomePage`、`WorkspaceSessionPage`；路由 `workspaces/:id` 与 `workspaces/:id/sessions/:sid` 在 [app.tsx](../ray_agent/ui/src/app.tsx)，地址解析在 [workspace-route.ts](../ray_agent/ui/src/lib/workspace-route.ts)，会话地址归位在 [use-canonical-session-route.ts](../ray_agent/ui/src/hooks/use-canonical-session-route.ts) |
| 工作区数据与状态 | [workspaces-provider.tsx](../ray_agent/ui/src/providers/workspaces-provider.tsx)（列表、按 ID 读取、回到前台时核对文件夹）、[workspace.ts](../ray_agent/ui/src/lib/api/workspace.ts)（工作区、长操作与根内文件接口）、[workspace-state.ts](../ray_agent/ui/src/lib/workspace-state.ts)（可用、归档与可写判断，会话列表的范围参数）；检查 [check-workspace-drafts.cjs](../ray_agent/ui/scripts/check-workspace-drafts.cjs) |
| 工作区新建、打开与冲突处理 | [workspace-list.tsx](../ray_agent/ui/src/components/workspace/workspace-list.tsx)、[create-workspace-dialog.tsx](../ray_agent/ui/src/components/workspace/create-workspace-dialog.tsx)、[use-open-folder.tsx](../ray_agent/ui/src/hooks/use-open-folder.tsx)（选择、认回提示）、[use-relocate-folder.ts](../ray_agent/ui/src/hooks/use-relocate-folder.ts) 与 [workspace-relocate.ts](../ray_agent/ui/src/lib/workspace-relocate.ts)（重新定位与失败文案；检查 [check-workspace-relocate.cjs](../ray_agent/ui/scripts/check-workspace-relocate.cjs)）、[marker-conflict-dialog.tsx](../ray_agent/ui/src/components/workspace/marker-conflict-dialog.tsx)、[workspace-notice.ts](../ray_agent/ui/src/lib/workspace-notice.ts)（打开后的扫描摘要） |
| 工作区状态条、重命名、归档与删除 | [workspace-bar.tsx](../ray_agent/ui/src/components/workspace/workspace-bar.tsx)、[workspace-banners.tsx](../ray_agent/ui/src/components/workspace/workspace-banners.tsx)（不可用、归档、扫描摘要）、[rename-workspace-dialog.tsx](../ray_agent/ui/src/components/workspace/rename-workspace-dialog.tsx)、[delete-workspace-dialog.tsx](../ray_agent/ui/src/components/workspace/delete-workspace-dialog.tsx)；后台清理进度 [workspace-deletion-notice.tsx](../ray_agent/ui/src/components/workspace/workspace-deletion-notice.tsx) 与持久记录 [workspace-deletions.ts](../ray_agent/ui/src/lib/workspace-deletions.ts) |
| 文件夹面板：文件树、预览、添加文件、本次成果 | [folder-panel.tsx](../ray_agent/ui/src/components/workspace/folder-panel.tsx)（文件夹、本次成果、最近修改三页，预览文件被改动提示）、[folder-tree.tsx](../ray_agent/ui/src/components/workspace/folder-tree.tsx)、[use-folder-tree.ts](../ray_agent/ui/src/hooks/use-folder-tree.ts)、数据合并 [workspace-tree.ts](../ray_agent/ui/src/lib/workspace-tree.ts)；检查 [check-workspace-tree.cjs](../ray_agent/ui/scripts/check-workspace-tree.cjs) |
| 开发者显隐策略 | [use-developer-mode.ts](../ray_agent/ui/src/hooks/use-developer-mode.ts)：hook、区域工厂与本地偏好；检查 [check-developer-mode.cjs](../ray_agent/ui/scripts/check-developer-mode.cjs) |
| 开发者视图 | [developer-view.tsx](../ray_agent/ui/src/components/developer/developer-view.tsx) |
| 外部变更订阅与写入租约 | [workspace-live-provider.tsx](../ray_agent/ui/src/providers/workspace-live-provider.tsx)（变更流订阅与重连、去抖、可用性写回、租约读取）、[workspace.ts](../ray_agent/ui/src/lib/api/workspace.ts) 的 `historyApi`、纯逻辑 [workspace-changes.ts](../ray_agent/ui/src/lib/workspace-changes.ts)（合并与去抖、受影响目录、租约提示、撤销选择与 `force` 组装）；租约横幅在 [workspace-banners.tsx](../ray_agent/ui/src/components/workspace/workspace-banners.tsx)；检查 [check-workspace-changes.cjs](../ray_agent/ui/scripts/check-workspace-changes.cjs) |
| 撤销本次修改 | [run-changes-bar.tsx](../ray_agent/ui/src/components/workspace/run-changes-bar.tsx)（运行结束条入口）、[undo-dialog.tsx](../ray_agent/ui/src/components/workspace/undo-dialog.tsx)（选择、差异预览、逐项结果）、[recent-changes.tsx](../ray_agent/ui/src/components/workspace/recent-changes.tsx)（最近修改的运行）、[use-session-title.ts](../ray_agent/ui/src/hooks/use-session-title.ts)（占用者标题）；窗口生命周期检查 [check-workspace-undo-dialog.cjs](../ray_agent/ui/scripts/check-workspace-undo-dialog.cjs) |
| 设置页 | [settings](../ray_agent/ui/src/components/settings)，路由 `/settings`；工具策略分区为 `tool-policy-section.tsx`，默认工作区位置为 `workspace-section.tsx` |
| 应用入口、路由与页面标题 | [main.tsx](../ray_agent/ui/src/main.tsx)、[app.tsx](../ray_agent/ui/src/app.tsx)、[pages](../ray_agent/ui/src/pages)；组件取路由能力统一经 [navigation.tsx](../ray_agent/ui/src/lib/navigation.tsx) |
| 侧栏对话列表 | [left-panel.tsx](../ray_agent/ui/src/components/left-panel.tsx)（独立对话与工作区两种形态）、[session-item.tsx](../ray_agent/ui/src/components/session-item.tsx)；列表范围由 [app-shell.tsx](../ray_agent/ui/src/components/app-shell.tsx) 按路由给 [sessions-provider.tsx](../ray_agent/ui/src/providers/sessions-provider.tsx) 决定 |
| 数据清空确认与后台进度（只有全局清空） | [data-cleanup-dialog.tsx](../ray_agent/ui/src/components/data-cleanup-dialog.tsx)、[data-cleanup-notice.tsx](../ray_agent/ui/src/components/data-cleanup-notice.tsx) |
| 组件状态目录 | [component-catalog.tsx](../ray_agent/ui/src/components/dev/component-catalog.tsx)，路由在 `app.tsx`，仅开发模式，不经核心门 |

## 装配与配置

| 机制 | 主要入口 |
|---|---|
| 依赖组装 | [service_dependencies.py](../ray_agent/api/app/interfaces/service_dependencies.py) |
| 应用启动与关闭：实例锁、迁移、配置播种、启动扫描、后台任务与周期回收 | [main.py](../ray_agent/api/app/main.py) 的 `start_core()` 与 `lifespan()` |
| 运行时配置与数据根 | [config.py](../ray_agent/api/core/config.py)、[paths.py](../ray_agent/api/core/paths.py) |
| 模型、协议、预算与工具策略配置 | [app_config.py](../ray_agent/api/app/domain/models/app_config.py)、[app_config_service.py](../ray_agent/api/app/application/services/app_config_service.py)，存于业务库 [db_app_config_repository.py](../ray_agent/api/app/infrastructure/repositories/db_app_config_repository.py)；设置接口在 [app_config_routes.py](../ray_agent/api/app/interfaces/endpoints/app_config_routes.py) |

## 桌面宿主与核心打包

运行命令与检查条件见[桌面开发指南](../ray_agent/desktop/README.md)。

| 机制 | 主要入口 |
|---|---|
| 核心入口：stdin 启动参数、数据根、系统分配端口、stdout 握手、stdin 关闭即停止；开发启动参数 | [sidecar.py](../ray_agent/api/sidecar.py) 的 `main()`、`apply_launch()`、`serve()`、`watch_host()`、`development_launch()`；参数与握手类型见[共享契约](#共享契约) |
| 冻结进程的子进程入口 | `sidecar.py` 的 `WORKER_MODULES`、`run_worker()`；调用方为 [parser.py](../ray_agent/api/app/infrastructure/external/file_preview/parser.py) 的 `parse_preview()` |
| onedir 冻结清单：模块枚举、数据文件与构建身份 | [rayagent-core.spec](../ray_agent/api/rayagent-core.spec) |
| 宿主拉起（正式包为冻结核心，开发构建为源码核心）、数据目录、握手与版本核对、健康检查、重启与进程组回收 | [sidecar.rs](../ray_agent/desktop/src/sidecar.rs) 的 `CoreHost::command()`、`spawn()`、`restart()`、`stop()`、`wait_exit()`；启动参数与握手的宿主类型在 [contract.rs](../ray_agent/desktop/src/contract.rs) |
| 宿主命令、退出确认、窗口隐藏与终止信号 | [lib.rs](../ray_agent/desktop/src/lib.rs) 的 `core_connection`、`restart_core`、`request_quit()`、`quit_ack`、`quit_confirm`、`watch_signals()` |
| 平台能力：模型配置文件、外部链接、保存下载、选择文件夹并登记授权、在文件管理器中显示 | [platform.rs](../ray_agent/desktop/src/platform.rs) 的 `open_model_config`、`open_external`、`save_resource`、`save_bytes`、`select_folder_grant`（选择器标题 `picker_title()`、核心响应解析 `parse_folder_grant()`）、`reveal_in_file_manager`（宿主专用接口调用 `host_post()`、位置解析 `parse_resolved_path()`、根身份核对 `valid_root_id()`；界面入口在 [platform.ts](../ray_agent/ui/src/lib/platform.ts) 的 `revealInFileManager`） |
| 界面侧的核心连接、宿主调用（`selectFolderGrant` 与宿主错误归一为 `Error`）、外部链接与退出 | [core-client.ts](../ray_agent/ui/src/lib/core-client.ts)、[platform.ts](../ray_agent/ui/src/lib/platform.ts)、[external-links.ts](../ray_agent/ui/src/lib/external-links.ts)、[core-gate.tsx](../ray_agent/ui/src/components/core-gate.tsx)、[quit-guard.tsx](../ray_agent/ui/src/components/quit-guard.tsx) |
| 实例令牌与资源票据 | [instance_access.py](../ray_agent/api/app/interfaces/instance_access.py)（令牌与票据路径按 UTF-8 字节比较，非 ASCII 路径照常放行）；票据签发在 [root_routes.py](../ray_agent/api/app/interfaces/endpoints/root_routes.py)、[preview_routes.py](../ray_agent/api/app/interfaces/endpoints/preview_routes.py)；检查 [test_instance_access.py](../ray_agent/api/tests/core/test_instance_access.py) |
| 窗口、开发服务器、CSP 与能力；打包时的界面产物与核心资源 | [tauri.conf.json](../ray_agent/desktop/tauri.conf.json)、[default.json](../ray_agent/desktop/capabilities/default.json)、[tauri.bundle.json](../ray_agent/desktop/tauri.bundle.json) |

## 模型配置与切换

选择时机、冻结边界与主循环、压缩、辅助请求的分工见 [Harness 模型选择与请求分工](harness.md#模型选择与请求分工)。

| 机制 | 代码 | 验证 |
|---|---|---|
| 厂商档位、温度兼容性与采样优先级 | [model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py)、[app_config_service.py](../ray_agent/api/app/application/services/app_config_service.py) | [test_model_configuration.py](../ray_agent/api/tests/core/test_model_configuration.py)、[test_model_catalog.py](../ray_agent/api/tests/core/test_model_catalog.py) |
| 模型连接配置文件读取、模型到提供商映射与 GPT 续接 | [model_connections.py](../ray_agent/api/app/infrastructure/external/llm/model_connections.py)、[llm_endpoints.py](../ray_agent/api/app/domain/models/llm_endpoints.py)、[config.example.toml](../ray_agent/api/config.example.toml)、[model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) | [test_llm_endpoints.py](../ray_agent/api/tests/core/test_llm_endpoints.py)、[test_llm_api_key.py](../ray_agent/api/tests/core/test_llm_api_key.py) |
| 会话切换原子保存、完整请求只读估算 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 set_model / preview_context | 同上配置检查 |
| 会话参数绑定与运行模型恢复 | [agent_service.py](../ray_agent/api/app/application/services/agent_service.py) 的 `_remember_model()`、`_bind_sampling()`、`_llm_for_run()`；[model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) 的 `choose_sampling()`、`model_request()` | [test_model_configuration.py](../ray_agent/api/tests/core/test_model_configuration.py)、[test_llm_endpoints.py](../ray_agent/api/tests/core/test_llm_endpoints.py) |
| 标题与会话摘要的辅助请求选择 | [model_catalog.py](../ray_agent/api/app/domain/models/model_catalog.py) 的 `auxiliary_call()`；调用方 [title_service.py](../ray_agent/api/app/application/services/title_service.py)、[session_summary.py](../ray_agent/api/app/application/services/session_summary.py)（由摘要后台任务调用）；历史压缩另查[上下文与记忆](#上下文与记忆) | [test_title_service.py](../ray_agent/api/tests/core/test_title_service.py)、[test_model_catalog.py](../ray_agent/api/tests/core/test_model_catalog.py) |
| 模型设置草稿、只读连接状态、思考档位选择 | [llm-section.tsx](../ray_agent/ui/src/components/settings/llm-section.tsx)、[model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx)、档位滑块 [level-slider.tsx](../ray_agent/ui/src/components/ui/level-slider.tsx)、厂商标志 [vendor-icon.tsx](../ray_agent/ui/src/components/vendor-icon.tsx)、[model-selection.ts](../ray_agent/ui/src/lib/model-selection.ts) | [check-model-configuration.cjs](../ray_agent/ui/scripts/check-model-configuration.cjs)、[check-effort-slider.cjs](../ray_agent/ui/scripts/check-effort-slider.cjs) |

运行命令、检查条件与覆盖边界维护在所属服务指南。

模型偏好的前端链路：[model-preference.ts](../ray_agent/ui/src/lib/model-preference.ts) 管理同源本地选择，[model-picker.tsx](../ray_agent/ui/src/components/model-picker.tsx) 恢复并在确认后保存，[chat-input.tsx](../ray_agent/ui/src/components/chat-input.tsx) 传递实际发送选择。

## 全局 skill

| 机制 | 主要入口 | 定向检查 |
|---|---|---|
| 包契约、目录与正文资料块 | [skill_packages.py](../ray_agent/api/app/domain/services/skill_packages.py)、[skill_context.py](../ray_agent/api/app/domain/services/skill_context.py) | [test_skills.py](../ray_agent/api/tests/core/test_skills.py) |
| 共享安装、管理与运行绑定 | [skill_service.py](../ray_agent/api/app/application/services/skill_service.py)、[skill_runtime.py](../ray_agent/api/app/application/services/skill_runtime.py)、[skill 工具](../ray_agent/api/app/domain/services/tools/skill.py)、[内置 find-skills](../ray_agent/api/app/builtin_skills/find-skills/SKILL.md) | 同上；[test_skills_sqlite.py](../ray_agent/api/tests/core/test_skills_sqlite.py) |
| GitHub、不可变文件与数据库 | [github.py](../ray_agent/api/app/infrastructure/external/skills/github.py)、[storage.py](../ray_agent/api/app/infrastructure/external/skills/storage.py)、[DBSkillRepository](../ray_agent/api/app/infrastructure/repositories/db_skill_repository.py)、[ORM](../ray_agent/api/app/infrastructure/models/skill.py)、[迁移基线](../ray_agent/api/alembic/versions/0001_baseline.py) | 同上 |
| HTTP 与设置维护 | [skill_routes.py](../ray_agent/api/app/interfaces/endpoints/skill_routes.py)、[skills-section.tsx](../ray_agent/ui/src/components/settings/skills-section.tsx)、[本地文件分类](../ray_agent/ui/src/lib/skill-local.ts)、[统一阅读器](../ray_agent/ui/src/components/skill-reader.tsx)、[客户端](../ray_agent/ui/src/lib/api/skills.ts) | [HTTP 与资源检查](../ray_agent/api/tests/core/test_skill_management_http.py)；浏览器走查；[设置脚本](../ray_agent/ui/scripts/check-skills-settings.cjs)；[输入与受理脚本](../ray_agent/ui/scripts/check-composer-images.cjs) |
