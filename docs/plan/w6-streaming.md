# W6：流式输出与运行指标

所属：[二次开发总计划](README.md)。前置：后端部分 W3（通知通道与轮次事件）；前端部分 W5 阶段二（消息组件与状态条）。规模：中，1 个对话。

## 目标与不做

**目标：** 模型生成期间页面逐步显示文本；工具调用参数在完整接收并校验后才执行；断流、停止、刷新之后页面不残留半截内容；每轮记录首字延迟，运行中显示生成速度；失败、重试、取消的模型请求留下记录，界面能说明发生了什么。

**不做：** 切换到 Responses API；推理内容（reasoning）的流式展示；工具参数的流式预览；量化性能目标。

## 现状

以下是本包动工前的快照，行号已失效，当前行为见「实施修正」与「交接」。

- 模型适配只用非流式 `chat.completions.create`，超时硬编码 3600 秒（[`openai_llm.py`](../../ray_agent/api/app/infrastructure/external/llm/openai_llm.py)）。
- 用量从响应的 `usage` 字段解析（[`llm/usage.py`](../../ray_agent/api/app/infrastructure/external/llm/usage.py)），W2 的容量估算依赖 `prompt_tokens`。
- W1 之后循环依赖 `finish_reason` 判断截断，W3 之后事件经数据库与通知送达页面，每轮有 `turn` 事件。

## 设计

### 模型适配

- 新增流式调用路径：`stream=True`，并请求 `stream_options={"include_usage": True}`（供应商不支持时自动去掉该参数重试一次，并在之后的请求中不再携带）。
- 按 `choices[0].delta` 组装：文本片段顺序拼接；`tool_calls` 片段按 `index` 聚合，首个带 id 的片段确定 call ID，`function.arguments` 按顺序拼接；记录最后的 `finish_reason` 与末尾 chunk 中的 usage。
- 返回值与非流式相同的完整结果（message、finish_reason、usage），另通过回调逐段交出文本增量。循环层对完整结果的处理与 W1 一致：没有正常的 `finish_reason`（流在中途结束、连接断开）视为传输错误，按模型重试规则重试，**不执行任何调用**。
- 保留非流式路径，由配置项选择，默认启用流式。`tool_call_compat` 的内嵌调用解析在完整文本组装后执行。
- 顺带把 3600 秒超时改为配置项，流式时作用于首个 chunk 与 chunk 间隔。

### 增量事件

- 文本增量只经 Redis 通知推送，不写数据库：`{session_id, run_id, turn, attempt, delta}`。`attempt` 在同一轮内每次模型请求（含重试）递增。
- 完整的助手消息照常作为事件写入数据库，带上 `attempt`。
- events SSE 把增量作为独立的事件类型推送给当前连接，不分配 seq，重连时不补发。

### 运行指标

- **首字延迟：** 从请求发出到收到第一个文本或工具调用片段的毫秒数，写入该轮 `turn`（completed）的 `ttft_ms`；非流式路径为空。
- **生成速度：** 运行中由前端按增量估算（累计字符数按 W2 的系数换算为 tokens，除以首个片段以来的时间），标注为估算；该轮结束后以 `completion_tokens ÷ (model_ms − ttft_ms)` 得到实际值显示在开发者视图。供应商不返回 usage 时只显示估算值并注明。
- **失败尝试记录：** 模型请求失败（传输错误、流中断、空回复）、被重试或被停止取消时，写入一条 `attempt` 事件：`run_id`、`turn`、`attempt`、原因、已收到的文本字符数、是否已重试。它不进入模型历史，W3 的请求重建忽略它。`turn`（completed）的 `attempts` 为该轮请求次数。

### 前端

- 在时间线末尾维护一个“生成中”的临时条目，按 `attempt` 累积增量；收到同一 `attempt` 的完整助手消息时，用它替换临时条目；
- 收到更大的 `attempt`、运行进入终态或页面刷新时，丢弃临时条目；丢弃由失败引起时显示 W5 的失败尝试提示；
- 状态条在生成中显示估算速度；开发者视图的轮次行显示首字延迟、实际速度与尝试次数；
- 未收到增量的供应商或非流式配置下，页面行为与 W5 一致。

