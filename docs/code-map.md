# 代码地图

这份文件回答一个问题：在文档或课程里读到的某个机制，代码在哪。它按机制索引，跨 API、UI、沙箱三个服务，是从扫描层与推导层进入事实层的入口。

想按目录职责浏览某个服务，用该服务 README 的「代码导航」；这份地图不重复那件事。

## 怎么读

路径写法约定：API 侧相对 [`ray_agent/api/app/`](../ray_agent/api/app/)，测试相对 [`ray_agent/api/tests/`](../ray_agent/api/tests/)，UI 侧相对 [`ray_agent/ui/src/`](../ray_agent/ui/src/)，沙箱侧相对 [`ray_agent/sandbox/app/`](../ray_agent/sandbox/app/)，其余给出仓库根起的完整路径。

每项机制给出三样东西：主要入口、覆盖它的回归测试、讲解它的课程章节。回归测试一栏比正文更适合确认某个行为当前是什么样——测试里写死的期望就是当前契约。

## Agent 循环与工具管线

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 单循环：补充消息、模型请求、多调用执行、最终答复 | [`domain/services/flows/agent_loop.py`](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `AgentLoop.invoke()` | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py) | 04、07 |
| 模型重试、输出截断与请求上限 | [`domain/services/flows/agent_loop.py`](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_request_model()` | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py)、[`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py) | 02、04 |
| 工具三段管线：解析校验、执行一次、耗时 | [`domain/services/flows/tool_pipeline.py`](../ray_agent/api/app/domain/services/flows/tool_pipeline.py) 的 `ToolPipeline.run()`、`add_before()`、`add_after()` | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py) | 03 |
| 悬空调用补结果与续接 | [`domain/services/flows/agent_loop.py`](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `repair_dangling_calls()` | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py)、[`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 08、09 |
| 计划清单工具 | [`domain/services/tools/plan.py`](../ray_agent/api/app/domain/services/tools/plan.py) 的 `PlanTool`，数据结构见 [`domain/models/plan.py`](../ray_agent/api/app/domain/models/plan.py) | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py)、[`core/test_state_persistence.py`](../ray_agent/api/tests/core/test_state_persistence.py) | 07 |
| 提示词 | [`domain/services/prompts/system.py`](../ray_agent/api/app/domain/services/prompts/system.py)（英文版在 `prompts/en/`） | — | 02 |
| 脚本化模型与循环测试夹具 | [`tests/support/scripted_llm.py`](../ray_agent/api/tests/support/scripted_llm.py)、[`tests/support/loop_harness.py`](../ray_agent/api/tests/support/loop_harness.py)（相对 `ray_agent/api/`） | [`core/test_scripted_llm.py`](../ray_agent/api/tests/core/test_scripted_llm.py) | — |

## 上下文与记忆

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 消息序列组装、按轮切分与整体替换 | [`domain/models/memory.py`](../ray_agent/api/app/domain/models/memory.py) 的 `rounds()`、`replace()`；新用户消息时删除推理字段为 `strip_reasoning()` | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py)、[`core/test_context_governance.py`](../ray_agent/api/tests/core/test_context_governance.py) | 05 |
| 请求前容量估算：四部分构成、usage 校准、可用上限与水位 | [`domain/services/context/budget.py`](../ray_agent/api/app/domain/services/context/budget.py) 的 `ContextBudget`、`ContextEstimate`；由 [`agent_loop.py`](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_ensure_capacity()` 在每轮 `turn(started)` 前调用 | [`core/test_context_governance.py`](../ray_agent/api/tests/core/test_context_governance.py) | 05 |
| 自动压缩：范围选择、用户原文重新注入、摘要请求 | [`domain/services/context/compaction.py`](../ray_agent/api/app/domain/services/context/compaction.py)；流程在 [`agent_loop.py`](../ray_agent/api/app/domain/services/flows/agent_loop.py) 的 `_compact_history()`、`_request_summary()`；提示词 [`prompts/compact.py`](../ray_agent/api/app/domain/services/prompts/compact.py)（英文版在 `prompts/en/`） | [`core/test_context_governance.py`](../ray_agent/api/tests/core/test_context_governance.py)、[`core/test_turn_events_rebuild.py`](../ray_agent/api/tests/core/test_turn_events_rebuild.py) | 05 |
| 工具结果整形与落盘 | [`domain/services/context/shaping.py`](../ray_agent/api/app/domain/services/context/shaping.py) 的 `ResultShaper`（工具管线执行后段最后一个处理函数），写文件经 [`agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_write_output()`；协议截断前的完整内容见 [`infrastructure/protocols/common.py`](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `keep_full_content()` | [`core/test_context_governance.py`](../ray_agent/api/tests/core/test_context_governance.py)、[`protocols/test_result_shaping.py`](../ray_agent/api/tests/protocols/test_result_shaping.py) | 05、14 |
| 沙箱 Shell 输出上限 | [`services/shell.py`](../ray_agent/sandbox/app/services/shell.py)（沙箱）的 `append_output()` | — | 11 |
| Shell 初次返回与进程组终止 | [`services/shell.py`](../ray_agent/sandbox/app/services/shell.py)（沙箱）的 `exec_command()`、`_terminate_process_group()`；API 侧等待上限在 [`docker_sandbox.py`](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) 的 `bound_shell_wait_seconds()` | [`tests/test_shell_service.py`](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱） | 08、11 |
| 模型调用、`finish_reason`、可重试错误与上下文超长拒绝 | [`infrastructure/external/llm/openai_llm.py`](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[`domain/external/llm.py`](../ray_agent/api/app/domain/external/llm.py) 的 `LLMRequestError` | [`core/test_llm_api_key.py`](../ray_agent/api/tests/core/test_llm_api_key.py)、[`core/test_context_governance.py`](../ray_agent/api/tests/core/test_context_governance.py) | 02 |
| 内嵌工具调用的兼容解析 | [`domain/services/agents/tool_call_compat.py`](../ray_agent/api/app/domain/services/agents/tool_call_compat.py) | [`core/test_tool_call_compat.py`](../ray_agent/api/tests/core/test_tool_call_compat.py) | 03 |
| token 用量记账 | [`domain/models/llm.py`](../ray_agent/api/app/domain/models/llm.py)、[`infrastructure/external/llm/usage.py`](../ray_agent/api/app/infrastructure/external/llm/usage.py) | [`core/test_llm_usage.py`](../ray_agent/api/tests/core/test_llm_usage.py) | 10 |

## 工具与动作

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 工具声明装饰器与基类 | [`domain/services/tools/tool.py`](../ray_agent/api/app/domain/services/tools/tool.py)、[`domain/services/tools/base.py`](../ray_agent/api/app/domain/services/tools/base.py) | — | 03 |
| 文件、Shell、浏览器、检索工具 | [`domain/services/tools/`](../ray_agent/api/app/domain/services/tools/) 的 `file.py`、`shell.py`、`browser.py`、`search.py`。Shell 等待秒数经沙箱适配截断到 HTTP 超时以内 | [`tests/test_shell_service.py`](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱，覆盖执行返回与进程组） | 03、08、11、12、13 |
| 用户提问工具 | [`domain/services/tools/message.py`](../ray_agent/api/app/domain/services/tools/message.py)（调用由 `AgentLoop` 拦截为等待） | [`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py) | 08 |
| 工具结果结构 | [`domain/models/tool_result.py`](../ray_agent/api/app/domain/models/tool_result.py) | — | 03 |

## 事件、观测与投影

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 领域事件模型 | [`domain/models/event.py`](../ray_agent/api/app/domain/models/event.py) | [`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py)、[`core/test_turn_events_rebuild.py`](../ray_agent/api/tests/core/test_turn_events_rebuild.py) | 10 |
| 写入顺序：先数据库事务、后通知 | [`domain/services/run_ledger.py`](../ray_agent/api/app/domain/services/run_ledger.py) | [`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py) | 09、10 |
| 请求重建 | [`domain/services/request_rebuild.py`](../ray_agent/api/app/domain/services/request_rebuild.py) | [`core/test_turn_events_rebuild.py`](../ray_agent/api/tests/core/test_turn_events_rebuild.py) | 09、10 |
| 工具事件加工与预览填充 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event()` | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 10、12 |
| SSE 投影与字段省略 | [`interfaces/schemas/event.py`](../ray_agent/api/app/interfaces/schemas/event.py) | [`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py) | 10 |
| SSE、会话详情与请求读取 | [`interfaces/endpoints/session_routes.py`](../ray_agent/api/app/interfaces/endpoints/session_routes.py) | [`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py) | 10 |

## 状态与持久化

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 会话状态与计划快照 | [`domain/models/session.py`](../ray_agent/api/app/domain/models/session.py)；计划读取为 [`domain/models/event.py`](../ray_agent/api/app/domain/models/event.py) 的 `latest_plan()` | [`core/test_state_persistence.py`](../ray_agent/api/tests/core/test_state_persistence.py) | 09 |
| 运行与事件仓库 | [`domain/repositories/run_repository.py`](../ray_agent/api/app/domain/repositories/run_repository.py)、[`domain/repositories/event_repository.py`](../ray_agent/api/app/domain/repositories/event_repository.py)；实现为 [`db_run_repository.py`](../ray_agent/api/app/infrastructure/repositories/db_run_repository.py)、[`db_event_repository.py`](../ray_agent/api/app/infrastructure/repositories/db_event_repository.py) | [`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py) | 09 |
| 仓库接口与工作单元 | [`domain/repositories/uow.py`](../ray_agent/api/app/domain/repositories/uow.py)、[`db_uow.py`](../ray_agent/api/app/infrastructure/repositories/db_uow.py) | [`core/test_db_uow.py`](../ray_agent/api/tests/core/test_db_uow.py) | 09 |
| 输入流与事件通知 | 输入流 [`redis_stream_message_queue.py`](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py)；通知 [`redis_event_notifier.py`](../ray_agent/api/app/infrastructure/external/message_queue/redis_event_notifier.py) | [`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py)（通知用内存替身） | 08、09 |

## 任务控制与生命周期

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 消息受理、事件流与停止 | [`application/services/agent_service.py`](../ray_agent/api/app/application/services/agent_service.py) 的 `chat()`、`stream_events()`、`stop_session()` | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py)、[`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py) | 08 |
| 运行器主循环与终态写入 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()`、`_finish()` | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py)、[`core/test_task_error.py`](../ray_agent/api/tests/core/test_task_error.py) | 08 |
| 停止后的进程收尾 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `stop_processes()` | [`core/test_agent_task_runner_cancel.py`](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) | 08 |
| 启动扫描 | [`domain/services/run_ledger.py`](../ray_agent/api/app/domain/services/run_ledger.py) 的 `interrupt_running()`，由 [`main.py`](../ray_agent/api/app/main.py) 在开始接收请求前调用 | [`core/test_run_events_pg.py`](../ray_agent/api/tests/core/test_run_events_pg.py)、[`core/test_agent_task_runner_cancel.py`](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) | 08 |
| 进程内任务注册表与会话锁 | [`infrastructure/external/task/redis_stream_task.py`](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)、[`domain/services/session_locks.py`](../ray_agent/api/app/domain/services/session_locks.py) | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 09 |
| 等待用户与续接 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `WaitEvent` 分支 | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 08 |
| 运行中补充消息 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_drain_injected_messages()` | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 08 |
| 预算与超时配置 | [`domain/models/app_config.py`](../ray_agent/api/app/domain/models/app_config.py)、[`core/config.py`](../ray_agent/api/core/config.py) | — | 08 |

## 执行环境

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 沙箱创建、连接与销毁 | [`infrastructure/external/sandbox/docker_sandbox.py`](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)。动态创建时设置内存、CPU、进程数上限，并把 `SANDBOX_TTL_MINUTES` 注入为 `SERVER_TIMEOUT_MINUTES`；限额默认值在 [`core/config.py`](../ray_agent/api/core/config.py) | [`core/test_docker_sandbox_ip.py`](../ray_agent/api/tests/core/test_docker_sandbox_ip.py) | 11 |
| 浏览器连接（CDP） | [`infrastructure/external/browser/playwright_browser.py`](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) | — | 13 |
| 沙箱画面转发（VNC WebSocket） | [`interfaces/endpoints/session_routes.py`](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `vnc_websocket()` | — | 11 |
| 沙箱侧文件与 Shell 服务 | [`services/file.py`](../ray_agent/sandbox/app/services/file.py)、[`services/shell.py`](../ray_agent/sandbox/app/services/shell.py)（沙箱）。服务进程以 ubuntu 运行，配置在 [`supervisord.conf`](../ray_agent/sandbox/supervisord.conf) | [`tests/test_shell_service.py`](../ray_agent/sandbox/tests/test_shell_service.py)（沙箱） | 11 |
| 沙箱侧存活时间与销毁 | [`services/supervisor.py`](../ray_agent/sandbox/app/services/supervisor.py)（沙箱） | — | 11 |

## 外部协议

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| MCP 发现、别名路由、调用 | [`infrastructure/protocols/mcp.py`](../ray_agent/api/app/infrastructure/protocols/mcp.py) 的 `tool_name()` | — | 14 |
| A2A 卡片读取、委派、轮询、取消 | [`infrastructure/protocols/a2a.py`](../ray_agent/api/app/infrastructure/protocols/a2a.py) | — | 15 |
| 结果截断与错误归一 | [`infrastructure/protocols/common.py`](../ray_agent/api/app/infrastructure/protocols/common.py) 的 `describe_content()` | — | 14、15 |
| 协议工具与网关 | [`domain/services/tools/`](../ray_agent/api/app/domain/services/tools/) 的 `mcp.py`、`a2a.py`、`protocol_gateway.py` | — | 14、15 |
| 可运行实验 | [`labs/a2a/`](../labs/a2a/)（仓库根） | — | 15 |

## 文件与交付

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 上传同步进沙箱 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_sync_file_to_sandbox()` | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 12 |
| 文件交付为附件 | [`domain/services/tools/deliver.py`](../ray_agent/api/app/domain/services/tools/deliver.py) 的 `DeliverTool`，交付函数为 [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_deliver_file()` | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py)、[`core/test_agent_loop.py`](../ray_agent/api/tests/core/test_agent_loop.py) | 12 |
| 文件元数据与仓库 | [`domain/models/file.py`](../ray_agent/api/app/domain/models/file.py)、[`infrastructure/repositories/db_file_repository.py`](../ray_agent/api/app/infrastructure/repositories/db_file_repository.py) | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 12 |
| 存储适配 | [`infrastructure/external/file_storage/`](../ray_agent/api/app/infrastructure/external/file_storage/) 的 `local_file_storage.py`、`cos_file_storage.py` | [`core/test_file_storage_settings.py`](../ray_agent/api/tests/core/test_file_storage_settings.py) | 12 |

## 前端

| 机制 | 主要入口 | 课程 |
|---|---|---|
| 事件订阅与视图投影 | [`lib/session-projection.ts`](../ray_agent/ui/src/lib/session-projection.ts) 的 `projectSession`、[`lib/session-view.ts`](../ray_agent/ui/src/lib/session-view.ts)、[`hooks/use-session-detail.ts`](../ray_agent/ui/src/hooks/use-session-detail.ts)。当前会话页仍用 [`lib/session-events.ts`](../ray_agent/ui/src/lib/session-events.ts) 的旧时间线，到 W5 阶段二为止 | 10 |
| 接口请求 | [`lib/api/`](../ray_agent/ui/src/lib/api/) 的 `session.ts`、`file.ts`、`fetch.ts` | 10 |
| 计划与工具展示 | [`components/plan-panel.tsx`](../ray_agent/ui/src/components/plan-panel.tsx)、[`components/tool-use/`](../ray_agent/ui/src/components/tool-use/) | 07、10 |
| 文件预览与附件 | [`components/file-preview-panel.tsx`](../ray_agent/ui/src/components/file-preview-panel.tsx)、[`components/attachments-message.tsx`](../ray_agent/ui/src/components/attachments-message.tsx) | 12 |
| 沙箱画面 | [`components/vnc-overlay.tsx`](../ray_agent/ui/src/components/vnc-overlay.tsx)、[`components/vnc-viewer.tsx`](../ray_agent/ui/src/components/vnc-viewer.tsx) | 11 |

## 装配与配置

| 机制 | 主要入口 |
|---|---|
| 依赖组装 | [`interfaces/service_dependencies.py`](../ray_agent/api/app/interfaces/service_dependencies.py) |
| 应用启动与关闭 | [`main.py`](../ray_agent/api/app/main.py) |
| 运行时配置 | [`core/config.py`](../ray_agent/api/core/config.py) |
| 模型、协议与预算配置 | [`domain/models/app_config.py`](../ray_agent/api/app/domain/models/app_config.py)、[`application/services/app_config_service.py`](../ray_agent/api/app/application/services/app_config_service.py) |
| 反向代理与路由 | [`ray_agent/nginx/conf.d/default.conf`](../ray_agent/nginx/conf.d/default.conf)（仓库根） |

---

基线：上述当前实现映射为 2026-09-16 核对；Agent 循环与工具管线、上下文与记忆、工具及文件交付中的相关行于 2026-09-28 按 W1 实现更新；事件、状态与持久化、任务控制分组同日按 W3 实现更新；上下文与记忆分组同日按 W2 实现更新；前端事件订阅与视图投影同日按 W4 实现更新；执行环境与 Shell 进程组同日按 W7.1、W7.3 实现更新。路径变动时更新本文件，不在其他文档正文里重复代码位置。机制为什么这样设计见 [Harness 工程](harness.md)，完整推导见对应的[课程章节](../lessons/README.md)。

## 二次开发改造入口

2026-09-28 编制，基线 `2c323cc`。下表是[二次开发总计划](plan/README.md)各工作包的现有修改入口，**不是已完成的新架构**；设计与验收见各子计划。工作包完成后，用最终路径更新上文对应分组，并删除本表中该包的行；拟新增对象不预建空文件。

| 工作包 | 现有修改入口 |
|---|---|
| [W0 基线与评测](plan/w0-baseline-eval.md) | [模型抽象](../ray_agent/api/app/domain/external/llm.py)、[测试目录](../ray_agent/api/tests/)、[API 脚本目录](../ray_agent/api/scripts/)、[验证实验](../labs/verification/README.md) |
| [W5 界面与交互](plan/w5-ux.md) | 阶段一、三：[设计说明](../ray_agent/ui/DESIGN.md)、[全局样式](../ray_agent/ui/src/app/globals.css)、[运行视图](../ray_agent/ui/src/components/run/)、[组件状态目录](../ray_agent/ui/src/app/dev/components/page.tsx)、[夹具](../ray_agent/ui/src/fixtures/)、[设置页](../ray_agent/ui/src/components/settings/)。阶段二前会话页仍用 [会话视图](../ray_agent/ui/src/components/session-detail-view.tsx)、[计划面板](../ray_agent/ui/src/components/plan-panel.tsx)、[工具组件](../ray_agent/ui/src/components/tool-use/) |
| [W6 流式与运行指标](plan/w6-streaming.md) | [模型实现](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[usage 解析](../ray_agent/api/app/infrastructure/external/llm/usage.py)、[事件映射](../ray_agent/api/app/interfaces/schemas/event.py)、[Nginx](../ray_agent/nginx/conf.d/default.conf) |
| [W7 控制与安全](plan/w7-control-safety.md) | W7.1、W7.3 已落到上文执行环境。W7.2 审批仍未做：工具管线执行前段、应用配置中的工具策略、审批回复接口与设置页分区 |

服务指南、对应 `tests/core` / `tests/protocols`、UI 与沙箱 scripts 的运行条件见各服务 README；计划不重复维护命令。
