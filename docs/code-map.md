# 代码地图

这份文件回答一个问题：在文档或课程里读到的某个机制，代码在哪。它按机制索引，跨 API、UI、沙箱三个服务，是从扫描层与推导层进入事实层的入口。

想按目录职责浏览某个服务，用该服务 README 的「代码导航」；这份地图不重复那件事。

## 怎么读

路径写法约定：API 侧相对 [`ray_agent/api/app/`](../ray_agent/api/app/)，测试相对 [`ray_agent/api/tests/`](../ray_agent/api/tests/)，UI 侧相对 [`ray_agent/ui/src/`](../ray_agent/ui/src/)，沙箱侧相对 [`ray_agent/sandbox/app/`](../ray_agent/sandbox/app/)，其余给出仓库根起的完整路径。

每项机制给出三样东西：主要入口、覆盖它的回归测试、讲解它的课程章节。回归测试一栏比正文更适合确认某个行为当前是什么样——测试里写死的期望就是当前契约。

## 规划与执行循环

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 外层计划调度、步骤推进 | [`domain/services/flows/planner_react.py`](../ray_agent/api/app/domain/services/flows/planner_react.py) 的 `PlannerReActFlow.invoke()` | [`core/test_planner_react_flow.py`](../ray_agent/api/tests/core/test_planner_react_flow.py) | 07 |
| 计划生成与增量更新 | [`domain/services/agents/planner.py`](../ray_agent/api/app/domain/services/agents/planner.py) | [`core/test_planner_react_flow.py`](../ray_agent/api/tests/core/test_planner_react_flow.py) | 07 |
| 内层 ReAct、单步执行与总结 | [`domain/services/agents/react.py`](../ray_agent/api/app/domain/services/agents/react.py) 的 `execute_step()`、`summarize()` | [`core/test_planner_react_flow.py`](../ray_agent/api/tests/core/test_planner_react_flow.py) | 04、07 |
| 模型循环、迭代上限与重试 | [`domain/services/agents/base.py`](../ray_agent/api/app/domain/services/agents/base.py) 的 `BaseAgent.invoke()`、`_invoke_llm()`、`_invoke_tool()` | — | 02、04 |
| 假完成守卫 | [`domain/services/agents/step_guard.py`](../ray_agent/api/app/domain/services/agents/step_guard.py) 的 `is_fake_step_completion()` | [`core/test_step_guard.py`](../ray_agent/api/tests/core/test_step_guard.py) | 16 |
| 计划与步骤的数据结构 | [`domain/models/plan.py`](../ray_agent/api/app/domain/models/plan.py) | — | 07 |
| 提示词 | [`domain/services/prompts/`](../ray_agent/api/app/domain/services/prompts/) 的 `system.py`、`planner.py`、`react.py` | — | 02、07 |

## 上下文与记忆

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 消息序列组装、按角色写入 | [`domain/models/memory.py`](../ray_agent/api/app/domain/models/memory.py) | — | 05 |
| 步骤边界的定点裁剪 | [`domain/models/memory.py`](../ray_agent/api/app/domain/models/memory.py) 的 `Memory.compact()` | — | 05 |
| 模型调用与响应解析 | [`infrastructure/external/llm/openai_llm.py`](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) | [`core/test_llm_api_key.py`](../ray_agent/api/tests/core/test_llm_api_key.py) | 02 |
| 内嵌工具调用的兼容解析 | [`domain/services/agents/tool_call_compat.py`](../ray_agent/api/app/domain/services/agents/tool_call_compat.py) | [`core/test_tool_call_compat.py`](../ray_agent/api/tests/core/test_tool_call_compat.py) | 03 |
| token 用量记账 | [`domain/models/token_usage.py`](../ray_agent/api/app/domain/models/token_usage.py)、[`infrastructure/external/llm/usage.py`](../ray_agent/api/app/infrastructure/external/llm/usage.py) | [`core/test_llm_usage.py`](../ray_agent/api/tests/core/test_llm_usage.py) | 10 |

## 工具与动作

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 工具声明装饰器与基类 | [`domain/services/tools/tool.py`](../ray_agent/api/app/domain/services/tools/tool.py)、[`domain/services/tools/base.py`](../ray_agent/api/app/domain/services/tools/base.py) | — | 03 |
| 文件、Shell、浏览器、检索工具 | [`domain/services/tools/`](../ray_agent/api/app/domain/services/tools/) 的 `file.py`、`shell.py`、`browser.py`、`search.py` | — | 03、11、12、13 |
| 用户交互工具（通知与提问） | [`domain/services/tools/message.py`](../ray_agent/api/app/domain/services/tools/message.py) | — | 08 |
| 工具结果结构 | [`domain/models/tool_result.py`](../ray_agent/api/app/domain/models/tool_result.py) | — | 03 |