## 改动清单

- `infrastructure/external/llm/openai_llm.py`：流式路径与组装；`domain/external/llm.py`：增量回调参数；
- 循环层：传入增量回调、维护 attempt、记录首字延迟、写入 `attempt` 事件；
- 运行器与通知：增量发布；
- events SSE：推送增量事件类型；
- 前端：订阅 hook 接入增量；视图模型增加临时条目、`ttftMs`、`attempts` 与 `attempt` 条目；消息组件、状态条与开发者视图的显示；
- `ScriptedLLM`：支持按 chunk 返回并可设定片段间隔，以测试组装逻辑与计时。

## 验收

**自动测试：**

1. 文本与两个工具调用交错分片（参数分成多段、id 只出现在首段）：组装结果与非流式一致；
2. 流在工具参数中途结束：不执行调用，按重试规则重试，并写入一条 `attempt` 事件；
3. `finish_reason=length`：沿用 W1 的截断处理；
4. usage 只出现在最后一个 chunk、或完全缺失：前者正确记账，后者标记用量不可用、容量估算退回字符估算；
5. 供应商拒绝 `stream_options`：去掉后重试成功；
6. 首字延迟：`ScriptedLLM` 设定首片段延迟，`ttft_ms` 落在预期范围；
7. 请求重建测试在出现 `attempt` 事件时仍逐字一致；
8. 前端观察脚本：增量累积、完整消息替换、更大 attempt 丢弃旧临时条目、终态后无临时条目、速度估算在无 usage 时标注为估算。

**真实浏览器：** 运行 E1 与 E2，观察文本逐步出现与状态条速度；生成过程中停止，临时内容消失并显示“已停止”；生成过程中刷新，页面只显示已保存的完整内容。记录首字延迟与总耗时，写入评测报告，不设通过阈值。

## docs 同步

- [架构说明](../architecture.md)：事件与投影中的增量通道；
- [设计取舍](../decisions.md)：“模型调用不走流式”改写为新选择，保留原复杂度分析；
- [能力与边界](../capabilities.md)：流式输出、运行指标条目，注明速度为估算的条件；
- [代码地图](../code-map.md)：模型调用与事件分组。

## 交接

下游依赖：增量事件的通道与格式；`ttft_ms` 与输出速度用哪些已落库字段；失败尝试事件。W8 在综合验收中覆盖流式与停止、压缩同时发生的情况。前端增量渲染与评测不在本次后端范围内。

交接接口（2026-09-29，后端已实现；`ray_agent/ui/` 尚未消费 `delta`）：

### 增量通道

文本增量不写数据库，没有 `seq`，重连、刷新和 `GET /sessions/{id}` 都不会补发。Redis 与落库通知共用频道 `session:events:{session_id}`：

- 落库通知：`{"session_id": "s1", "seq": 12}`
- 文本增量：`{"session_id": "s1", "run_id": "r1", "turn": 1, "attempt": 1, "delta": "你"}`

SSE `GET /sessions/{id}/events` 把增量推成独立事件，**没有** `id` 行：

```text
event: delta
data: {"session_id":"s1","run_id":"r1","turn":1,"attempt":1,"delta":"你"}
```

`turn` 与 `turn.index` 相同，运行内从 1 递增。`attempt` 是该轮内的模型请求序号，含重试，从 1 递增；下一轮重新从 1 开始。`delta` 只含可见文本，不含推理内容，也不含工具参数。发布失败只记日志，模型请求继续；丢了的片段不会由 3 秒兜底查询补上。

结束与收敛（前端临时条目按 `(run_id, turn, attempt)` 累积，不能只比 `attempt` 大小）：

