# W9：输入框命令、Plan 模式与手动压缩

所属：[二次开发总计划](README.md)。前置：W8。进度只记在总计划第 5 节。

从本节到「审计返工」之前是 2026-09-29 的历史，不作为当前交互。当前契约是文末「审计返工」。其中项目归属、加号布局、上下文显示和按计划执行条件以文末及 W11 为准。

> **【已废弃 · 仅供追溯】** 从本行到文末「审计返工」之前的全部内容是 2026-09-29 的历史设计与实施记录，其中的 `+` 与 `/` 完全一致、上下文环 Popover、按计划执行条件、「选择项目」 已被取代。**不要据此实施**；当前契约只看文末「审计返工」。

## 目标与不做

**目标：** 输入框有一处统一的命令入口：`+` 菜单与 `/` 提示读同一份命令注册表，列出本入口适用的命令，不可执行时给出原因。用户可以让 Agent 先只调研、给出计划而不产生副作用（Plan 模式），确认后再按计划执行；可以在任务之间手动压缩上下文，而不必等到自动压缩的水位。

**不做：** 选择项目（属于 [W10](w10-local-project.md)，本包只让注册表能被 W10 接入）；按 Shell 命令内容判断是否只读；运行中或等待中的手动压缩；Plan 模式下的审批；排队发送；命令的自定义与快捷键配置；把“按计划执行”做成程序侧调度（计划仍只是模型维护的清单）。

## 已确认决策（2026-09-29）

以下决策已拍板，实施时不改写；与源码冲突时在“实施修正”中记录冲突与处理，决策本身保留。

1. Plan 语义 = 后端约束模式。chat 带 mode: "plan"，运行记录 mode；执行前检查对副作用工具（write_file、replace_in_file、shell_*、浏览器操作、deliver_files、MCP、A2A）返回「计划模式下不执行」；只读工具可用；提示词要求调研后用 update_plan 给出计划并结束；界面提供「按计划执行」，作为下一次普通运行。
2. 计划模式下 Shell 全部禁止（无法可靠判断命令是否只读），不改为 ask。
3. 手动压缩只在没有活动运行时可用；等待提问回复或等待审批时也不允许（返回 409）。

协调者补充决定（2026-09-29）：手动压缩不套用自动压缩的最小收益跳过规则。只要存在可摘要轮次就执行；没有可摘要轮次时返回明确原因，不算失败；摘要失败时记忆不变。

与源码的核对结果：最小收益规则在代码里本来就只对水位触发生效（`agent_loop.py` 第 878–882 行 `trigger == "watermark" and gain < ...`），新增 `manual` 触发不进入这条分支即可，与补充决定不冲突。需要注意的代价是：手动压缩可能换不回空间，甚至估算不降反升（W2 实施修正第 4 条记录过 15226 → 15413 的例子）；这时仍然执行并如实记录前后估算，不回滚。

## 现状

以下是 2026-09-29 按提交 `d06a1a8` 的静态核对，行号可能随后续提交移动。

**输入框：**

- [`chat-input.tsx`](../../ray_agent/ui/src/components/chat-input.tsx) 只有回形针上传按钮（第 229–242 行）和发送按钮，没有 `+` 菜单、没有命令概念；Enter 发送时已判断 `nativeEvent.isComposing`（第 138 行），输入法组合期间不发送。
- 首页（`app/page.tsx`）与会话页（`session-detail-view.tsx`）共用 `ChatInput`。首页发送时先 `createSession()` 再 chat。
- `components/ui/` 没有 popover 与 command 组件，`package.json` 没有 `cmdk`。

**计划与工具管线：**

- 执行前段依次是参数校验和 `ToolPolicyGuard`（`agent_loop.py` 第 339 行），后者对 deny 短路并写 `invocation.denied_by`（[`tool_policy.py`](../../ray_agent/api/app/domain/services/tool_policy.py) 第 91–124 行）。`denied_by` 的取值只有 `policy` 与 `user`（`domain/models/event.py` 第 129 行、`interfaces/schemas/event.py` 第 175 行）。
- `ChatRequest` 只有 `message`、`attachments`、`timestamp`（`interfaces/schemas/session.py` 第 34–38 行），运行没有模式字段（`domain/models/run.py`、`infrastructure/models/run.py`）。
- 记忆的第一条 system 消息在会话第一次运行时写入后一直保留（`agent_loop.py` 第 941–945 行）；运行快照的 `system_prompt` 取的就是记忆里这一条（第 353–368 行）。因此如果把计划模式说明直接写进记忆的 system 消息，它会留到后续的普通运行。

**压缩：**

- 压缩逻辑写在 `AgentLoop` 的方法里：`_compact_history()`（`agent_loop.py` 第 859–913 行）用 `self._memory`、`self.budget`、`self.pipeline.schemas()` 与 `self._pending_context`；`_request_summary()`（第 915–939 行）按 `max_retries` 重试。没有可摘要轮次时直接返回（第 866–868 行）；摘要失败时置 `_capacity_error`、不改记忆（第 886–889 行）；成功时先替换并保存记忆（第 891–896 行），再产出 `compact` 与 `context(replace)` 事件由运行器写入。
- 纯函数部分在 [`compaction.py`](../../ray_agent/api/app/domain/services/context/compaction.py)：`plan_compaction()`（第 54–66 行）在少于 2 轮时返回 `None`，否则最多保留 `keep_turns` 轮、至少摘要 1 轮；`MIN_GAIN_RATIO = 0.15`（第 23 行）。
- `CompactEvent.trigger` 只有 `watermark`、`overflow`（`domain/models/event.py` 第 272 行，schema 第 317 行）。
- 前端投影读取 `data.before_tokens` / `after_tokens`（[`session-projection.ts`](../../ray_agent/ui/src/lib/session-projection.ts) 第 476–493 行），后端 `compact` 事件给的是 `before_estimate` / `after_estimate` 两个估算对象（`interfaces/schemas/event.py` 第 315–325 行）。按静态核对，真实事件因此只累加 `compactions` 计数，不生成时间线的压缩条目，开发者视图的压缩列表也取不到；夹具手写了这两个字段。未经运行核对，W9 实施时先确认再修。
- 上下文环（[`context-ring.tsx`](../../ray_agent/ui/src/components/run/context-ring.tsx)）只有悬停提示，点击没有详情，也没有压缩入口。

