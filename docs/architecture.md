# RayAgent 架构说明

本文描述当前系统的模块边界、执行与数据流，以及理解实现时需要注意的限制。内容依据代码核对，完整运行验证的阶段状态见 [执行计划](../PLAN.md)。

部署步骤见 [运行指南](../ray_agent/README.md)，服务内部导航与开发命令见各服务 README。本文件不维护完整类清单或 API 路由表；边界、状态归属或交互契约变化时更新。

## 系统边界

| 模块 | 职责 |
|---|---|
| [UI](../ray_agent/ui/README.md) | 会话交互、事件消费、计划与工具结果展示、沙箱画面 |
| [API](../ray_agent/api/README.md) | 会话管理、任务执行、模型与外部能力适配 |
| [沙箱](../ray_agent/sandbox/README.md) | 隔离的 Shell、文件、浏览器与进程管理环境 |
| Nginx | UI 与 API 的访问入口，转发 SSE 和 WebSocket |
| PostgreSQL | 会话状态、事件历史、Agent 记忆及文件元数据 |
| Redis | 任务输入输出流与事件传递 |
| COS | 附件、执行文件与截图的对象存储 |

产品通过 MCP 客户端调用外部工具，通过 A2A 客户端调用远程 Agent。两者接入现有工具层，主执行流程由自研 Plan + ReAct 驱动。实验目录还包含服务端示例，其角色不能直接套用于产品。

## API 分层

API 的实现位于 `ray_agent/api/app/`：

| 层 | 职责 |
|---|---|
| `interfaces/` | HTTP 路由、请求响应结构、SSE 映射与依赖组装 |
| `application/` | 会话、文件、配置和任务等应用服务的协调 |
| `domain/` | 领域模型、规划执行、Agent 与工具，以及仓库和外部能力的抽象 |
| `infrastructure/` | 数据库仓库、模型调用、Docker、浏览器、消息队列和存储的具体实现 |

依赖在 [service_dependencies.py](../ray_agent/api/app/interfaces/service_dependencies.py) 中组装。数据访问通过仓库与工作单元组织，外部资源通过抽象接口和具体适配实现连接。目录表达了职责划分，分析具体行为仍需沿调用代码确认。

## 一次任务的执行

```text
UI 发起聊天请求
  → 会话路由与 AgentService
  → 准备沙箱、浏览器和任务
  → AgentTaskRunner 消费输入
  → PlannerReActFlow 规划、执行、更新计划、总结
  → Agent 调用模型与工具

执行事件 → 任务输出流（Redis）→ API 的 SSE 映射 → UI 展示
```

外层流程负责步骤规划与更新，内层 Agent 负责模型与工具之间的多轮调用。工具结果进入模型上下文，供后续推理和执行使用。

核心入口：

- [AgentService](../ray_agent/api/app/application/services/agent_service.py)：任务和执行资源的准备、输入输出协调。
- [AgentTaskRunner](../ray_agent/api/app/domain/services/agent_task_runner.py)：运行流程、处理事件和资源生命周期。
- [PlannerReActFlow](../ray_agent/api/app/domain/services/flows/planner_react.py)：规划与执行的外层状态转换。
- [BaseAgent](../ray_agent/api/app/domain/services/agents/base.py)：模型调用、工具循环与迭代控制。

## 状态与持久化

| 状态或数据 | 所属位置与意义 |
|---|---|
| 会话、事件历史、Agent 记忆 | 领域会话模型与 PostgreSQL 持久化数据 |
| 计划与步骤 | 外层流程使用的执行状态，通过相关事件反映变化 |
| 正在执行的任务 | `RedisStreamTask` 维护的进程内任务实例与注册表 |
| 输入输出消息 | Redis Stream，供任务和 API 交换消息与事件 |
| 页面展示状态 | 前端从实时事件和历史详情派生的状态 |

[RedisStreamTask](../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py) 使用进程内 `asyncio.Task` 执行任务。Redis 中存在消息，或数据库中存在任务 ID，都不等于进程重启后能继续执行。恢复、并发和取消能力必须按对应路径验证。

界面显示完成、流程到达终态、后台任务结束和资源释放是不同环节，排查时应分别确认，不能只依据某一个状态字段。

## 主要交互契约

### 工具与外部能力

工具使用 `BaseTool`、`@tool` 声明和 `ToolResult` 模型。参数 schema、方法签名和下游适配接口需要保持一致；工具实现完成后还需在流程中组装，才能供 Agent 使用。

Shell 和文件工具通过 API 侧适配访问沙箱服务，浏览器操作通过 Playwright 连接沙箱浏览器。修改时需同时考虑调用端与执行端。

MCP/A2A 适配负责外部协议与产品工具结果之间的转换。HTTP 成功不代表协议请求或远程任务完成；应按实际使用范围处理协议错误、消息和任务状态。

### 事件与 UI

领域事件经 API schema 映射为 SSE，后端使用 `event` 标识事件类型；UI 将其归一化为 `type`，再构建时间线与计划展示。历史详情和实时流应解释为一致的业务行为。

事件字段调整涉及领域模型、SSE 映射、前端类型与解析，以及相关展示组件。入口见 [API 开发指南](../ray_agent/api/README.md) 和 [UI 开发指南](../ray_agent/ui/README.md)。

### 数据与文件

领域模型、ORM 模型与接口响应分别承担业务、存储和传输职责。模型字段变化时，需核对转换逻辑与数据库迁移，不能仅调整某一个模型。

文件内容保存在 COS，元数据与会话关系由应用和数据库管理。上传附件、沙箱文件与浏览器截图跨越不同资源，排查时应确认失败发生在哪一步。

## 沙箱生命周期与限制

创建任务时会准备沙箱和浏览器，因此不使用浏览器工具的对话也依赖这条准备链路。

API 支持动态创建沙箱，也支持按地址连接已有沙箱。具体配置、网络条件和生命周期差异统一见 [沙箱连接方式](../ray_agent/sandbox/README.md#与-api-连接)。两种模式不能混用资源归属假设。

本说明记录现有结构与关键限制，不表示这些路径已完成端到端验证，也不替代学习文档中的逐步实验。