- 同一三元组的 `delta` 顺序拼接。
- 收到同一 `attempt` 的助手 `message` 时，用该消息替换临时条目。`message.attempt` 只出现在模型正文和提问正文上；用户消息与交付通知为空。
- 同一运行里出现更大的 `attempt`，或出现另一个 `turn`，丢弃上一份临时条目。
- `finish_reason=length` 会先推出增量，但**不**落助手消息，也**不**写 `attempt` 事件。该轮 `turn(completed)` 到达且没有同 `attempt` 的助手消息时，丢掉临时条目。
- 运行进入终态、页面刷新或重连：临时条目消失，只显示已落库内容。
- 没有增量时（非流式或供应商不推文本），页面行为与现在的 W5 一致。

### 首字延迟与输出速度

`ttft_ms` 在 `turn`（phase=`completed`）上，单位毫秒，从这次请求发出到第一个可见文本或工具调用片段。推理分片不计。非流式、或这次请求没有可见片段时为 `null`。被停止的轮次若已经见到可见片段，补写的 completed 也会带上它。

```json
{"type":"turn","phase":"completed","index":1,"model_ms":840,"attempts":1,"ttft_ms":210,"usage":{"prompt_tokens":120,"completion_tokens":40,"cached_tokens":null,"reasoning_tokens":null},"finish_reason":"stop","tool_call_ids":[],"tools_ms":0,"error":null}
```

后端不计算速度。运行中的估算由前端做：累计字符按 W2 系数（中日韩 0.7 token/字，其余 0.3）换成 tokens，除以第一个片段以来的秒数，并标注为估算。该轮结束后，仅当 `usage.completion_tokens` 与 `ttft_ms` 都有值、且 `model_ms > ttft_ms` 时，才可以用 `completion_tokens / (model_ms − ttft_ms)`。两处不要把它当成可见文本的真实速度：`attempts > 1` 时 `model_ms` 含失败尝试，结果偏小；推理模型的 `completion_tokens` 含首字之前的推理 token，结果偏大。`reasoning_tokens` 有值时，分子应改用 `completion_tokens − reasoning_tokens`，或继续只显示字符估算并注明。供应商没有 usage 时 `completion_tokens` 为 `null`，只显示估算。

开发者视图的轮次行已经能显示 `ttftMs` 与 `attempts`（`session-projection.ts` 会写入）。速度字段尚未接上。

### 失败尝试

`attempt` 事件落库，有 `seq`，请求重建忽略它，也不增加 `runs.model_requests`（轮次上的 `attempts` 仍然计入）。SSE 与其它事件一样带 `id`：

```text
event: attempt
id: 12
data: {"event_id":"…","seq":12,"run_id":"r1","created_at":1759075200000,"turn":1,"attempt":1,"reason":"stream_interrupted","chars":4,"retried":true}
```

| `reason` | 含义 | 建议文案 |
|---|---|---|
| `transport` | 连接中断、超时、限流或 5xx | 连接中断或超时 |
| `stream_interrupted` | 流在 `finish_reason` 之前结束 | 输出流中断 |
| `empty` | 既无文本也无工具调用 | 空回复 |
| `model_error` | 不可重试的请求错误 | 模型拒绝请求 |
| `cancelled` | 用户停止时这次请求还在进行 | 已停止 |

`chars` 是这次尝试已经推送的文本字符数，不含推理。`retried: true` 表示还会再请求一次。半截文本不进入模型历史。

现有投影会把 `attempt` 放进时间线，但 `reason` 原样显示，且不读 `chars`。`AttemptNotice` 在 `retried === false` 时固定加上「已达到重试上限，不再重试」。这对 `cancelled` 和不可重试的 `model_error` 是错的：停止应显示「已停止」，只有重试耗尽才用那句后缀。

上下文超长拒绝不写 `attempt`，仍走压缩或 `context_overflow`。摘要请求在内部走流式以便拿到 usage，不推增量，也不写 `attempt`。

### 配置