**事件归属相关（为下文的设计决定取证）：**

- `RunLedger.start()` 创建运行并在同一事务里把 `sessions.status` 改为 running（[`run_ledger.py`](../../ray_agent/api/app/domain/services/run_ledger.py) 第 69–87 行）；`transition()` 每次都同步会话状态（第 131 行）。侧栏的状态提示直接读会话状态（`session-item.tsx` 第 25、52 行）。
- `runs` 表有部分唯一索引 `uq_runs_active_session`，每个会话最多一个 running / waiting 运行（`infrastructure/models/run.py` 第 22 行）；`runs` 没有区分运行种类的列。
- 启动扫描 `interrupt_running()` 把所有 running 的运行置为 interrupted（`api_restart`）（`run_ledger.py` 第 141–151 行），由 `main.py` 在接收请求前调用。
- `events.run_id` 可空（`infrastructure/models/event.py` 第 30 行）。`RunLedger.append()` 不带 `run_id` 时不锁运行行；`_write()` 对 `run_id` 为空的事件不累加任何运行计数（第 177–181 行），`compact` 的用量只在有 `run_id` 时计入运行（第 196–205 行）。
- 已有先例：会话标题的 `TitleEvent` 由 `TitleService.set_title()` 不带 `run_id` 写入（[`title_service.py`](../../ray_agent/api/app/application/services/title_service.py) 第 99–106 行）。
- 请求重建按 `seq` 回放会话里 `turn(started)` 之前的**全部** `context` 事件，不按 `run_id` 过滤（[`request_rebuild.py`](../../ray_agent/api/app/domain/services/request_rebuild.py) 第 42–53 行）。
- 前端时间线条目的 `runId` 已是 `string | null`（`session-view.ts` 第 178 行）；会话合计用量 `usage.session` 只累加各轮 `turn` 的用量（`session-projection.ts` 第 870 行），不含 `compact.usage`。
- 评测的 `compute_metrics()` 把事件里**所有** `compact.usage` 与运行汇总逐项比对（[`scripts/eval/runner.py`](../../ray_agent/api/scripts/eval/runner.py) 第 86–133 行）。
- `chat()`、`reply_approval()`、`stop_session()` 都在进程内的会话锁 `session_lock` 下决定去向（`agent_service.py` 第 187、252、346 行；锁只在单进程内有效）。

## 设计

### 命令注册表

- 前端新增一个命令注册表模块（建议 `lib/commands.ts`），每条命令有：`id`、显示名称、`/` 关键字与别名、图标、`available(context)`（返回可用，或不可用及一句原因）、`run(context)`。`context` 由输入框所在页面提供：是否在会话页、会话视图（活动运行与其状态、等待原因）、当前是否在提交。
- `+` 菜单与 `/` 提示都只读这份注册表，顺序一致；同一命令在两处的可用性与原因文字一致。
- W9 注册三条命令，全部真正可用：

| 命令 | `/` 关键字 | 行为 | 不可用条件与原因 |
|---|---|---|---|
| 上传附件 | `/upload` | 打开文件选择，沿用现有上传逻辑 | 正在上传；等待审批时输入框禁用 |
| Plan | `/plan` | 切换“下一次发送用计划模式”，输入框显示可移除的“计划模式”标记 | 会话有活动运行（“运行进行中，计划模式只能在新运行开始时选择”）；等待提问回复（“正在等你回复提问”）；等待审批 |
| 压缩上下文 | `/compact` | 调用手动压缩接口，结果以提示条显示 | 首页或没有运行过的会话（“还没有可压缩的上下文”）；有活动运行；等待提问回复或审批；正在压缩 |

- W10 接入时只新增一条“选择项目”并实现它的 `available` 与 `run`，不改菜单与提示组件。W9 不注册该命令，也不显示占位项。

### `/` 提示与 `+` 菜单

- 触发：`/` 位于输入开头或紧跟空白时打开提示；输入法组合期间（`compositionstart` 到 `compositionend`，或 `isComposing` 为真）不打开、不响应按键；路径里的 `/`（前面不是空白）不触发。
- 过滤：`/` 之后连续的非空白字符作为查询，匹配关键字、别名与显示名称；无匹配时显示“没有匹配的命令”，Enter 不做任何事。
- 键盘：上下键移动高亮，Enter 或 Tab 执行高亮项，Esc 关闭提示并保留已输入文字；提示打开时 Enter 不发送消息。
- 执行后从输入中移除触发它的 `/xxx` 片段，其余文字保留，光标回到原处。
- 不可用命令照常列出但禁用，旁边显示原因；键盘高亮可停在它上面以便读屏读出原因，Enter 不执行。
- `+` 菜单列出同样的命令与原因。组件用 shadcn 的 popover 与 command（基于 `cmdk`），按其 CLI 拷入 `components/ui/` 后改造，确认与 React 19、Tailwind 4 兼容。
- 首页与会话页行为一致：两处都用同一个 `ChatInput` 与注册表，只是 `context` 不同。

### Plan 模式

**接口与数据：**

- `ChatRequest` 增加 `mode: "normal" | "plan"`，默认 `normal`。
- `mode` 只在新建运行时生效。会话有活动运行（注入或续接的路由）而请求带 `mode: "plan"` 时返回 409，说明计划模式只能在新运行开始时选择；带 `normal` 或省略时路由不变，续接的运行沿用自己的模式。
- `runs` 增加 `mode` 列（字符串，默认 `normal`，Alembic 迁移，与 `a7d9215bc8e0` 的加列写法一致）；`run(running)` 事件、会话详情的运行项与运行快照 `config_snapshot.mode` 都带上它。

