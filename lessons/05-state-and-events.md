# State and events

Status: stub
Area: State and events
Prerequisites: [01](01-application-flow.md)

## 1. Learning objectives and prerequisites

- 能指出会话、事件、任务消息、页面展示状态分别落在哪里。
- 能说明领域事件如何变成 SSE，以及刷新后历史与实时流应表示同一套业务含义。
- 前置：`4_5` / `4_6` 只需本机 uv。看产品 SSE 需 Compose。

## 2. Essential concepts and a runnable example

| 档位 | 脚本（`labs/foundations/`） |
|---|---|
| Recommended | `4_5_同步咖啡店.py`、`4_5_异步咖啡店.py`、`4_6_FastAPI-Demo.py` |
| Optional | `4_6_FastAPI-Docs.py`、`3_10_使用流式输出提升响应速度.py` |

这些脚本讲同步/异步与 HTTP，不包含 Redis Streams。产品路径要另读代码或看页面。

产品侧会话状态：`pending` / `running` / `waiting` / `completed` / `failed`。

观察（`unverified`）：发共用写文件任务时看时间线；刷新后历史仍在。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 领域事件 | `ray_agent/api/app/domain/models/event.py` |
| SSE 映射 | `interfaces/schemas/event.py`（后端用 `event`，前端归一成 `type`） |
| Redis 任务 | `infrastructure/external/task/redis_stream_task.py` |
| 前端解析 | `ray_agent/ui/src/lib/session-events.ts`、`lib/api/types.ts` |
| 会话详情 | `hooks/use-session-detail.ts`、`components/session-detail-view.tsx` |

Postgres 保存会话、事件历史、Agent 记忆与文件元数据。Redis 保存任务输入输出流。文件内容在本地卷或 COS，不在事件 JSON 里当唯一真相。

## 4. Design rationale, limitations, and relevant failure behavior

- Redis 中有消息，或库里有任务 ID，都不等于进程重启后能接着跑（进程内 `asyncio.Task`）。
- 前端在收到 `done` 后会中止 SSE，可能取消服务端请求 Task——排查时与「任务逻辑失败」分开。
- MCP/A2A 使用 `ProtocolToolContent.outcome`；`called` 只表示调用结束。展示细节见 07 / 08。

## 5. Understanding checks or a focused observation experiment

- 刷新页面后，计划与工具结果是从 SSE 重放，还是从历史接口读取？
- 改事件字段时，为什么必须同时看领域模型、SSE schema、前端类型和展示组件？
- `4_6` 的 FastAPI 示例能否证明产品使用 Redis Streams？应怎样表述边界？