`config.yaml` 的 `llm_config.streaming`（默认 `true`）与 `request_timeout`（默认 `3600` 秒）。流式时超时是等待首个分片以及分片之间的空闲间隔，不是整段生成的总时长。设置页的 `POST /llm` 不包含这两项，保存不会把它们改回默认值。`LLMConfigPublic` 也不返回它们。

## 实施修正（2026-09-29）

本次只做依赖 W3 的后端。验收第 8 项和真实浏览器走查留给前端阶段。以代码为准，相对上文设计有这些修正：

1. **临时条目的键是 `(run_id, turn, attempt)`。** 下一轮的 `attempt` 重新从 1 开始，只比较「更大的 attempt」会把上一轮的临时文本留在页面上。
2. **截断不写 `attempt` 事件。** `finish_reason=length` 仍沿用 W1：丢弃响应、不执行工具。流式路径上增量已经推过，完整助手消息不会落库。前端在该轮 `turn(completed)` 到达且没有同 attempt 的助手消息时丢掉临时条目。
3. **速度公式有两处偏差。** `ttft_ms` 只属于留下结果的那次请求（成功或截断），而且要等到第一个可见文本或工具片段，推理分片不算。`model_ms` 是该轮各次尝试的耗时合计，`attempts > 1` 时除法偏小。推理模型上偏差相反：`completion_tokens` 含推理 token，这些 token 发生在首字之前，除以 `model_ms − ttft_ms` 会把它们算进可见文本的窗口，速度偏大。2026-09-29 的一次 `deepseek-flash` 请求里，26 个 completion token 中有 24 个是推理 token，可见文本只有 3 个字符。`ttft_ms` 为 `null` 或大于等于 `model_ms` 时不要做这个除法。供应商没有 usage 时 `completion_tokens` 为 `null`，只显示字符估算。运行中的字符估算不受这两处影响。
4. **缺少 usage 不会清掉已有基数。** W2 的 `ContextBudget.record_usage()` 在 `prompt_tokens` 缺失时直接返回。一次运行从未收到 `prompt_tokens` 时，估算方法保持 `chars`；曾经收到过之后，某一次响应没有 usage，下一次仍用上次的基数（方法仍是 `usage`）。这与设计里「完全缺失则退回字符估算」的字面不同，退回只发生在还没有任何 usage 基数时。
5. **只有 400 正文点名 `stream_options` 或 `include_usage` 才去掉该参数。** 上下文超长和其他 400 仍按原错误处理，之后的请求继续携带 `include_usage`。去掉之后，同进程内不再携带。
6. **推理分片。** DeepSeek 的 `reasoning_content` 按片拼进最终消息，与非流式 `message.model_dump()` 一样进入历史；不调用增量回调，不计首字。首字是第一个非空 `content`，或任意 `tool_calls` 片段。工具参数不预览。
7. **停止先于终态写下进行中的尝试。** `chars` 可能比最后一个已推送片段少几个字符（停止与回调的时序）。补写的 `turn(completed)` 把进行中的耗时加进 `model_ms`，并在结果还没返回时用这次请求的首字延迟。取消协程不会再写第二条 `attempt`。`retried` 为 false，不能显示成「已达到重试上限」。
8. **摘要请求不产生增量与 `attempt`。** 压缩用的摘要调用仍走流式，以便拿到 `prompt_tokens`，但不传增量回调。
9. **`streaming` 与 `request_timeout` 只在 `config.yaml`。** 设置页更新模型时构造的 `LLMConfig` 会填上默认值；保存时排除这两项，避免把 yaml 里的选择覆盖掉。
10. **增量不落库、不补发。** 没有 SSE `id`。Nginx 的 SSE 位置本来就是 `proxy_buffering off`，本次未改。`attempt`、`ttft_ms`、`message.attempt` 都在既有 JSONB 载荷里，没有新迁移。
11. **`attempt` 不增加运行的 `model_requests` 计数。** 轮次 `attempts` 仍是该轮发出的请求次数，与 W3 一致。
12. **评测日志跳过 `delta`。** `scripts/eval/runner.py` 不把增量写入 `sse_log`，也不据此推进 `last_seq`；`turn(completed)` 的压缩记录增加 `ttft_ms`，并压缩 `attempt` 事件。本次没有跑评测。