**执行前检查：**

- 新增执行前处理函数 `PlanModeGuard`，注册在 `ToolPolicyGuard` 之前，使被拒绝的调用不会触发审批。
- 按允许清单实现，清单外一律拒绝，这样以后新增的工具默认不能在计划模式下执行：`read_file`、`search_in_file`、`find_files`、`search_web`、`update_plan`、`message_ask_user`、`get_remote_agent_cards`。
- 其余调用（`write_file`、`replace_in_file`、全部 `shell_*`、全部 `browser_*`、`deliver_files`、所有 MCP 工具、`call_remote_agent`）不执行，结果为失败，消息为「计划模式下不执行」加一句说明，`tool(called)` 带 `denied_by: "plan_mode"`。Shell 按决策 2 全部禁止，不看命令内容、不转为 ask。
- `get_remote_agent_cards` 只读本地缓存、不联系远端（W7.2 因此把它排除在 `a2a:*` 之外），归入只读；这是对决策 1 中“A2A”的细化，被拒绝的 A2A 调用指的是 `call_remote_agent`。评审若认为应一并拒绝，只需从清单删除。
- 被拒绝的调用照常经过执行后段（耗时、整形），和策略禁止一样回填给模型，不终止运行。

**提示词：**

- 计划模式说明作为本次运行的 system 提示词后缀，只在发送请求时拼接，**不写入记忆里的 system 消息**（原因见现状第三组第 3 条）。运行快照的 `system_prompt` 记录拼接后的全文，请求重建因此仍与实际请求一致；下一次普通运行的快照不含后缀。
- 说明内容：当前是计划模式，只能用只读工具调研；调研后用 `update_plan` 给出完整清单并在回复中说明计划，然后结束，不要尝试修改文件或执行命令；被拒绝的调用不要换别的工具绕过。中英文提示词各一份。
- 是否真的调用了 `update_plan` 由模型决定，程序不校验；这与计划工具“只记录不调度”的现有边界一致。

**界面：**

- 输入框的 Plan 标记在发送后清除；首页发送时把 `mode` 随第一次 chat 传入。
- 计划模式运行的状态条与时间线标出“计划模式”；被拒绝的工具卡用 `denied_by` 显示“计划模式下不执行”。
- 最新运行是计划模式且已 `completed`、会话没有活动运行时，在最终回复下方显示「按计划执行」。点击后以普通模式发送一条可见的用户消息（固定文案“按计划执行”），作为下一次普通运行；这条消息与计划都在记忆里，不另外注入计划内容。

### 手动压缩

**接口：** `POST /sessions/{id}/compact`，无请求体。

1. 取会话锁（与 chat 共用 `session_lock`），读会话与活动运行。会话不存在返回 404；有活动运行（running，或 waiting 且无论是提问还是审批）返回 409，文案说明先停止或等待运行结束。
2. 读记忆。按记忆最后一次运行的配置快照取工具 schema（`tools_for_turn`），按当前模型配置取 `context_window` 与 `max_tokens`，全部按字符估算得到压缩前估算（没有新的 usage 可校准）。
3. `plan_compaction()` 返回 `None`（少于 2 轮）时，返回 200，`status: "skipped"`、`reason: "no_rounds"` 与一句说明（“没有可压缩的较早轮次”），不写事件，不算失败。
4. 否则按压缩逻辑执行：保留区规则与自动压缩相同（最多保留 `compact_keep_turns` 轮，保留区超过水位 60% 时逐步减少）；**不做**最小收益判断。
5. 摘要请求成功：在**一个** `RunLedger.append()` 里写入 `compact(trigger="manual")` 与 `context(replace)` 两条事件，`apply` 中保存替换后的记忆，提交后通知。返回 200，`status: "compacted"`，带两条事件的 `seq`、前后估算总量与被摘要的轮数。记忆与事件同一事务提交，比循环内“先存记忆、再由运行器写事件”的顺序更严格；循环内的顺序本包不改。
6. 摘要请求失败或返回空内容（按 `max_retries` 重试后）：不写事件、不改记忆，接口返回错误（建议 502，`msg` 说明“摘要请求失败，上下文没有改变”）。失败尝试的用量不入统计，这与自动压缩失败时的现状一致：失败时没有 `compact` 事件，运行计数也不包含那几次尝试（现状第三组第 1 条）。
7. 整个过程持有会话锁，包括摘要请求。代价是压缩期间同一会话的 chat 会等待锁释放，最长约为摘要请求的重试总时长；锁释放后 chat 按正常路由新建运行，读到的是替换后的记忆。前端在压缩期间禁用发送，避免用户感到卡住。否决的替代方案是摘要请求期间释放锁、写入前再检查：需要比较记忆版本并处理被丢弃的摘要及其用量，比持锁复杂，而单用户场景下等待的代价很小。

**压缩逻辑提取：** 把 `_compact_history()` 与 `_request_summary()` 中与循环无关的部分提取到 `domain/services/context/` 下的一个可复用函数或类（如 `Compactor`）：输入为消息列表、估算函数、Agent 配置、模型客户端、会话的用户消息事件与触发原因；输出为结果类型（跳过及原因 / 失败及用量 / 成功时的替换后消息、`CompactEvent` 与 `ContextEvent`），自身不保存记忆、不写事件。循环与手动压缩接口都调用它，各自负责持久化；最小收益判断是它的一个参数，只在 `watermark` 时启用。不复制压缩代码。

**trigger 增加 `manual`：** 领域模型 `CompactEvent.trigger`、接口 schema `CompactEventData.trigger`、前端类型与文案（时间线“你手动压缩了上下文”，开发者视图的触发列）、评测报告的触发显示同步。

