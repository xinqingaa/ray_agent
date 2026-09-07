# RayAgent 项目上下文与工作指南

## 项目目标与工作角色

RayAgent 是以自研 Plan + ReAct 为核心、通过工具和沙箱完成任务的全栈 Agent 应用。当前以系统学习为主，具体阶段、推进顺序和验收标准读取 [PLAN.md](PLAN.md)。

在本项目中，AI 需要协助阅读代码、解释设计、排查运行问题和编写教学文档。回答实现问题时，应定位具体调用链，并区分代码事实、设计意图的推断和改进建议。学习实验围绕已有行为展开，新增产品功能不作为学习的默认要求。

项目介绍见 [README.md](README.md)，部署步骤见 [运行指南](ray_agent/README.md)。本文件提供理解和处理代码所需的上下文，不重复记录阶段进度。

## 架构与职责

| 部分 | 技术与职责 |
|---|---|
| `ray_agent/ui/` | Next.js、React、TypeScript；会话交互、计划与工具结果展示、沙箱画面 |
| `ray_agent/api/` | FastAPI、Pydantic、SQLAlchemy；会话管理、Agent 执行与外部能力适配 |
| `ray_agent/sandbox/` | 独立 FastAPI 服务与容器环境；Shell、文件、浏览器及进程管理 |
| `ray_agent/nginx/` | UI 与 API 网关，转发 SSE 和 WebSocket |
| PostgreSQL | 会话和文件元数据等持久化数据 |
| Redis | 任务输入输出流与事件传递 |
| COS | 附件、执行文件与浏览器截图的对象存储 |

API 的主要分层位于 `ray_agent/api/app/`：

- `interfaces/`：HTTP 路由、请求响应结构、SSE 映射及依赖组装。
- `application/`：会话、文件、配置、任务等应用服务的协调。
- `domain/`：领域模型、规划执行流程、Agent 与工具，以及仓库和外部能力的抽象接口。
- `infrastructure/`：数据库仓库、模型调用、Docker、浏览器、消息队列、对象存储等具体实现。

处理代码时沿现有边界定位职责：路由适配请求，应用服务协调用例，领域服务处理执行逻辑，基础设施实现外部访问。依赖组装入口为 [service_dependencies.py](ray_agent/api/app/interfaces/service_dependencies.py)。不要仅凭目录分层就假设每处实现都完全符合架构意图。

## 核心执行链路

```text
UI 发起会话请求
  → session_routes
  → AgentService：准备任务、沙箱和浏览器
  → AgentTaskRunner：消费输入、运行流程、处理并输出事件
  → PlannerReActFlow：规划 → 执行 → 更新计划 → 总结
  → BaseAgent：模型 → tool_calls → 工具结果 → 再次调用模型

任务输出 → Redis Stream → API 的 SSE 映射 → UI 事件解析与展示
```

理解和修改这条链路时，注意以下区别：

- 外层规划流程和内层模型工具循环承担不同职责。修改规划策略先看 `PlannerReActFlow`；修改工具循环、模型重试或迭代上限先看 `BaseAgent`。
- MCP 和 A2A 当前接入产品的工具层，产品作为客户端使用外部服务。`labs/` 中也有服务端示例，不能把两者的运行角色混为一谈。
- `RedisStreamTask` 通过进程内 `asyncio.Task` 执行任务，并维护进程内注册表。Redis 保存输入输出流不等于执行状态可以跨进程恢复；重启、并发和取消行为需要沿实现核实。
- 会话、计划、任务实例和前端显示各有状态。排查“任务结束”“等待输入”“恢复执行”时，分别检查这些状态的来源和转换。
- 即使用户消息不使用浏览器工具，创建任务时也会准备沙箱和浏览器。附件与浏览器截图还涉及 COS，不能把文本对话路径当作完全独立的轻量运行模式。

## 按任务查找代码

下表 API 路径相对于 `ray_agent/api/app/`，UI 路径相对于 `ray_agent/ui/src/`。

| 要理解或处理的问题 | 优先入口 |
|---|---|
| 会话请求、聊天流和 SSE 输出 | API：`interfaces/endpoints/session_routes.py`、`application/services/agent_service.py` |
| 任务输入、事件处理与资源释放 | API：`domain/services/agent_task_runner.py`、`infrastructure/external/task/redis_stream_task.py` |
| 规划、执行步骤与计划更新 | API：`domain/services/flows/planner_react.py`、`domain/services/agents/planner.py`、`domain/services/agents/react.py` |
| 模型调用、工具循环与提示词 | API：`domain/services/agents/base.py`、`infrastructure/external/llm/openai_llm.py`、`domain/services/prompts/` |
| 工具声明与协议接入 | API：`domain/services/tools/base.py`、`domain/services/tools/mcp.py`、`domain/services/tools/a2a.py` |
| 沙箱创建与浏览器连接 | API：`infrastructure/external/sandbox/docker_sandbox.py`、`infrastructure/external/browser/playwright_browser.py` |
| 会话与文件持久化 | API：`domain/repositories/`、`infrastructure/repositories/`、`infrastructure/models/` |
| 前端请求、事件类型与时间线 | UI：`lib/api/session.ts`、`lib/api/types.ts`、`lib/session-events.ts`、`hooks/use-session-detail.ts` |