## 实施修正（前端，2026-09-29）

前端接在 W5 阶段二的会话页上。验收第 8 项由 `ray_agent/ui` 的 `node scripts/check-event-observability.cjs` 覆盖。相对上文设计与交接，页面按这些规则做：

1. **临时条目的键是 `(run_id, turn, attempt)`，id 为 `stream:{runId}:{turn}:{attempt}`。** 增量留在订阅 hook 的内存里，不进入带序号的事件列表；投影遇到塞进 `events` 的 `delta` 也会丢掉。同一 attempt 的助手消息到达后，时间线改走那条已保存消息（旁白或最终回复）。同一运行里更大的 attempt、另一轮（含只收到下一轮 `turn(started)`）、该轮 `turn(completed)`、该 attempt 的失败记录，以及运行终态，都不再保留临时条目。刷新和重连会清空 hook 里的增量，半截文本不会留下来。
2. **临时条目是旁白，不是最终回复。** 光标只在这条临时旁白上。完整消息到达后，有没有工具调用仍按原来的规则决定它是旁白还是最终回复。
3. **速度。** 状态条只在还有临时文本时显示字符估算，并标明估算：中日韩字符 0.7、其余 0.3，除以第一个片段以来的秒数。没有未结束的轮次时，状态条改显示最近一轮的实测：`completion_tokens / (model_ms − ttft_ms)`，`reasoning_tokens` 有值时先从分子扣除；分子不大于 0、或 `ttft_ms` 缺失、或它不小于 `model_ms` 时不显示这个除法。开发者视图的已结束轮次用同一公式，不显示运行中的估算。尝试次数大于 1，或扣除了推理 token 时，轮次行的提示里说明数值会偏小或已经扣除。
4. **失败尝试文案。** `cancelled` 写成「第 N 次请求已停止」，不带「已达到重试上限」。`model_error` 写成失败和「模型拒绝请求」，也不带这句。只有 `transport`、`stream_interrupted`、`empty` 在 `retried` 为 false 时才加上重试上限；目录里已经写成中文、不在原因表中的说明，仍按不再重试加上这句。`chars` 大于 0 时附上已收到的字符数。
5. **侧栏徽标。** 正在查看的会话，详情里的运行状态写回列表里的那一项；之后若列表快照仍是旧状态，会再写一次。正常完成和停止没有徽标，不再停在「运行中」。
6. **评测。** 报告由 `scripts/eval --label w6` 写入 `docs/plan/evidence/`，首字延迟在各轮压缩记录的 `ttft_ms`，总耗时是 `wall_seconds`。子计划不设阈值。2026-09-29 对当时 HEAD `33964e0` 跑了 E1、E2。该报告与走查截图在 Git 提交 `2e68aa3`，当前证据目录不再保留；前端改动在这次评测之后，评测不覆盖页面。

浏览器走查同日用 Playwright 无头脚本对 `http://localhost:8088` 完成。长文两帧变长，状态条标出估算速度；停止后临时文本消失并显示已停止；刷新后旧半截不在，重连后的新片段会再进入临时条目。断网补齐、侧栏终态徽标、E3 交付终态和工作台「回到最新」的结果写在[能力与边界](../capabilities.md)的运行视图一行。

## 执行效率修订（2026-10-08，已批准）

保留 duration_ms/tools_ms 的原口径，新增工具 stages_ms（execution、postprocess、projection），浏览器结果记录 observation、截图记录 capture/upload；子阶段不可再与父阶段相加。准备环境、MCP/A2A 发现及运行准备分别写结构化耗时日志，用于定位墙钟差额，不声称各项相加覆盖全部耗时。

验收：覆盖受影响契约的定向检查，与受控页面读数、表单读回和产物展示共同核对；证据和进度只登记总计划。
