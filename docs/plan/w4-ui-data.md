# W4：前端数据层

所属：[二次开发总计划](README.md)。前置：W3（新接口与轮次事件）；W1、W2 的事件语义。上下文环的占用口径以 [W9 文末 U3](w9-input-commands.md#审计返工2026-09-30) 为准。下面 usage 段里「估算优先、压缩后用 after_estimate」的写法是返工前的投影，不作为当前契约。

## 目标与不做

**目标：** 页面按 W3 的事件接口订阅一条按序号续传的事件流，会话状态以运行状态为准；把事件投影为本文定义的视图模型，时间线准确呈现单循环的过程，运行用时、每轮用量与当前动作都由事件字段计算，不靠推断。

**不做：** 组件视觉与页面结构（W5）；流式增量渲染（W6）；审批（W7.2，视图模型预留条目）。不改 `components/`、`app/` 与夹具。现有会话页继续用旧时间线函数渲染，但订阅已换成一条按序号续传的流；W5 阶段二再改为渲染 `view`。

## 现状

以下是 W4 实施前的代码事实，行号对应 W3 提交 `c0822dc`，不要再对当前文件。

- [`hooks/use-session-detail.ts`](../../ray_agent/ui/src/hooks/use-session-detail.ts) 同时维护“发送消息的流”和“空消息的补齐流”，流结束后延迟重连（第 102–129 行、第 226–305 行）；会话状态从 step、tool、wait、done、error 事件推断（第 62–99 行），发送时先乐观置为 running。
- [`lib/session-events.ts`](../../ray_agent/ui/src/lib/session-events.ts) 按 step 分组工具（第 174–259 行），没有 step 时平铺；`collapseRetriedTurns` 与 `trimToLastUserMessage` 会隐藏同内容重试之前的失败轮次（第 427–470 行）。
- 计划面板读取最新 plan 事件并合并 step 事件的状态（第 333–360 行；`components/plan-panel.tsx`，W5 已删除）。
- 用量只显示最近一次调用的上下文占用（`components/token-usage.tsx`，W5 已删除）。
- 已有本地观察脚本 [`scripts/check-event-observability.cjs`](../../ray_agent/ui/scripts/check-event-observability.cjs)，转译并执行真实 UI 模块验证 SSE 解析与时间线构建。

## 设计

### 订阅

- 进入会话：请求会话详情，得到全部运行与事件（含 seq），记录最大 seq；随后打开 `GET /sessions/{id}/events?after_seq=` 的 SSE，页面存在期间保持一条连接，断开后按最后收到的 seq 重连（指数退避，上限数秒）。
- 发送消息：调用 `POST /chat`，只负责提交；新事件从已打开的订阅到达。不再为发送单独开流。
- 去重：按 seq 丢弃已经收到的事件，保证重连与重复推送不产生重复条目。
- 状态：以 `run` 事件为准。只有收到运行状态变化或重新拉取详情时才改变显示状态；发送时的“提交中”只是按钮的临时禁用，不改写运行状态。
- 当前时间：视图模型只保存时间戳；实时走秒由组件按当前时间计算，投影不依赖时钟，保证观察脚本结果确定。

### 视图模型契约

类型在 [`session-view.ts`](../../ray_agent/ui/src/lib/session-view.ts)，投影函数是 [`session-projection.ts`](../../ray_agent/ui/src/lib/session-projection.ts) 的 `projectSession`。W5 只依赖这些类型。时间一律是毫秒时间戳。删改字段需同步本节。

**SessionView：** `id`、`title`、`status`（最新运行的状态；没有运行时为 `idle`。详情里的 `pending` 不进这个字段）、`project`（`{path, name, available, reason}` 或 `null`）、`runs`、`activeRun`（最后一个 `running` 或 `waiting`，没有则为 `null`）、`timeline`、`plan`、`usage`、`files`、`events`（有 seq 的原始事件，按 seq 排序）。

**RunView：** `id`、`status`、`mode`（`normal` \| `plan`，缺省投影为 `normal`）、`reason`、`reasonText`、`startedAt`、`endedAt`、`turns`、`maxTurns`、`summary`（仅终态）、`tokens`（各轮用量之和，运行中也可算）、`activity`。`running`、`waiting`、`completed` 的 `reasonText` 为 `null`。失败且有错误事件时，用去掉末尾 `（原因：code）` 的错误文本。否则：`user_stop` 与没有更具体原因的 `cancelled` 为“你停止了这次运行”；`api_restart` 为“服务重启导致运行中断”；`runner_lost` 为“执行过程已丢失，运行已中断”；`max_iterations` 在没有 `maxTurns` 时为“模型请求次数达到本次运行上限”，传入上限时带次数和设置提示；`context_limit`、`output_truncated`、`model_error`、`runner_error` 各有固定句子，见投影模块。没有原因的 `interrupted` 为“运行已中断”。

详情接口的运行项没有配置快照，`maxTurns` 为 `null`，除非调用 `projectSession` 时传入。

**activity：** 只对 `activeRun` 计算，其余运行为 `idle`。优先级从高到低：

| kind | 条件 | 附带 |
|---|---|---|
| `stopping` | 已请求停止，状态仍是 `running` 或 `waiting` | `requestedAt` |
| `waiting_approval` | `waiting` 且 `reason` 为 `approval` | `callId`、`title` |
| `waiting_reply` | `waiting` 且 `reason` 不是 `approval`。提问在账本里写成 `reason` 为空，不是 `ask` | 问题文本 |
| `tool` | 该运行最后一个 `status === 'running'` 的调用 | `callId`、`title`、`family`、`startedAt` |
| `model` | 该运行最后一个尚未 `completed` 的轮次 | `turnIndex`、`startedAt` |
| `idle` | 其他，包括 `running` 但还没有 `turn started` | — |

**TurnView：** `index`、`startedAt`、`endedAt`、`modelMs`、`toolsMs`、`usage`、`finishReason`、`toolCallIds`、`contextEstimate`。事件里若有 `ttft_ms`、`attempts` 则写入可选的 `ttftMs`、`attempts`。W3 已写 `attempts`，没有 `ttft_ms`。

**RunSummary：** `durationMs`、`turns`、`toolCalls`、`tokens`。不含 `model_requests`；原始 `run` 事件的 payload 里仍有该字段。

**TokenCounts：** `prompt`、`completion`、`total`，`cached` 可选。缺的一项不把另一项当成 0 去凑 `total`。

**usage：** `session` 为各轮用量之和，加上会话内全部 `compact.usage`（含不带 `run_id` 的手动压缩）。`context` 在同时知道占用和窗口时为 `{usedTokens, windowTokens, lastTurnTokens, postCompactEstimate?}`，否则 `null`。进行中的轮次若有四部分 `context_estimate`，`usedTokens` 用其和，否则用最近一次完成轮次的 prompt；`windowTokens` 来自该轮或最近一次 `started` 的 `context_window`；`lastTurnTokens` 是最近完成轮次的 prompt 与 completion 之和；最近一次压缩的 `seq` 晚于最近一轮 `turn(started)` 时，可用压缩后的 `after_estimate.total` 并设 `postCompactEstimate`。事件里的四部分键是 `system_prompt`、`tools`、`history`、`tool_results`（也接受 `system`、`toolResults`），投影写成 `system`、`tools`、`history`、`toolResults`。`watermark` 若是 token 数且该轮有 `context_window`，`watermarkRatio` 为二者之商；否则为 `null`。`compactions` 为压缩次数。可选 `lastCompaction`（最近触发与前后估算）供上下文环详情。

**ToolCallView（W9）：** `denied_by === 'plan_mode'` 时 `status` 为 `denied`，来源文案为“计划模式下不执行”。

**ToolCallView：** `callId`、`family`（`file` / `shell` / `browser` / `search` / `mcp` / `a2a` / `plan` / `deliver` / `other`）、`name`、`toolset`（事件的 `name`）、`title`、`verb`、`target`、`argSummary`、`status`（`running` / `succeeded` / `failed` / `denied` / `skipped` / `cancelled`）、`startedAt`、`durationMs`、`result`、`raw`。动词短语由工具名与关键参数生成，映射表在投影模块。

**result：** `exitCode`、`truncated`、`fullOutputPath`、`rawChars`、`error`、`summary`。SSE 的 `called` 不含 `function_result`；没有失败信号时记 `succeeded`。失败信号来自 `data.success`、`function_result.success`、`content.outcome.success`，或消息中的“拒绝”“未执行”“执行中断 / 已取消 / 已停止”。终态到来时仍为 `calling` 的调用：`cancelled` 与 `interrupted` 标为已取消并说明结果未知，`failed` 标为失败。`completed` 时仍悬空的调用也标为已取消。W2 若在 `data`、`content` 或 `function_result` 中给出 `truncated`、`full_output_path`、`exit_code`，则读入；否则退出码为空、未截断、没有完整输出路径。

**PlanView：** `items`（`text`、`status`、`startedAt`、`completedAt`）、`currentIndex`、`completedCount`、`explanation`、`updatedAt`、`changed`、`version`（第一版为 1，`changed` 为空）。只读 `plan` 事件快照，不再用 `step` 事件改单项。快照里的 `running` 或 `in_progress` 视为 `in_progress`，`completed` 为 `completed`，`failed` 视为 `pending`。`explanation` 优先用本事件的说明，否则沿用此前 `update_plan` 的参数或上一版。两项时间按条目文本在版本之间保留。`changed` 先按新清单输出 `added` 与 `status`（下标是新清单的），再输出旧清单里未匹配的 `removed`（下标是旧清单的）。

**TimelineItem：** 每条都有 `id`、`runId`、`at`。同一会话的多次运行按事件顺序衔接。

| kind | 来源 | 内容 |
|---|---|---|
| `user` | 用户消息 | 文本、附件、`injected` |
| `narration` | 工具调用之前，或提问、最终回复之前的助手文本 | 文本 |
| `tools` | 同一运行、同一轮的工具调用 | `turnIndex`、`ToolCallView[]` |
| `ask` | 等待前缓冲里的最后一条助手文本 | 问题、`answered` |
| `approval` | `approval` 事件 | 调用、`pending` / `approved` / `rejected` / `expired`、`decidedAt` |
| `delivery` | 带附件的助手消息 | 文件、说明 |
| `compaction` | 带前后 token 的压缩 | `beforeTokens`、`afterTokens`、`summarizedTurns`、`summary`、`trigger`（`watermark` \| `overflow` \| `manual`）。`runId` 可为空（手动压缩）。没有估算量的压缩只增加 `compactions`，不出现在时间线 |
| `attempt` | `attempt` 事件 | `turnIndex`、`attempt`、`reason`、`retried` |
| `protection` | 带 `project_file_protection.state` 为 `skipped` 或 `failed` 的 `environment` 事件 | `state`、`message`（事件中的原因原文）。成功快照不单列。该条目按事件顺序出现，因此位于同一次运行的工具条目之前 |
| `final` | `done` 或 `run(completed)` 时缓冲里的最后一条助手文本 | 文本；终态汇总随后写到该运行最后一条 `final` |
| `run_end` | `failed` / `cancelled` / `interrupted` | `status`、`reason`、`reasonText`、`retryText`（仅 `failed`，取该运行第一条非注入用户消息） |

注入按每条运行单独判断。`run(running)` 且前一状态是 `waiting` 时，下一条用户消息不是注入，并把最近一条未回复的 `ask` 标为已回复。该运行已经有用户消息、状态仍是 `running`、又不是在等回复，则后到的用户消息是注入。新运行的第一条用户消息不是注入。

**FileView：** `id`、`filename`、`size`、`extension`、`contentType`、`source`（`upload` 或 `delivery`）、`path`。用户消息附件是 `upload`，助手带附件是 `delivery`。

**RawEvent：** `seq`、`runId`、`type`、`createdAt`、`payload`。

失败轮次保留。“重试”只是以相同内容再发一次，不删除已有事件。`collapseRetriedTurns` 仍导出，但是恒等函数，供当前会话页调用。`trimToLastUserMessage` 已删除。旧的 `eventsToTimeline` 仍按 step 分组，只给尚未切换的会话页使用；新投影不再按 step 分组。

### 状态与交互

- running：显示停止按钮；输入框可用，发送的内容作为补充要求注入（W1 语义）；
- waiting：输入框用于回复提问；
- 终态：输入框可发送新消息，将创建新运行。

## 改动清单

- `lib/api/session.ts`、`lib/api/types.ts`、`lib/api/index.ts`：请求重建读取；SSE 忽略 `event: ping`，并在 `data.seq` 缺失时用 SSE `id` 补序号。`fetch.ts` 的分块解析保持原样；
- `hooks/use-session-detail.ts`：详情加一条 `after_seq` 订阅，发送只 `POST /chat`，并返回 `view`；
- 类型留在 `lib/session-view.ts`，投影在 `lib/session-projection.ts`；
- `lib/session-events.ts`：`collapseRetriedTurns` 改为恒等，删除 `trimToLastUserMessage`。旧时间线导出保留，因为当前会话页仍在使用；
- 不改 `components/`、`app/`、`fixtures/`；
- `scripts/check-event-observability.cjs`：保留 SSE 分块与两条限制，其余改为投影用例。

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

下游依赖：视图模型类型与 `projectSession`（W5 阶段二只消费 `view`）；订阅 hook（W6 在同一条流上接入增量，增量不落 seq）；`approval` 与 `attempt` 条目（事件出现即可投影，W7.2、W6 负责发出事件）。

交接接口（2026-09-28 实现）：

- **类型：** `@/lib/session-view`。这个文件只有类型，投影函数不要从这里导入。
- **投影：** `@/lib/session-projection` 导出 `projectSession`、`mergeBySeq`、`readEventSeq`、`reconnectDelayMs`、`isTerminalRunStatus`。`reconnectDelayMs(attempt)` 为 `500 × 2^attempt` 毫秒，上限 4000。收到一条业务事件后，重连次数归零。
- **hook：** `useSessionDetail(sessionId, initialSkipEmptyStream?)`。第二个参数保留给旧调用，不再改变订阅。返回原有的 `session`、`files`、`events`、`loading`、`error`、`refresh`、`refreshFiles`、`sendMessage`、`streaming`，以及 `view`（详情未到时为 `null`）、`submitting`（与 `streaming` 相同，只在 `POST /chat` 期间为 true）、`stop()`、`loadTurnRequest(runId, index)`。
- **W5 阶段二：** 用 `view` 渲染，不要再调用 `eventsToTimeline`、`collapseRetriedTurns`、`getLatestPlanFromEvents`。停止要调用 `stop()`，终态事件到达前 `activity.kind` 才是 `stopping`。当前会话页的停止按钮直接调 `sessionApi.stopSession`，不会记这个时间戳。`sendMessage(text, attachmentIds)` 在 `running` 时是注入，在 `waiting` 时是回复，在终态后是新运行；传入的 `retry` 被忽略，不再裁事件。旧输入框在运行中换成停止按钮，但 Enter 仍会发送，所以现在按 Enter 可以注入；`isBusy` 在运行中或提交中为 true，重试按钮会禁用。阶段二应让运行中的输入框可以发送，并改走 `stop()`。
- **请求重建：** `sessionApi.getTurnRequest(sessionId, runId, index)` 或 hook 的 `loadTurnRequest`，对应 `GET /sessions/{id}/runs/{runId}/turns/{index}/request`。
- **订阅：** `sessionApi.streamEvents` 忽略 `event: ping`；`data.seq` 缺失时用 SSE `id` 补上。2026-09-28 在 `http://localhost:8088` 看到的服务端 ping 是注释行 `: ping`，解析器本来就丢弃，不会进入投影。去重用已见 seq 集合。`refresh` 把详情快照与流里更新的事件按 seq 合并，不丢掉比快照更新的事件。
- **旧导出：** `session-events.ts` 的 `normalizeEvents`、`eventsToTimeline`、`getLatestPlanFromEvents`、`getLatestUsageFromEvents`、`formatTaskError`、`findLastUserRetry`、`collapseRetriedTurns`、`sessionFileToAttachment` 仍供当前会话页。阶段二切换后可以删除步骤分组。
- **夹具：** `fixtures` 手写了 `maxTurns: 100` 与 `watermarkRatio: 0.75`。`projectSession` 不会产生这两个数。`status-bar` 与 `context-ring` 已经能处理 `null`。
- **W6：** 增量不要写进带 seq 的事件列表。`ttftMs` 与 `attempts` 已是可选字段。`attempt` 条目读取 `turn` 或 `index`、`attempt`、`reason`、`retried`。

## 实施修正（2026-09-28）

实施中以代码为准修正了本文以下内容：

1. “现状”改为 W3 提交 `c0822dc` 的快照。当时的双流、乐观 `running` 和固定 1 秒重连已经替换，那些行号不要再对当前文件。
2. 视图模型以 `session-view.ts` 为准，并写回“视图模型契约”。相对原稿增加或收紧的部分：`SessionView.status` 在没有运行时为 `idle`；`RunView` 增加 `reasonText`、`tokens`，`summary` 仅终态；`activity.tool` 附带 `family`，`waiting_approval` 附带 `title`；`TurnView` 增加 `toolsMs`，`ttftMs` 与 `attempts` 为可选；`RunSummary` 为 `durationMs`、`turns`、`toolCalls`、`tokens`，不含 `model_requests`；`ToolCallView` 增加 `toolset`、`verb`、`target`，`family` 含 `plan`、`deliver`，`result` 为 `ToolResultView`；`PlanItem` 有起止时间，`PlanView` 有 `version`，`changed` 的下标规则见契约；时间线条目都有 `id`、`runId`、`at`；`UsageView` 增加 `watermarkRatio`、`compactions` 与结构化的 `context`；补上 `FileView`、`RawEvent`、`ApprovalStatus`。
3. `maxTurns` 不推断。运行项没有 `config_snapshot`。水位后来由轮次开始事件的 `context_estimate.watermark`（token 数）给出；2026-09-29 起，有窗口时 `watermarkRatio` 取该数除以 `context_window`，没有该字段时仍为 `null`。
4. 提问等待的 `reason` 在账本里是空，不是 `ask`。投影把 `waiting` 且 `reason` 不是 `approval` 视为 `waiting_reply`。
5. 压缩事件没有前后 token 时只增加 `compactions`，不生成时间线条目。
6. SSE 工具事件没有 `function_result`。`called` 且没有失败信号时记 `succeeded`。终态时仍为 `calling` 的调用按运行状态收成 `cancelled` 或 `failed`。
7. 不删除 `eventsToTimeline` 的 step 分组：当前会话页仍在导入，那些文件属于 W5。`collapseRetriedTurns` 改为恒等并保留导出名；`trimToLastUserMessage` 已删除。没有改 `components/`、`app/`、`fixtures/`。
8. 现有会话页通过原来的 hook 接入了新订阅，页面仍渲染旧时间线。切换到 `view` 是 W5 阶段二。
9. 去重改为已见集合，再按 seq 合并，避免序号空洞被丢掉。重连等待从 500 毫秒翻倍，上限 4 秒。
10. 计划只信 `plan` 事件。后续事件没有新说明时保留上一版 `explanation`。
11. 浏览器里的 E2、E3、刷新、断网、停止文案和重启 API 没有走查：会话页还没换成新组件，也不向正在被 W2 使用的 API 提交新任务。SSE 续传与注释行 ping 用只读 curl 核对；投影用观察脚本，并用一条已有会话的详情跑过 `projectSession`。

## W5 阶段二之后（2026-09-29）

会话页已改为只消费 `view`。`session-events.ts` 只保留 `normalizeEvent` 与 `normalizeEvents`。上文提到的 `eventsToTimeline`、`collapseRetriedTurns`、`getLatestPlanFromEvents` 等旧时间线导出已删除。类型字段没有增删。投影补读事件真实键名：`system_prompt` 与 `tool_results` 写入上下文构成；`watermark` 是压缩水位的 token 数，该轮同时有 `context_window` 时 `watermarkRatio` 为二者之商。浏览器走查补记写在 [W5 子计划](w5-ux.md) 的实施修正，不改本节的 W4 当日记录。

## W6 前端之后（2026-09-29）

`projectSession` 另接收 `deltas` 与 `streamStartedAt`。增量不写入 `events`。仍在增长的文本是时间线末尾的一条 `narration`，id 为 `stream:{runId}:{turn}:{attempt}`。`SessionView.streamingItemId` 指向它，`streaming` 带文本和第一个片段的时间；手写夹具可以省略这两项。同一 `(run_id, turn, attempt)` 的助手正文到达、该 attempt 已有失败记录、该轮 `turn(completed)`、同一运行里更大的 attempt 或另一轮、运行进入终态时，不保留临时条目。`TokenCounts.reasoning` 与尝试条目的 `chars` 为可选。速度不写入视图模型，由 `resolveOutputRate` 计算。
