# W4：前端数据层

所属：[二次开发总计划](README.md)。前置：W3（新接口与轮次事件）；W1、W2 的事件语义。规模：中，1 个对话。

## 目标与不做

**目标：** 页面按 W3 的事件接口订阅一条按序号续传的事件流，会话状态以运行状态为准；把事件投影为本文定义的视图模型，时间线准确呈现单循环的过程，运行用时、每轮用量与当前动作都由事件字段计算，不靠推断。

**不做：** 组件视觉与页面结构（W5）；流式增量渲染（W6）；审批（W7.2，视图模型预留条目）。本包只对现有组件做让新条目能显示的最小改动；W5 阶段一已完成的组件可以直接使用。

## 现状

- [`hooks/use-session-detail.ts`](../../ray_agent/ui/src/hooks/use-session-detail.ts) 同时维护“发送消息的流”和“空消息的补齐流”，流结束后延迟重连（第 102–129 行、第 226–305 行）；会话状态从 step、tool、wait、done、error 事件推断（第 62–99 行），发送时先乐观置为 running。
- [`lib/session-events.ts`](../../ray_agent/ui/src/lib/session-events.ts) 按 step 分组工具（第 174–259 行），没有 step 时平铺；`collapseRetriedTurns` 与 `trimToLastUserMessage` 会隐藏同内容重试之前的失败轮次（第 427–470 行）。
- 计划面板读取最新 plan 事件并合并 step 事件的状态（第 333–360 行；[`components/plan-panel.tsx`](../../ray_agent/ui/src/components/plan-panel.tsx)）。
- 用量只显示最近一次调用的上下文占用（[`components/token-usage.tsx`](../../ray_agent/ui/src/components/token-usage.tsx)）。
- 已有本地观察脚本 [`scripts/check-event-observability.cjs`](../../ray_agent/ui/scripts/check-event-observability.cjs)，转译并执行真实 UI 模块验证 SSE 解析与时间线构建。

## 设计

### 订阅

- 进入会话：请求会话详情，得到全部运行与事件（含 seq），记录最大 seq；随后打开 `GET /sessions/{id}/events?after_seq=` 的 SSE，页面存在期间保持一条连接，断开后按最后收到的 seq 重连（指数退避，上限数秒）。
- 发送消息：调用 `POST /chat`，只负责提交；新事件从已打开的订阅到达。不再为发送单独开流。
- 去重：按 seq 丢弃已经收到的事件，保证重连与重复推送不产生重复条目。
- 状态：以 `run` 事件为准。只有收到运行状态变化或重新拉取详情时才改变显示状态；发送时的“提交中”只是按钮的临时禁用，不改写运行状态。
- 当前时间：视图模型只保存时间戳；实时走秒由组件按当前时间计算，投影不依赖时钟，保证观察脚本结果确定。

### 视图模型契约

投影函数输入事件列表与运行列表，输出 `SessionView`。类型放在 `ui/src/lib/` 下的独立模块，W5 只依赖这些类型。以下是字段约定，实施时可补充派生字段，删改已有字段需同步本节。

**SessionView：** 会话标题与状态；`runs: RunView[]`；`activeRun`（running 或 waiting 的运行，没有则为空）；`timeline: TimelineItem[]`；`plan: PlanView | null`；`usage`（会话累计 tokens 与最近一次上下文占用）；`files`（上传与交付文件）；`events`（原始事件，按 seq 排序，供开发者视图）。

**RunView：** `id`、`status`、`reason`、`startedAt`、`endedAt`、`turns: TurnView[]`、`maxTurns`、`summary`（终态汇总）、`activity`（见下）。

**activity：** 当前动作，取值与来源：

| kind | 条件 | 附带 |
|---|---|---|
| `model` | 最后一个 `turn` 已 started 未 completed，且没有进行中的工具 | 本轮开始时间、轮次序号 |
| `tool` | 存在 calling 未 called 的工具调用 | 调用的标题、开始时间、call ID |
| `waiting_reply` | 运行 waiting，原因是提问 | 问题文本 |
| `waiting_approval` | 运行 waiting，原因是审批（W7.2） | 待审批的 call ID |
| `stopping` | 已请求停止、尚未收到终态 | 请求时间 |
| `idle` | 其他 | — |