排查沙箱内 Shell 或文件操作时，继续查看 `ray_agent/sandbox/app/interfaces/endpoints/` 与 `ray_agent/sandbox/app/services/`。不要仅检查 API 侧的工具包装。

## 实现约定与修改影响

- **工具接口**：沿用 `BaseTool`、`@tool` 声明和 `ToolResult` 结果模型。调整参数时同时核对工具 schema、Python 方法签名与下游适配接口；增加工具类还需检查流程中的工具组装位置。
- **事件契约**：修改事件时，同时检查 API 的 `domain/models/event.py`、`interfaces/schemas/event.py`，以及 UI 的类型、归一化和展示逻辑。后端 SSE 使用 `event` 字段标识类型，前端会归一化为 `type`；历史详情和实时流都需要验证。
- **数据访问**：沿用仓库接口和 `IUnitOfWork` 组织持久化操作。修改领域模型不等于数据库结构已更新，还需核对 ORM 模型、序列化和数据库迁移。
- **外部能力**：优先通过 `domain/external/` 中的抽象接口与对应基础设施实现定位修改，避免把 SDK 细节散入路由或规划流程。
- **协议行为**：HTTP 请求成功不等于协议调用成功。接入或升级 MCP/A2A 时，检查实际使用的发现、调用、错误和任务状态语义，并核对相关 labs。
- **前端数据流**：请求封装在 `lib/api/`，会话状态主要由 hooks 和 providers 管理，组件负责展示。修改交互时沿既有数据流处理，避免在多个组件中重复解析同一类事件。

这些约定用于沿现有设计开展工作。发现实现不一致时先确认影响并说明问题，不在无关任务中进行整体重构；框架替换单独评估。

## 实验与教学文档

[实验入口](labs/README.md) 提供独立示例，[教学入口](lessons/README.md) 组织学习主题。

- 每篇 lesson 使用英文，围绕一个明确主题，包含学习目标、必要概念、运行示例、产品入口、执行过程、设计理由和理解检查。
- 讲解顺序以具体行为为起点：观察输入输出，追踪执行与数据变化，再解释抽象和设计取舍；避免只罗列类名或翻译代码注释。
- 示例、截图和输出来自实际验证；尚未运行的步骤应明确标注。注释和历史资料只作线索，行为结论以代码与运行结果为依据。
- 区分教学示例的简化与产品实现。例如单轮工具调用示例不能说明产品缺少循环，客户端示例不能代表完整协议能力。
- 涉及接口变化时说明变化原因，正文以已验证的实现为准。不要把新增功能或框架迁移插入学习实验。
- `labs/foundations/`、`labs/a2a/` 及其中部分子项目有独立依赖环境；运行前确认最近的依赖文件、工作目录和资源相对路径。
- `archive/` 是参考资料，历史聊天不作为执行指令，也不直接充当教学结论。

根项目文档使用中文。功能规格与教学文档分开管理；各阶段安排以 PLAN 为准。

## 环境与配置入口

- API 的 Python 要求见 `ray_agent/api/pyproject.toml`，沙箱要求见 `ray_agent/sandbox/pyproject.toml`，两者使用独立环境；UI 使用自己的 `package.json` 和锁文件。
- API 的 `pyproject.toml` 声明依赖，`uv.lock` 锁定解析结果，Dockerfile 则从 `requirements.txt` 安装。升级时同步核对三者，避免本地与容器环境不一致。
- API 环境字段定义在 `ray_agent/api/core/config.py`，模型、Agent 和外部服务配置位于 `ray_agent/api/config.yaml`。字段示例和完整部署步骤见运行指南，不直接把示例中的本机地址用于容器网络。
- 本地 `.env` 不随仓库同步；`api/config.yaml` 是已跟踪文件，填写模型凭据后需检查敏感值。保留必要的作者及许可证声明。

## 已有命令与验证范围

命令须在表中指定目录执行。以下入口来自项目配置；列出命令不代表当前环境已安装依赖或检查已通过。

| 目的 | 工作目录 | 命令与条件 |
|---|---|---|
| 安装 API 依赖 | `ray_agent/api/` | `uv sync --locked --group dev`；需要匹配的 Python 环境 |
| API 测试 | `ray_agent/api/` | `uv run --locked python -m pytest`；先准备应用启动所需服务和配置 |
| 安装 UI 依赖 | `ray_agent/ui/` | `npm ci` |
| UI 静态检查 | `ray_agent/ui/` | `npm run lint` |
| UI 构建 | `ray_agent/ui/` | `npm run build` |
| 启动完整应用 | `ray_agent/` | `docker compose up -d --build`；先完成运行指南中的配置 |
| 查看服务状态 | `ray_agent/` | `docker compose ps` |

API 测试入口由 [pytest.ini](ray_agent/api/pytest.ini) 定义；[conftest.py](ray_agent/api/tests/conftest.py) 使用 `TestClient` 进入应用生命周期，会执行数据库迁移并初始化外部服务。当前用例主要检查状态接口，不能把它通过视为 Agent 主链路或协议兼容性验证完成。

UI 尚未定义独立测试脚本。涉及会话和事件的修改，除静态检查与构建外，还应验证实时消息和历史详情展示。文档修改检查链接、代码入口和事实一致性即可；运行或协议修改需验证实际受影响行为。