## 事件、观测与投影

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 领域事件模型 | [`domain/models/event.py`](../ray_agent/api/app/domain/models/event.py) | [`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py) | 10 |
| 发布顺序：先输出流、后数据库 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_put_and_add_event()` | [`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py) | 09、10 |
| 工具事件加工与预览填充 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_handle_tool_event()` | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 10、12 |
| SSE 投影与字段省略 | [`interfaces/schemas/event.py`](../ray_agent/api/app/interfaces/schemas/event.py) | [`core/test_event_observability.py`](../ray_agent/api/tests/core/test_event_observability.py) | 10 |
| SSE 与历史接口 | [`interfaces/endpoints/session_routes.py`](../ray_agent/api/app/interfaces/endpoints/session_routes.py) | — | 10 |

## 状态与持久化

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 会话聚合与计划快照读取 | [`domain/models/session.py`](../ray_agent/api/app/domain/models/session.py) 的 `get_latest_plan()` | [`core/test_state_persistence.py`](../ray_agent/api/tests/core/test_state_persistence.py) | 09 |
| 仓库接口与工作单元 | [`domain/repositories/`](../ray_agent/api/app/domain/repositories/) 的 `session_repository.py`、`uow.py` | [`core/test_db_uow.py`](../ray_agent/api/tests/core/test_db_uow.py) | 09 |
| 数据库实现 | [`infrastructure/repositories/`](../ray_agent/api/app/infrastructure/repositories/) 的 `db_session_repository.py`、`db_uow.py` | [`core/test_state_persistence.py`](../ray_agent/api/tests/core/test_state_persistence.py)、[`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 09 |
| 输入输出流 | [`infrastructure/external/message_queue/redis_stream_message_queue.py`](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py) | — | 08、09 |

## 任务控制与生命周期

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 任务准备、启动、停止 | [`application/services/agent_service.py`](../ray_agent/api/app/application/services/agent_service.py) 的 `stop_session()` | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 08 |
| 运行器主循环与终态写入 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `invoke()`、`_persist_terminal_state()` | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py)、[`core/test_task_error.py`](../ray_agent/api/tests/core/test_task_error.py) | 08 |
| 取消路径与收尾边界 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `CancelledError` 分支 | [`core/test_agent_task_runner_cancel.py`](../ray_agent/api/tests/core/test_agent_task_runner_cancel.py) | 08 |
| 进程内任务注册表 | [`infrastructure/external/task/redis_stream_task.py`](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py) | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 09 |
| 等待用户与续接 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `WaitEvent` 分支 | [`core/test_task_execution_control.py`](../ray_agent/api/tests/core/test_task_execution_control.py) | 08 |
| 预算与超时配置 | [`domain/models/app_config.py`](../ray_agent/api/app/domain/models/app_config.py)、[`core/config.py`](../ray_agent/api/core/config.py) | — | 08 |

## 执行环境

| 机制 | 主要入口 | 回归测试 | 课程 |
|---|---|---|---|
| 沙箱创建、连接与销毁 | [`infrastructure/external/sandbox/docker_sandbox.py`](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py) | [`core/test_docker_sandbox_ip.py`](../ray_agent/api/tests/core/test_docker_sandbox_ip.py) | 11 |
| 浏览器连接（CDP） | [`infrastructure/external/browser/playwright_browser.py`](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py) | — | 13 |
| 沙箱画面转发（VNC WebSocket） | [`interfaces/endpoints/session_routes.py`](../ray_agent/api/app/interfaces/endpoints/session_routes.py) 的 `vnc_websocket()` | — | 11 |
| 沙箱侧文件与 Shell 服务 | [`services/file.py`](../ray_agent/sandbox/app/services/file.py)、[`services/shell.py`](../ray_agent/sandbox/app/services/shell.py)（沙箱） | — | 11 |
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
| 产物同步为附件 | [`domain/services/agent_task_runner.py`](../ray_agent/api/app/domain/services/agent_task_runner.py) 的 `_sync_file_to_storage()` | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 12 |
| 文件元数据与仓库 | [`domain/models/file.py`](../ray_agent/api/app/domain/models/file.py)、[`infrastructure/repositories/db_file_repository.py`](../ray_agent/api/app/infrastructure/repositories/db_file_repository.py) | [`core/test_file_artifacts.py`](../ray_agent/api/tests/core/test_file_artifacts.py) | 12 |
| 存储适配 | [`infrastructure/external/file_storage/`](../ray_agent/api/app/infrastructure/external/file_storage/) 的 `local_file_storage.py`、`cos_file_storage.py` | [`core/test_file_storage_settings.py`](../ray_agent/api/tests/core/test_file_storage_settings.py) | 12 |

## 前端

| 机制 | 主要入口 | 课程 |
|---|---|---|
| 事件流消费与时间线构建 | [`lib/session-events.ts`](../ray_agent/ui/src/lib/session-events.ts)、[`hooks/use-session-detail.ts`](../ray_agent/ui/src/hooks/use-session-detail.ts) | 10 |
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

基线：上述当前实现映射为 2026-09-16 核对。路径变动时更新本文件，不在其他文档正文里重复代码位置。机制为什么这样设计见 [Harness 工程](harness.md)，完整推导见对应的[课程章节](../lessons/README.md)。

## 第四阶段改造入口

2026-09-20 修订，基线 `2c323cc`。下表是[执行计划](research/phase-4-plan.md)的修改入口，**不是已完成的新架构**。工作包实施时以最终路径更新当前映射，拟新增对象不预建空文件。

| 工作包 | 现有修改入口 | 拟新增职责与关联检查 |
|---|---|---|
| P1 新数据契约 | [session 模型](../ray_agent/api/app/domain/models/session.py)、[ORM](../ray_agent/api/app/infrastructure/models/session.py)、[会话仓库](../ray_agent/api/app/infrastructure/repositories/db_session_repository.py)、[UoW](../ray_agent/api/app/infrastructure/repositories/db_uow.py)、[迁移目录](../ray_agent/api/alembic/versions/)、[应用协调](../ray_agent/api/app/application/services/agent_service.py) | 拟新增版本化 Run/Call/顺序记录与仓库契约；快照等定义接口，行为在对应包验收；新库显式初始化，启动检查 schema；不做旧数据转换 |
| P2a 后端单循环 | [Flow](../ray_agent/api/app/domain/services/flows/planner_react.py)、[Agent 基类](../ray_agent/api/app/domain/services/agents/base.py)、[执行器](../ray_agent/api/app/domain/services/agents/react.py)、[提示词目录](../ray_agent/api/app/domain/services/prompts/)、[工具目录](../ray_agent/api/app/domain/services/tools/)、[装配](../ray_agent/api/app/interfaces/service_dependencies.py) | 拟新增单循环运行、计划/提问/交付工具及完整调用集合；替换旧流程测试的调度预期，保留工具反馈/错误不变量 |
| P2a/P3a 运行控制 | [Runner](../ray_agent/api/app/domain/services/agent_task_runner.py)、[任务适配](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)、[会话路由](../ray_agent/api/app/interfaces/endpoints/session_routes.py)、[配置](../ray_agent/api/app/domain/models/app_config.py) | 拟新增持久等待/审批、运行预算、调用策略/取消状态；同步任务控制、取消、错误测试 |
| P3a 最小执行控制 | [沙箱适配](../ray_agent/api/app/infrastructure/external/sandbox/docker_sandbox.py)、[Shell 服务](../ray_agent/sandbox/app/services/shell.py)、[沙箱路由](../ray_agent/sandbox/app/interfaces/endpoints/)、[沙箱配置](../ray_agent/sandbox/app/core/config.py)、[Dockerfile](../ray_agent/sandbox/Dockerfile)、[浏览器](../ray_agent/api/app/infrastructure/external/browser/playwright_browser.py)、[协议适配](../ray_agent/api/app/infrastructure/protocols/) | 按 Run/Call 登记进程/句柄、TERM/KILL 与远端取消、固定策略；仅支持动态受管理容器，更新 API/沙箱 scripts 与协议夹具 |
| P4 上下文 | [Memory](../ray_agent/api/app/domain/models/memory.py)、[模型抽象](../ray_agent/api/app/domain/external/llm.py)、[用量模型](../ray_agent/api/app/domain/models/token_usage.py)、[usage 解析](../ray_agent/api/app/infrastructure/external/llm/usage.py)、[文件存储](../ray_agent/api/app/infrastructure/external/file_storage/) | 拟新增 Context 构建器、窗口/运行预算与摘要服务、协议截断前文本/JSON 外存引用；新增配对、失真、预算与缺失引用测试 |
| P2b 事件与界面、P5 模型增量 | [模型实现](../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)、[事件模型](../ray_agent/api/app/domain/models/event.py)、[事件映射](../ray_agent/api/app/interfaces/schemas/event.py)、[Redis Stream](../ray_agent/api/app/infrastructure/external/message_queue/redis_stream_message_queue.py)、[Nginx](../ray_agent/nginx/conf.d/default.conf) | P2a 定义持久事实；P2b 接通游标、SSE/历史与 UI；P5 沿用身份扩展 delta/attempt 与分片/中断测试 |
| P2b–P6 前端 | [接口和类型](../ray_agent/ui/src/lib/api/)、[事件投影](../ray_agent/ui/src/lib/session-events.ts)、[订阅 hook](../ray_agent/ui/src/hooks/use-session-detail.ts)、[计划面板](../ray_agent/ui/src/components/plan-panel.tsx)、[消息](../ray_agent/ui/src/components/chat-message.tsx)、[附件](../ray_agent/ui/src/components/attachments-message.tsx)、[用量](../ray_agent/ui/src/components/token-usage.tsx) | 拟新增运行/审批/验证展示；更新事件观察脚本并增加相应交互验证 |
| P6 成果与人工处置 | [应用启动](../ray_agent/api/app/main.py)、[Runner](../ray_agent/api/app/domain/services/agent_task_runner.py)、[文件仓库](../ray_agent/api/app/infrastructure/repositories/db_file_repository.py)、[文件测试](../ray_agent/api/tests/core/test_file_artifacts.py)、[文件事务检查](../ray_agent/api/scripts/check_file_artifacts.py) | P2a 接入启动协调与交付；P6 完成人工核对/续接、具体副本检查与独占会话目录基本清理；不做自动对账或共享引用平台 |

服务指南、对应 `tests/core` / `tests/protocols`、UI 与沙箱 scripts 的运行条件见各服务 README；执行计划不重复维护命令。