**TurnView：** `index`、`startedAt`、`endedAt`、`modelMs`、`usage`、`finishReason`、`toolCallIds`、`contextEstimate`；W6 增加 `ttftMs`、`attempts`。

**TimelineItem：** 按事件顺序排列，同一会话的多次运行自然衔接：

| kind | 来源 | 内容 |
|---|---|---|
| `user` | 用户 `MessageEvent` | 文本、附件、是否为运行中注入 |
| `narration` | 伴随工具调用的助手文本 | 文本 |
| `tools` | 同一轮的工具调用 | `ToolCallView[]`；一轮多个调用时整体显示为一组 |
| `ask` | `message_ask_user` 与等待 | 问题、是否已回复 |
| `approval` | W7.2 的审批请求 | 预留：调用、参数、状态 |
| `delivery` | 带附件的助手消息 | 文件列表、说明 |
| `compaction` | `compact` 事件 | 压缩前后估算量、被摘要轮数 |
| `attempt` | W6 的失败尝试事件 | 预留：原因、第几次 |
| `final` | 没有工具调用的助手消息 | Markdown 文本、所属运行的汇总 |
| `run_end` | 非 completed 的终态 | 状态与可读原因 |

**ToolCallView：** `callId`、`family`（file / shell / browser / search / mcp / a2a / other，决定图标与工作台面板）、`name`、`title`（面向用户的动词短语，如“读取 src/app.py”“运行 npm test”，由工具名与关键参数生成，映射表放在投影模块）、`argSummary`、`status`（running / succeeded / failed / denied / skipped / cancelled）、`startedAt`、`durationMs`、`result`（退出码、是否截断、完整输出路径、原始字符数）、`raw`（参数与结果原文，供展开与开发者视图）。

**PlanView：** `items`（文本与状态 pending / in_progress / completed）、`currentIndex`、`completedCount`、`explanation`、`updatedAt`、`changed`（与上一版相比新增、删除或状态变化的项，供界面标记）。

失败轮次保留，不再因同内容重试而隐藏。删除 step 分组逻辑、`collapseRetriedTurns`、`trimToLastUserMessage` 及相关重试裁剪。“重试”保留为“以相同内容再发一次”，只发送消息，不删除已有事件。

### 状态与交互

- running：显示停止按钮；输入框可用，发送的内容作为补充要求注入（W1 语义）；
- waiting：输入框用于回复提问；
- 终态：输入框可发送新消息，将创建新运行。

## 改动清单

- `lib/api/session.ts`、`lib/api/types.ts`、`lib/api/fetch.ts`：新接口、seq/run_id 字段、`run` 与 `turn` 事件、运行状态与原因类型、请求重建读取；
- `hooks/use-session-detail.ts`：重写订阅与状态；
- 视图模型类型与投影模块；`lib/session-events.ts` 删除 step 分组与重试裁剪，并入或让位于投影模块；
- 现有组件：为新条目做最小显示（W5 接管后删除）；
- `scripts/check-event-observability.cjs`：更新为新的事件形态与投影用例。

## 验收

- `npm run lint` 与生产构建通过；
- 观察脚本覆盖：按 seq 去重、重连后补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity 在各事件序列下的取值、TurnView 的用时与用量、PlanView 的 `changed`、各终态的可读原因；
- 真实浏览器（Compose 与真实模型）：完成 E2、E3；任务运行中刷新页面，事件完整、不重复；运行中断开网络再恢复，页面补齐期间的事件；运行中停止，显示“已停止”；运行中重启 API，显示“服务重启导致中断”。

## docs 同步

- [产品说明](../product.md)：会话与任务、观察与历史、怎么判断任务完成；
- [UI 开发指南](../../ray_agent/ui/README.md)：订阅方式、视图模型模块与检查脚本；
- [代码地图](../code-map.md)：前端分组；
- [能力与边界](../capabilities.md)：SSE 重连与补齐从“未验证”移出（以实际验证结果为准）。

## 交接

下游依赖：视图模型类型与投影函数（W5 的全部组件只消费它）；订阅 hook 的事件分发入口（W6 接入增量事件）；`approval` 与 `attempt` 预留条目（W7.2、W6 填充）。