**用量计入统计：** `compact.usage` 照常写在事件上。因为手动压缩不属于任何运行（见下节），运行计数不包含它，统计按以下方式补齐：

- 前端 `usage.session` 改为各轮用量加上会话内全部 `compact.usage`（自动压缩的用量原先也没有计入这个合计，一并修正）；运行的 `tokens` 与汇总保持按运行计。
- 评测 `compute_metrics()` 只把带 `run_id` 的 `compact` 与运行汇总比对；不带 `run_id` 的另计为“手动压缩次数、请求数与 tokens”写进报告，不影响 `metrics_consistent`。

**产出事件：** 成功时依次为 `compact` 与 `context(replace)`，二者 `run_id` 为空、`seq` 连续；`replace` 携带替换后的全部消息，与自动压缩相同，请求重建无需改动。

### 事件归属：不挂 run_id

**决定：** 手动压缩不新建运行，`compact` 与 `context(replace)` 事件的 `run_id` 为空，会话状态不变。

**依据（代码证据见现状最后一组）：**

- 会话保持空闲：不经过 `RunLedger.start()` / `transition()`，`sessions.status` 不被改写，侧栏不会出现“运行中”，最近一次运行的终态提示也保持原样。
- 启动扫描不受影响：`interrupt_running()` 只扫 running 的运行，没有运行就不会有“被中断的压缩”；API 在压缩中途退出时，记忆与事件同一事务尚未提交，重启后会话与压缩前完全相同，不需要恢复。
- 符合现有不变量：`events.run_id` 可空，标题事件已是不属于运行的会话级事件；请求重建按 `seq` 回放全部 `context` 事件，下一次运行第一轮的重建请求自然包含摘要与用户原文；“每个会话最多一个活动运行”也不受影响。
- 代价：运行计数不含手动压缩的用量，需要按上节在前端合计与评测报告中单独统计；开发者视图的事件表里这两条事件的“所属运行”为空。

**否决：新建一条运行。** 需要给 `runs` 增加种类列，并在 `get_active`、`list_by_status`、启动扫描、会话状态同步、前端投影（`activeRun`、状态条、终态条、“以相同内容重试”、“按计划执行”判断最新运行）与侧栏逐处排除这种运行；否则压缩期间侧栏会显示“运行中”，API 重启会把它标成“服务重启导致运行中断”，压缩完成后“最新运行”变成一条没有用户消息的 completed 运行。改动面远大于不挂 `run_id`，而它唯一的好处是用量天然进入运行计数，这可以用上节的会话级统计替代。

### 上下文环详情与“立即压缩”

依赖：手动压缩接口；上下文环的裁切与文案修正（记录在 [W5 子计划“完成后界面微调”](w5-ux.md#完成后界面微调2026-09-29)，另一路进行中）完成之后再做。

- 点击上下文环打开详情（popover）：已用与窗口、剩余、最近一轮、压缩水位、已压缩次数与最近一次压缩的触发原因。悬停仍可显示简短说明，键盘可打开与关闭。
- 详情里提供「立即压缩」，执行注册表里同一条 `compact` 命令；禁用条件与原因和 `/compact` 完全一致，不另写一套判断。
- 最近一次压缩晚于最近一轮时，占用显示为压缩后的估算（`after_estimate.total`），并标明“压缩后估算，下一次请求后更新”。

## 改动清单

- API 领域层：`context/` 下提取压缩组件；`AgentLoop` 改为调用它；`CompactEvent.trigger` 增加 `manual`；`ToolEvent.denied_by` 增加 `plan_mode`；新增 `PlanModeGuard`；`Run.mode`；中英文计划模式提示词后缀与压缩结果说明。
- API 应用与接口层：`AgentService.chat()` 接收并校验 `mode`；新增手动压缩的应用服务方法与 `POST /sessions/{id}/compact` 路由及响应结构；事件与运行项 schema 同步 `mode`、`trigger`、`denied_by`。
- 迁移：`runs.mode`。
- 评测脚本：`compute_metrics()` 分开统计带与不带 `run_id` 的压缩；报告显示 `manual` 触发。
- UI：`lib/commands.ts` 注册表；`components/ui/` 拷入 popover 与 command；`ChatInput` 的 `+` 菜单与 `/` 提示；Plan 标记与“按计划执行”；`sessionApi.compact()`；投影读取 `before_estimate` / `after_estimate` 的总量、`trigger`、`mode`、`denied_by: plan_mode`，`usage.session` 计入压缩用量；上下文环详情；组件状态目录补充新状态。
- W4 视图模型契约同步：`RunView.mode`；`compaction` 条目增加 `trigger`；`usage.context` 在压缩后的取值规则；工具调用 `denied` 的第三种来源。

## 验收

**自动测试（ScriptedLLM，后端）：**

1. 计划模式：模型依次调用 `write_file`、`shell_execute`、MCP 工具，三者都回填「计划模式下不执行」且 `denied_by="plan_mode"`，替身沙箱与 MCP 夹具都没有收到调用；同一运行里 `read_file`、`find_files`、`update_plan` 正常执行；运行以 completed 结束，`runs.mode` 为 `plan`。
2. 计划模式拒绝的调用不产生审批事件（`mcp:*` 为 ask 时也一样）。
3. 计划运行之后的普通运行：同样的写入与 Shell 调用正常执行；该运行快照的 `system_prompt` 不含计划模式后缀，记忆里的 system 消息没有被改写。
4. 有活动运行时 chat 带 `mode: "plan"` 返回 409。
5. 手动压缩成功：写入 `compact(trigger=manual)` 与 `context(replace)`，`run_id` 为空，会话状态与运行表不变；替换后首条是摘要，用户原文随后。
6. 可摘要部分很小（水位触发会被最小收益规则跳过的构造）时，手动压缩仍然执行。
7. 只有 1 轮时返回 `skipped` / `no_rounds`，不写事件，记忆不变。
8. 摘要请求连续失败：接口返回错误，不写事件，记忆与压缩前逐字相同。
9. 运行中、等待提问回复、等待审批时各请求一次，均返回 409，记忆不变。
10. 压缩后发一条新消息：新运行第一轮的重建请求（`rebuild_request`）包含摘要与被摘要范围内的用户原文，并与循环实际发出的请求一致。
11. 循环内自动压缩的既有用例（W2 的 `test_context_governance.py`、`test_turn_events_rebuild.py`）在提取后原样通过；临时 PostgreSQL 上 `test_run_events_pg.py` 增加手动压缩的往返用例（无 `run_id` 的两条事件、记忆同事务）。
12. 评测 `compute_metrics()`：带手动压缩的会话 `metrics_consistent` 仍为真，手动压缩单独计数。

**前端：** `tsc --noEmit`、`npm run lint`、`npm run build` 与事件观察脚本通过；观察脚本增加：压缩条目从 `before_estimate` / `after_estimate` 生成、`runId` 为空的压缩条目、`usage.session` 含压缩用量、`denied_by: plan_mode` 的调用状态、`RunView.mode`。

**评测：** 复跑 E1、E3、E7 各 1 次，确认普通运行、提问续接与自动压缩没有回退。

**真实浏览器（Compose 与真实模型）：**

- `/` 提示：开头与空白后触发，路径中的 `/` 不触发；中文输入法组合期间不触发；上下键、Enter、Tab、Esc；执行后 `/xxx` 被移除；无匹配提示；不可用命令显示原因。首页与会话页各走一遍，`+` 菜单与 `/` 提示的命令和原因一致。
- Plan：首页用 `/plan` 发起一个“修改某文件”的任务，Agent 只调研并给出计划，工具卡显示“计划模式下不执行”，沙箱里文件未变；点「按计划执行」后普通运行完成修改。
- 压缩：在一个有多轮历史的空闲会话里用 `/compact` 与上下文环的「立即压缩」各执行一次，时间线出现压缩条目，侧栏状态不变；运行中两个入口都禁用并显示原因；随后发消息，开发者视图第一轮重建请求中能看到摘要。
- 暗色与 390 px 窄屏下提示与菜单可读可操作。

## docs 同步

- [产品说明](../product.md)：输入框命令、Plan 模式、手动压缩；
- [架构说明](../architecture.md)：会话级事件（不属于运行的 `compact` 与 `context`）与手动压缩路径、计划模式的执行前检查；
- [能力与边界](../capabilities.md)：计划模式按工具拒绝、Shell 全部禁止、`update_plan` 不被校验；手动压缩的前提与用量统计方式；
- [代码地图](../code-map.md)：压缩组件、计划模式检查、命令注册表；
- [UI 开发指南](../../ray_agent/ui/README.md) 与 `ui/DESIGN.md`：命令注册表的接入方式、新组件；
- [W4 子计划](w4-ui-data.md#视图模型契约)：契约字段。

以上在实现完成后更新，本计划阶段不改。

## 交接

下游依赖（W10）：命令注册表的 `available` / `run` 接口与 `context` 字段，W10 注册“选择项目”时不改菜单与提示组件；`ChatRequest` 的扩展方式（W10 若需要在首页随 chat 传项目，按同样方式加字段）；提示词环境段与计划模式后缀的拼接位置（W10 按是否绑定项目生成工作目录时在同一处改）。

已知未决：计划模式允许清单是否包含 `get_remote_agent_cards`（本文暂定包含）；手动压缩失败的 HTTP 状态码（暂定 502）；压缩期间持锁导致 chat 等待，若实际体验不可接受，再改为提示“正在压缩”并返回 409。

## 实施修正（2026-09-29，后端）

后端实现与上文设计的差异如下，前端部分另行记录。

1. **`mode` 写在全部 run 事件上：** 设计只要求 `run(running)` 带 `mode`，实现由 `RunLedger` 在 `start()` 与 `transition()` 写入的每条 run 事件（running、waiting、各终态）都带上 `mode`，前端从任意一条 run 事件都能读到运行模式。
2. **模式怎样传到循环：** chat 用 `ledger.start(mode=…)` 把模式写进 `runs.mode`。执行任务的创建签名不变，运行器在 `_prepare_run()` 里从运行行读出模式并设置到循环上，然后才生成配置快照。`PlanModeGuard` 在循环构造时总是注册在 `ToolPolicyGuard` 之前，由循环的 `mode` 开关。因此本包还改了 `agent_task_runner.py`，这个文件不在上文的改动清单里。
3. **允许清单同时匹配工具集：** 清单记录的是“函数名 → 所属工具集”（如 `read_file → file`、`search_web → search`），名称和工具集都对上才放行，MCP 工具即使别名与清单里的函数同名也会被拒绝。拒绝消息全文为「计划模式下不执行：{函数名} 可能产生副作用，本次运行只允许只读调研，该调用未执行。不要换用其他工具绕过；请用 update_plan 写出计划并在回复中说明，用户确认后会以普通模式执行。」。实施前核对过清单里的工具名，与代码中实际注册的名称一致。
4. **计划模式后缀：** 后缀是一段 `<plan_mode>…</plan_mode>`，拼在 system 提示词末尾（中文 `prompts/plan_mode.py`，英文 `prompts/en/plan_mode.py`）。循环里的主请求和上下文估算都用拼接后的消息，记忆里的 system 消息不变。
5. **chat 的 409 条件：** 带 `mode: "plan"` 时，以下两种情况返回 409：活动运行是 waiting；或者活动运行是 running 且执行任务仍在跑这个运行（即会走注入路由）。数据库里 running 但执行任务已不存在的旧运行，按原路由先记为 interrupted 再新建运行，此时计划模式照常生效。等待审批的运行本来就不接受任何模式的消息，仍由既有检查返回 409。`ChatRequest.mode` 取其他值时返回 422。
6. **压缩组件的接口：** 提取为 `context/compactor.py` 的 `Compactor`。它的输入是请求消息、工具 schema、压缩前估算、触发原因、按需读取用户消息事件的回调，以及 `min_gain` 开关；输出 `CompactionResult`，状态为 compacted、skipped 或 failed，跳过原因为 `no_rounds` 或 `min_gain`。设计里的“估算函数”这一项输入由调用方先算好估算再传入，组件另提供 `fresh_budget()`，按字符估算压缩后的占用。判断模型错误能否重试的函数从 `agent_loop.py` 移到 `domain/external/llm.py`（`is_retryable`），供循环与组件共用。
7. **手动压缩的估算来源：** “最后一次运行”指会话里 `started_at` 最晚的运行，工具 schema 用 `tools_for_turn(快照, turns + 1)` 取；会话没有运行时工具为空。system 取记忆里的原文、不加计划模式后缀，因为下一次运行是什么模式事先无法确定。
8. **手动压缩的响应结构：** `data` 为 `status`（`compacted` / `skipped`）、`reason`（skipped 时为 `no_rounds`，否则为空）、`message`、`compact_seq`、`context_seq`、`before_total`、`after_total`、`summarized_turns`、`kept_turns`，skipped 时后六项为空。失败时 HTTP 状态码与 `code` 都是 502，`msg` 为“摘要请求连续 N 次失败或返回空内容，上下文没有改变”，`data` 为 `{}`。409 与 404 沿用既有的错误结构。
9. **评测统计的字段：** `compute_metrics()` 新增 `compactions_by_trigger`、`manual_compactions`、`manual_compaction_requests`、`manual_compaction_prompt_tokens`、`manual_compaction_completion_tokens`；原有的 `compactions` 与 `compaction_requests` 只统计带 `run_id` 的压缩。报告按运行显示“压缩触发”，并单列一行“手动压缩”。原有评测用例里手写的自动压缩事件没有 `run_id`，与真实形状不符，已补上。
10. **测试位置：** 验收 1–10 在 `tests/core/test_plan_mode_and_compact.py`，另含接口响应形状与 compact 事件序列化的用例；验收 12 并入 `test_eval_script.py`；验收 11 的往返用例加在 `test_run_events_pg.py`，还增加了一项核对：提交阶段失败时，两条事件与记忆一起回滚。
11. **前端字段不一致（已确认）：** 后端 compact 事件的 payload 与 SSE `data` 只有 `before_estimate` / `after_estimate` 两个对象，总量在其中的 `total`，没有 `before_tokens` / `after_tokens`。当前前端投影读取的是后两个字段，因此压缩条目取不到数值。证据是临时 PostgreSQL 中 events 表的实际 payload，以及 `test_compact_sse_payload_uses_estimate_objects` 用例。前端按上文改动清单改为读取 `before_estimate.total` / `after_estimate.total`。

## 实施修正（2026-09-29，前端第一批）

1. **注册表与触发：** 注册表在 `lib/commands.ts`（`InputCommand`、`CommandContext`、`CommandHost`、`inputCommands`），`/` 的触发判定与片段移除是 `lib/slash-trigger.ts` 的纯函数，菜单与提示共用 `components/input-command-menu.tsx`。本批只注册「上传附件」（`/upload`，别名 `attach`），不可用原因为“正在上传”“正在等待审批”。
2. **不可用项不用 cmdk 的 `disabled`：** `disabled` 会让方向键跳过该项，读屏读不到原因；实现为照常可高亮、条目内显示原因、Enter 不执行。
3. **组件来源：** `npx shadcn@latest add popover command`（CLI 4.21.0）；生成代码的 `cn` 改回 `@/lib/utils`，popover 改用 `@radix-ui/react-popover`，CLI 顺带改写的 `dialog.tsx` 已恢复。锁定 `cmdk@1.1.1`、`@radix-ui/react-popover@1.1.15`。
4. **已跑：** `tsc --noEmit`、`npm run lint`（0 错误，22 条既有警告不在本批文件）、`node scripts/check-slash-trigger.cjs`、`node scripts/check-event-observability.cjs` 通过。未跑 `npm run build`，未做浏览器走查。

## 前端第二批的已定细节（2026-09-29 协调者决定，接手者按此实施）

以下是在后端已实现的前提下对上文“设计”的细化，不再需要另行决策；与源码冲突时记入实施修正。

- **`CommandContext` 扩展：** 增加 `hasRuns`（会话已有至少一次运行）、`compacting`、`planMode`（输入框当前是否带计划模式标记），`actions` 增加 `togglePlan()`、`compact()`。`CommandHost` 由页面提供 `hasRuns`；首页固定为 `hasSession: false, hasRuns: false`。注册顺序：上传附件、Plan、压缩上下文（W10 的选择项目排最后）。
- **Plan 命令：** `/plan`，别名 `plan-mode`、搜索词“计划”。`run` 切换 `planMode`；输入框工具行显示可移除的“计划模式”标记（再次执行命令或点标记上的关闭都会取消）。不可用：`runStatus` 为 running 或 waiting（原因按上文命令表），等待审批。发送时 `sessionApi.chat` 带 `mode: 'plan'`，发送成功后清除标记；首页在第一次 chat 里带上。chat 返回 409 时保留标记与输入内容，提示条显示后端 `msg`。
- **压缩命令：** `/compact`，别名 `compress`、搜索词“压缩”“上下文”。`run` 调 `sessionApi.compact(sessionId)`（`POST /sessions/{id}/compact`，无请求体）。不可用原因依次判断：没有会话或 `hasRuns` 为假 →“还没有可压缩的上下文”；running →“运行进行中，结束后才能压缩”；waiting（提问或审批）→“正在等待回复，结束后才能压缩”；`compacting` →“正在压缩”。结果用现有 sonner 提示条：`compacted` 显示后端 `message`，`skipped` 显示后端 `message`（中性样式，不算错误），409/502 显示后端 `msg`（错误样式）。压缩期间禁用发送按钮。时间线靠事件流里的 `compact` 事件更新，不在前端伪造条目。
- **投影修正（`lib/session-projection.ts`，W4 契约同步）：** 压缩条目改读 `data.before_estimate.total` / `data.after_estimate.total` 与 `data.trigger`，`runId` 可为空；`usage.session` = 各轮用量 + 会话内全部 `compact.usage`；`RunView.mode` 取 run 事件的 `mode`（缺省 `normal`）；工具调用 `denied_by === 'plan_mode'` 时状态为已拒绝、来源文案“计划模式下不执行”。时间线压缩条目文案：`manual`“你手动压缩了上下文”，`watermark`“上下文接近上限，已自动压缩”，`overflow`“请求超出窗口，已压缩后重试”。观察脚本 `check-event-observability.cjs` 为这四处各加用例，夹具改用后端真实形状。
- **计划模式展示：** 活动运行 `mode === 'plan'` 时状态条显示“计划模式”标记；开发者视图的运行信息显示 `mode`。
- **「按计划执行」：** 放在终态条（`run-end-bar.tsx`）。条件：最新运行 `mode === 'plan'` 且 `completed`，会话没有活动运行。点击以普通模式发送固定文案“按计划执行”，与“以相同内容重试”同一发送路径。
- **上下文环详情：** 环改为 Popover 触发按钮（可访问名称沿用现有），悬停仍显示简短说明。详情内容按上文“上下文环详情”一节；「立即压缩」按钮调用注册表里 `id === 'compact'` 那一项的 `available(ctx)` 与 `run(ctx)`，不另写判断，不可用时按钮禁用并显示同一句原因。最近一次压缩的 `seq` 大于最近一轮 `turn(started)` 时，占用显示 `after_estimate.total` 并标“压缩后估算，下一次请求后更新”。
- **组件状态目录：** `components/dev/component-catalog.tsx` 补 Plan 标记、压缩命令的可用与不可用、上下文环详情（未压缩、已压缩、压缩后估算）、手动压缩时间线条目。

## 实施修正（2026-09-29，前端第二批）

1. **`RunView.mode` 可选：** 投影对缺省 `mode` 的运行写 `normal`；手写夹具未批量补 `mode` 字段，组件侧用 `run.mode === 'plan'` 判断。
2. **`UsageView` 扩展：** 除契约中的 `session` / `context` 外，增加 `lastCompaction`（详情 popover 的最近触发与估算）与 `context.postCompactEstimate`（压缩晚于最近一轮 `turn(started)` 时的占用说明）。
3. **首页计划模式：** `init` 参数 JSON 增加可选 `mode: "plan"`，会话页首次 `chat` 传入；未改 `use-session-detail` 的对外类型名，仅在 `sendMessage` 第三参增加 `mode`。
4. **上下文环 `commandContext`：** 会话页为环单独构造 `CommandContext`（`planMode` 固定 false，不影响压缩可用性）；`togglePlan` / `openFilePicker` 为空操作，仅「立即压缩」走注册表。
5. **「按计划执行」位置：** 协调者要求放在 `run-end-bar.tsx` 组件文件内的 `PlanExecuteBar`，渲染在时间线列表末尾（最终回复之后），而非 `run_end` 条目内。
6. **已跑：** `npx tsc --noEmit`、`npm run lint`（0 错误，22 条既有警告）、`node scripts/check-event-observability.cjs`、`node scripts/check-slash-trigger.cjs` 通过。未跑 `npm run build`，未做浏览器走查。

## 审计返工（2026-09-30）

本节是当前有效的返工契约，覆盖上文同主题的历史设计、已定细节与实施修正。交互比较基线为 `d06a1a8`；审计覆盖指定起点 `45bc73b` 本身及之后至 `fad30c0` 的提交。现有 Plan 拦截、压缩事务与调用配对值得保留，但自动测试通过不能推出后端无需返工。审计证据见总计划。

**U1 输入入口按操作用途呈现。**

- `+` 是紧凑菜单，去搜索框、常驻长说明与 `/keyword`；每行图标和短名称，宽度不超过 14rem。用“计划模式”替换单独英文 Plan。
- 恢复回形针直接上传；`/upload` 保留。命令注册表增加 surfaces（plus/slash），同一操作的可用性和原因仍共用判断。
- `/` 保留筛选、关键字和一句短说明，不把注册表复用等同于两处必须同样布局。不可用项可聚焦读出原因、不可执行；桌面悬停、键盘聚焦与触屏点说明入口都可看原因，不依赖尚未实现的长按事件。
- 项目入口交由 W11 的打开项目流程，未配置/请求失败仍可发现，不用静默过滤；是否显示某命令与执行可用性分别定义。

| 短名称 | 输入框 `+` | 斜杠命令 | 操作 |
|---|---|---|---|
| 上传附件 | 显示，另有回形针直接入口 | `/upload`（保留 `/attach`） | 选择下一条消息附件 |
| 计划模式 | 显示 | `/plan` | 切换下一次运行模式，不建对话 |
| 压缩上下文 | 显示 | `/compact` | 按 U5 手动压缩，无有效上下文或有活动运行时说明原因 |
| 打开项目 | 显示 | `/project` | 打开 W11 项目导航/选择器，保留当前草稿，不修改已有对话归属 |

“打开项目”本身是导航操作，不因已有运行或未配置根目录而消失/禁用；选择器内再解释配置或目录不可用，禁止不可用项目的新运行。移除旧注册表按 `projectBindable` 限制打开入口的判断。四项共用状态和动作，不为了填菜单新增命令；其余既有别名继续兼容。

**U2 上下文环的交互与信息层级。**

- 日常只显示 18px 圆环，以弧长表达占用；去掉旁边的“上下文”及 `28%` 一类数字，也不在环中心放数字。圆环保留清晰按钮命中区域（桌面至少 28px，触屏至少 44px）与焦点样式，视觉尺寸不随命中区域变大。
- 低占用沿用中性/强调色，接近压缩水位才用等待色，实际超限用失败色；无数据用中性虚线环，不能伪装成 0%。圈内刻度仅表达已有自动压缩检查水位，不增加独立图标或常驻说明。
- 悬停/聚焦显示简短数据表：占用百分比、已用与窗口、剩余、最近一轮、自动压缩检查水位。点击弹层包含同一数据与“压缩上下文”，触屏也能读全数据。数据不足显示原因；压缩历史与详细预算按需展开，日常入口不放整段实现原理。
- Tooltip 与 Popover 共享 U3 的真实数据源；弹层打开时 Tooltip 不再出现，Esc 关闭并还原焦点。读屏标签保留占用、数据来源与可用性，不能因为视觉去掉文字而丢失可访问名称。

**U3 修正数据口径（包含视图模型与后端事件契约）。**

当前 `usageContext` 优先估算，即使 completed turn 已有真实 prompt usage；合成输入估算 1000、真实 prompt 4000，实际投影 usedTokens=1000。不得继续无条件标为“最近一次请求实际占用”。

- 已完成请求有 prompt usage 时展示该请求的实测输入，缺失时显示请求前估算；正在请求、压缩后估算各有明确 source 标记，数字、aria-label 与提示一致。
- window、max_tokens、输入上限、watermark、used 必须来自同一快照，不将手动压缩的当前配置估算与历史窗口拼接。手动 compact 事件的 after_estimate 已含窗口/上限等，应投影保留；改模型配置后明确旧快照，不假称当前配置。
- “剩余”区分窗口减输入量与本次可用输入余量，后者扣除输出预留与安全余量；详细预算按需展开。
- 刻度只说明“下次请求前检查，可能自动压缩”。实测输入与预算估算不同，不能承诺环过刻度必触发。压缩后可比数据尚无时不计算假百分比。
- 正常/无数据/无 usage/运行中/压缩后/模型配置变化/超过容量均加实际投影用例；不只检查 SVG 毛刺。

**U4 命令状态只维护一份。**

由 ChatInput 提供真实 command context 给附件/命令/上下文环；去掉会话页伪造的 planMode=false 与空 action。判断包含提交、上传、活动运行、等待审批、压缩中等。前端只预判断，服务端仍负责拒绝并发冲突。压缩期间另一标签应能识别忙碌原因。

**U5 手动压缩的耗时与恢复（后端返工）。**

当前接口同步持锁做摘要，UI 统一 30 秒超时；超过 30 秒客户端可能报失败，而服务端仍执行或等待，不能把此项降为已知小问题。

- 首版保留同步压缩与原子事务，不为此新建运行/调度系统。设摘要总期限和独立的前端超时，前端期限大于服务端总期限（例如 60 秒与 70 秒，包含重试与提交余量）；限制重试总时长，不只限制单次请求。
- 会话详情增加可读的临时 context_operation 状态（idle/compacting 与开始时间，单进程标记，不新建 run），读取不等摘要锁；压缩中 chat/第二次 compact 及时返回 409 与忙碌原因，不在会话锁外无限等待。忙碌标记和异常/取消释放需覆盖，保持单进程适用边界，不做多实例调度。
- 客户端超时后读回 compact/context seq 与 operation 状态，再判断成功、仍处理或未改变；不得自动再次压缩。断连、摘要超时/空结果、失败、取消都不写半份记忆或半份事件。
- 6294→6312 这样的增大不是“腾出空间”。保留历史决定的手动强制摘要语义，但成功提示写“已摘要，估算空间未减少”，时间线同口径；不可摘要是跳过而非失败。下一真实请求更新数据源。

**U6 按计划执行只在有效计划后出现。**

目前条件只是最新 plan run completed，没有验证 update_plan 是否产出有效计划，却显示“计划已写好”。只在该 plan run 确实产出非空可执行清单时出现；没有计划、失败或仅完成回答时不出现。使用现有计划 id/更新时间关联来源，拒绝拿旧 run 的计划充当新计划。

执行沿用下一次普通运行和现有工具审批，不把按钮当作对所有操作的永久审批。执行后到达 waiting_reply 是合法路径，需要可继续回复；验收另用目标完整的确定性任务走到 completed。不为此建设计划版本平台。

**U7 验证与 docs。**

- 实际投影用例验证 U3、U6，延迟摘要/并发/断连验证 U5，使用现有循环与持久化替身；相关后端测试与 UI 类型、lint、build、两个观察脚本通过。
- 真实浏览器走查回形针、轻量 `+`、`/`、纯圆环入口及悬停/点击数据与压缩结果、无有效计划/有有效计划/等待回复后续接；桌面浅色/深色、390×844、键盘与触屏路径均覆盖。截图确认圆环旁与环内均无常驻标签/百分比，无数据不显示假 0%。
- 与基线同位置比较截图，不以“元素存在、没有报错”代替操作步数、信息密度和作用域评审。既有 [w9-live](evidence/w9-live-2026-09-29.md) 只是当时记录，不是上述缺口已经通过。
- 实现后更新 DESIGN、组件目录、W4 数据来源契约、能力边界与服务指南；本轮计划阶段不将目标写为已落地事实。

本包完成需 U1–U7 及仍适用的原验收；原验收“+ 与 / 完全一致”改为共有操作语义一致，布局按入口不同。项目生命周期与归属由 W11 负责，chat 启动由 W10 负责。
