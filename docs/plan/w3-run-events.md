# W3：运行与事件事实源

所属：[二次开发总计划](README.md)。前置：W1。规模：中到大，2 个对话——对话一完成表、写入顺序、状态、停止与启动扫描；对话二完成轮次事件与运行指标、请求重建、SSE 接口与评测脚本适配。可与 W2 并行。

## 目标与不做

**目标：** 每次运行有独立身份和明确终态；事件以数据库为事实源、按会话内序号保存；每一轮模型请求有带时间与用量的边界事件；每次模型请求的内容都能由事件重建；页面断线或刷新后能按序号补齐；停止真正向下传播到沙箱进程；API 重启后不留下“永远在运行”的会话。

**不做：** 多实例执行所有权与租约、请求去重、调用级持久意图与 unknown 对账、自动恢复执行、旧数据迁移。记忆继续存放在 sessions 行上（W2 压缩后大小有界）。

## 现状

以下是 W3 实施前的代码事实，对应已提交的 W1 `8511bdf`。该提交里事件仍在会话行的 JSONB 上，停止仍写 completed；下列文件在 W3 中已改写，行号不再指向当前源码，按需用 `git show 8511bdf:<路径>` 查看。

- 会话状态只有 pending / running / waiting / completed / failed，停止写 completed（`application/services/agent_service.py`、`domain/services/agent_task_runner.py`）。
- events、files、memories 都是 sessions 行上的 JSONB 数组（`infrastructure/models/session.py`）；`add_event` 追加数组，`get_by_id` 读取整行（`infrastructure/repositories/db_session_repository.py`）。
- 事件先写 Redis 输出流、取得 stream ID 作为事件 ID，再写数据库。`chat` 接口把“提交消息”和“读取输出流”放在同一个 SSE 请求里；前端在流结束后用空消息请求反复重连（`ui/src/hooks/use-session-detail.ts`）。
- 执行中的任务只登记在进程内注册表（`infrastructure/external/task/redis_stream_task.py`），应用启动时执行 Alembic 迁移后不检查遗留状态（`main.py`）。
- 沙箱已提供按 Shell 会话终止进程的接口，API 侧有 `shell_kill_process` 工具。

## 设计

### 数据

新增两张表，通过新的 Alembic 迁移建立；同一迁移删除 sessions 上的 events 列。开发库按服务指南重建，不转换旧数据。

**runs：** `id`、`session_id`、`status`、`reason`（可空）、`started_at`、`ended_at`（毫秒精度）、`turns`、`model_requests`、`tool_calls`、`prompt_tokens`、`completion_tokens`、`cached_tokens`（供应商不返回时为空；本次没有缓存数据时不把已有值改成 0）、`config_snapshot`（JSONB）。快照字段为 `model_name`、`temperature`、`max_tokens`、`context_window`、`agent_config`、`system_prompt`、`tools`；续接时工具 schema 有变化则追加 `tool_revisions`（`from_turn` 与新的 `tools`）。原因代码见交接。

**events：** `session_id`、`seq`（会话内从 1 递增）、`run_id`（可空；用户消息写入时带上处理它的运行）、`type`、`payload`（JSONB，存放除 `seq`、`run_id`、`type`、`created_at` 以外的字段，含事件 `id`）、`created_at`（`timestamp(3)`）。主键 `(session_id, seq)`，`run_id` 外键指向 `runs.id`，会话或运行删除时级联。`seq` 在插入时取该会话 `max(seq)+1`，主键冲突只回滚本次插入的保存点并重试，最多 50 次。

**约束：** 每个会话最多一个状态为 running 或 waiting 的运行，用部分唯一索引保证。

**会话状态：** sessions.status 保留，作为最新运行状态的冗余副本，与运行状态在同一事务更新，供会话列表使用。

### 状态

| 状态 | 含义 | 进入方式 |
|---|---|---|
| running | 执行协程在运行 | 创建运行 |
| waiting | 等待用户回复提问（W7.2 起也包括等待审批） | 循环发出等待 |
| completed | 循环正常结束，得到最终回复 | 循环结束 |
| failed | 预算、上下文、截断或未处理异常 | 循环或运行器 |
| cancelled | 用户停止 | 停止接口 |
| interrupted | API 进程在运行中退出 | 启动扫描 |

终态不可再改。waiting 的运行收到回复后回到 running，继续同一个运行 ID；completed、failed、cancelled、interrupted 之后的新消息创建新运行。`completed` 只表示循环正常结束，不表示目标达成。`sessions.status` 与运行状态同名，另有 `pending`（尚无运行）。

原因代码：`max_iterations`、`output_truncated`、`model_error`、`runner_error`（运行器未处理异常或创建任务失败）、`user_stop`、`api_restart`、`runner_lost`（库中仍是 running，但本进程已没有执行协程）。`context_limit` 留给 W2，本包只保留常量。

### 轮次与运行事件

一轮指一次模型请求（含传输重试）及其返回的工具批次。压缩摘要请求不算一轮（W2）；其用量不在本包。删除 `UsageEvent`，用量改由轮次结束事件携带。另有 `context`（模型历史变化，请求重建回放它）与 `cleanup`（停止后的收尾结果）。

| 类型 | 时机 | 字段 |
|---|---|---|
| `turn`（phase=started） | 模型请求发出前 | `index`（运行内从 1 递增）、`context_window`（本轮模型窗口）、`context_estimate`（W2 的四部分估算；未合入时为空）。`ttft_ms` 尚未设字段，留给 W6 |
| `turn`（phase=completed） | 工具批次全部有结果后、提问中止批次、截断丢弃或请求失败后；进入终态时若最后一轮只有 started，账本在同一事务补写 | `index`、`model_ms`（各次尝试耗时合计，不含重试间隔）、`attempts`（本轮发出的模型请求次数，含重试）、`usage`（prompt、completion、cached、reasoning，缺失项为空）、`finish_reason`、`tool_call_ids`（本轮有 `called` 事件的调用）、`tools_ms`、`error`（失败或被终态截断时的原因代码） |
| `run` | 运行创建与每次状态变化 | `status`、`reason`；进入终态时附 `summary`：`duration_ms`、`turns`、`model_requests`、`tool_calls`、`prompt_tokens`、`completion_tokens`、`cached_tokens` |
| `context` | 模型历史每次变化先于下一次请求 | `op` 为 `append`（消息全文）或 `compact`。推给页面时只留 `message_count` 与 `roles`，全文只在库和请求重建接口里 |
| `cleanup` | 停止收尾完成之后 | `targets`：`kind`（`shell` 或 `a2a`）、`id`、`success`、`message`。允许写在终态之后，失败不改运行终态 |

`ToolEvent` 的 `called` 保留 W1 写入的耗时与 W2 写入的整形元数据。所有事件的 `created_at` 为毫秒精度，界面的用时与速率只由这些字段计算。

### 请求重建

**不变量：** 每次模型请求发送的消息列表，都能由该运行的 `config_snapshot`（系统提示词与工具 schema）加上会话事件按固定规则重建，结果与实际发送的内容逐字相同。新增会影响模型输入的内容（注入的补充要求、压缩摘要、悬空调用补的结果）都必须先成为事件。

- 实现 `rebuild_request`：system 消息取该运行快照里的系统提示词全文；再按 `seq` 回放该轮 `turn(started)` 之前的全部 `context` 事件（`append` 追加，`compact` 走 `Memory.compact`）；工具 schema 取快照中适用于该轮的列表（含 `tool_revisions`）。找不到该轮时返回未找到；
- 测试中用 `ScriptedLLM` 记录实际收到的请求，与重建结果逐项比较，覆盖普通多轮、提问续接、运行中注入、停止后续接；W2 合入后追加压缩后的请求；
- 调试读取接口 `GET /sessions/{id}/runs/{run_id}/turns/{index}/request` 返回重建结果，供开发者视图使用；接口只读，不重放任何动作。

### 写入与通知

1. 运行器把事件与需要同步更新的状态写入数据库，在同一事务中提交；
2. 提交成功后向 Redis 发布通知，内容只有 `session_id` 与 `seq`；
3. 通知失败只记日志，不回滚事件，也不重放动作。

Redis 输出流退役；输入流保留，用于提交消息与运行中补充消息。

### 接口

- `POST /sessions/{id}/chat`：写入用户消息事件，按状态创建新运行、续接等待中的运行或注入到运行中的运行，返回 `{run_id, seq, route}`。`route` 为 `started`、`resumed` 或 `injected`。不再承担事件流；
- `GET /sessions/{id}/events?after_seq=N`（SSE）：先从数据库按序号推送 `seq > N` 的全部事件（每页 200），再订阅通知；订阅建立后再查一次，补上订阅建立前的空档；之后每收到通知或每 3 秒兜底查询一次。查询参数省略时用请求头 `Last-Event-ID`（须为数字），否则从 0 开始。每条 SSE 的 `id` 就是 `seq`，连接每 15 秒 ping，不主动结束；
- `GET /sessions/{id}`：返回会话基本信息、全部运行（状态、原因、起止毫秒时间与计数）与 `after_seq` 之后的事件；`limit` 可选（1–5000），另返回 `last_seq`；
- `GET /sessions/{id}/runs/{run_id}/turns/{index}/request`：见“请求重建”，响应含 `run_id`、`index`、`turn_seq`、`messages`、`tools`；
- `POST /sessions/{id}/stop`：见下节；没有活动运行时 `data` 为空，否则为 `{run_id}`。

SSE 事件数据中带上 `seq`、`run_id` 与毫秒 `created_at`。接口 schema 与前端类型同步修改；W0 评测脚本同步改为使用新接口。Redis 通知频道为 `session:events:{session_id}`，内容只有 `session_id` 与 `seq`。

### 停止与启动扫描

**停止：** 在会话锁内、一个事务里把运行置为 cancelled（原因 `user_stop`），若最后一轮只有 started 则先补写它的 completed，再写入终态 `run` 事件，然后取消执行协程。运行器在分发 `shell_execute` 的 `calling` 时登记 Shell 会话 ID；停止后逐个调用沙箱终止接口，最多等待 10 秒让协程退出，并收集 A2A 已有的远端取消结果，写入一条 `cleanup` 事件（允许出现在终态之后）。终止失败不改变运行终态。停止不回滚已写入的文件。带 `run_id` 的迟到事件在运行已是终态时整笔丢弃。

**启动扫描：** 应用完成迁移并初始化 Redis 与 PostgreSQL 之后、开始接收请求前，把所有 running 状态的运行置为 interrupted（原因 `api_restart`）并写入终态事件；waiting 状态保持，用户回复后照常续接。不自动重新执行任何运行。若数据库里仍是 running 而本进程已没有执行协程（例如停止请求落到了别的进程），下一次 `chat` 先把该运行标为 interrupted（原因 `runner_lost`），再创建新运行。

## 改动清单

- Alembic 新迁移；ORM 模型 runs、events；仓库接口与实现（运行仓库、事件仓库）；UoW 增加对应仓库；
- 领域模型：`Run`、运行状态枚举、`turn`、`run`、`context` 与 `cleanup` 事件，删除 `UsageEvent`；会话模型去掉 events 字段，需要事件的地方改用事件仓库；进程内会话锁串行化消息路由与运行收尾；
- 循环层：发出轮次事件，记录请求耗时与用量；运行开始时写入 `config_snapshot`；
- 请求重建函数与测试；
- 运行器：事件写入顺序、运行状态迁移与汇总、Shell 会话登记、终止传播；
- 应用服务与路由：chat、events SSE、stop、会话详情、请求重建读取；
- Redis：通知发布与订阅（pub/sub）；输出流相关代码删除；
- 启动流程：扫描遗留运行；
- 评测脚本：改用新接口；
- 前端：本包只保证旧页面在接口变更后不崩溃（最小适配 chat 返回值与 SSE 地址），完整改造归 W4。

## 验收

**自动测试（真实临时 PostgreSQL，按 API 指南准备测试库）：**

1. 同一会话并发写入 100 条事件，seq 连续且不重复；
2. 同一会话无法同时存在两个活动运行；
3. 事件与状态同事务：模拟提交失败时两者都不可见，且不发布通知；
4. 启动扫描把 running 置为 interrupted，waiting 保持不变；
5. 停止：运行变为 cancelled，登记的 Shell 会话收到终止请求（沙箱用替身），终态不被迟到的完成事件覆盖；
6. SSE：从 `after_seq` 补齐、订阅空档补齐、丢弃一次通知后由兜底查询补上；
7. 轮次事件：一次含两个调用的运行产生成对的 started/completed，`index` 连续，`tool_call_ids` 与工具事件一致；提问中止的批次也有 completed；终态 `run` 事件的汇总与各轮之和一致；
8. 请求重建：见“请求重建”列出的场景，重建结果与实际请求逐字相同。

**评测：** 复跑 E1–E6；评测报告的模型调用次数与 tokens 改为从 `run` 汇总读取，并与逐轮累加核对；E4 检查终态为 cancelled，停止后标记是否继续增长（Shell 阻塞缺陷在 W7.1 修复前可能影响结果，如实记录）。

**手动：** 任务运行中重启 API 容器，刷新页面看到 interrupted；等待回复时重启，回复后能继续。

## docs 同步

- [架构说明](../architecture.md)：“结束路径与控制平面”“状态与持久化”“事件与投影”中的状态、写入顺序与接口；
- [Harness 工程](../harness.md)：“观测与控制”“状态与持久化”“发布与提交不是一个事务”；
- [设计取舍](../decisions.md)：“取消不引入独立终态”改写为新选择，保留旧代价说明；
- [能力与边界](../capabilities.md)：取消、事件流、SSE 重连、恢复相关条目及未验证范围；
- [代码地图](../code-map.md)：状态与持久化、任务控制、事件分组；
- [API 开发指南](../../ray_agent/api/README.md)、[运行指南](../../ray_agent/README.md)：新库初始化方式与重建说明；
- `state-ownership.svg`、`task-exits.svg`、`architecture-overview.svg` 图注标明旧基线示意，W8 重绘。

## 交接

下游依赖：events SSE 与事件数据中的 `seq`、`run_id`；运行状态、原因与汇总；`turn` 事件字段（W4 据此计算用时与每轮用量；`attempts` 已写入，W6 增加 `ttft_ms`，当前没有该字段）；请求重建接口（W5 开发者视图）；通知通道（W6 的流式增量复用它，增量不落库）；Shell 会话登记（W7.1 的进程收尾复用）。`context_estimate` 与原因 `context_limit` 留给 W2，当前估算恒为空。

交接接口（2026-09-28 实现）：

- **表：** 迁移 `5b7e2c9d4a10`（修订 `0e0d242438bc`）。`runs` 主键 `id`；`session_id` 外键级联；部分唯一索引 `uq_runs_active_session`（`status IN ('running','waiting')`）。`events` 主键 `(session_id, seq)`；`run_id` 可空且外键级联。`sessions.events` 列删除，不转换旧 JSONB。
- **写入入口：** [`RunLedger`](../../ray_agent/api/app/domain/services/run_ledger.py)。`append` 同事务写事件；带 `run_id` 时先锁运行行，已是终态则丢弃并返回空列表，`after_terminal=True` 只给 `cleanup`。`start` 创建运行并写 `run(running)`。`transition` 改活动运行；进入终态时用 `turn_closer(index, error)` 补最后一条未完成轮次，汇总取运行行。`interrupt_running` 只处理 running。计数在同一事务累加：`turn(started)` 加 `turns`，`turn(completed)` 按 `attempts` 与 `usage` 加模型请求和 tokens，`tool(called)` 加 `tool_calls`。
- **通知：** [`EventNotifier`](../../ray_agent/api/app/domain/external/event_notifier.py)。`publish(session_id, seq)` 失败只记日志。Redis 实现频道 `session:events:{session_id}`，载荷 `{"session_id","seq"}`。`subscribe` 在收到订阅确认后返回；`get(timeout)` 返回 seq 或超时 `None`。
- **SSE：** `GET /api/sessions/{id}/events`。查询参数 `after_seq`（≥0）优先于请求头 `Last-Event-ID`；省略时头为数字则用它，否则 0。先按 `seq > N` 补库（每页 200），订阅后再补一次空档，之后通知或每 3 秒再查。SSE `id` 为 `seq`，`event` 为类型，`data` 含 `event_id`、`seq`、`run_id`、毫秒 `created_at` 及类型字段。`context` 的 `data` 只有 `op`、`message_count`、`roles`。`cleanup` 没有专用 SSE 类，走通用映射，`targets` 在 `data` 里。`ping` 15 秒。
- **chat：** `POST /api/sessions/{id}/chat` 返回 `run_id`、`seq`（用户消息事件）、`route`（`started` / `resumed` / `injected`）。路由在进程内会话锁里决定：running 且本进程任务仍在执行该运行 → `injected`；waiting → 同一运行回到 running，`resumed`；库中 running 但没有执行协程 → 先 `interrupted`/`runner_lost`，再 `started`。
- **会话详情：** `GET /api/sessions/{id}?after_seq=&limit=`。`runs[]` 含状态、原因、起止毫秒时间与计数字段；`events` 为 `seq > after_seq`；`last_seq` 为当前最大序号。`limit` 默认不限制，上限 5000。
- **请求重建：** `GET /api/sessions/{id}/runs/{run_id}/turns/{index}/request` 只读。`rebuild_request(events, run, index)` 要求事件里有该运行该序号的 `turn(started)`；system 取 `config_snapshot.system_prompt`；回放 `seq` 更小的 `context`；工具用 `tools_for_turn`。响应为 `run_id`、`index`、`turn_seq`、`messages`、`tools`。
- **轮次字段：** started：`index`、`context_window`、`context_estimate`（现为 `null`）。completed：`index`、`model_ms`、`attempts`、`usage`（`prompt_tokens`、`completion_tokens`、`cached_tokens`、`reasoning_tokens`）、`finish_reason`、`tool_call_ids`、`tools_ms`、`error`。没有 `ttft_ms`。
- **运行汇总：** 终态 `run.summary` 与运行行一致：`duration_ms`、`turns`、`model_requests`、`tool_calls`、`prompt_tokens`、`completion_tokens`、`cached_tokens`（全程无缓存数据时为 `null`）。
- **停止传播：** `POST /api/sessions/{id}/stop`。活动运行改为 `cancelled`/`user_stop` 后 `task.cancel()`；运行器 `stop_processes` 对登记的 Shell 会话调用沙箱 `kill_process`，最多等 10 秒，并把 A2A `last_cancellations` 一并写入 `cleanup`。没有活动运行时响应 `data` 为 `null`。登记发生在 `shell_execute` 的 `calling` 事件，会话 ID 取参数 `session_id`，只活在当前进程。
- **启动扫描：** [`main.py`](../../ray_agent/api/app/main.py) 在迁移和 Redis、PostgreSQL 初始化之后、`yield` 之前调用 `interrupt_running`，原因 `api_restart`。不终止沙箱进程，不恢复执行。

## 实施修正（2026-09-28）

实施中以代码为准修正了本文以下内容：

1. “现状”改为标注 W1 提交 `8511bdf` 的快照，去掉已失效的行号链接。
2. `runs` 增加 `turns`；`cached_tokens` 在没有新缓存数据时保持原值；`events.run_id` 外键级联；`seq` 冲突在保存点内重试，最多 50 次。
3. 终态补齐未完成轮次：原文只在批次结束或提问时写 `turn(completed)`。停止、中断和运行器异常会截断正在进行的轮次，账本在终态事务里补写 completed，因此正常终态运行的轮次成对。`attempts` 随重试一并写入，不再留到 W6；`ttft_ms` 仍无字段。
4. 增加 `context` 与 `cleanup` 两种事件。请求重建回放 `context`，而不是从会话记忆字段反推；停止收尾写入 `cleanup`，且允许出现在终态之后。
5. `chat` 增加 `route`；库中 running 但本进程没有执行协程时记 `runner_lost`。SSE 支持 `Last-Event-ID`，`id` 即 `seq`，补查每页 200 条、兜底间隔 3 秒、ping 15 秒。
6. 续接时工具 schema 变化写入 `config_snapshot.tool_revisions`，重建按轮次取对应 schema。
7. 原因代码补上 `model_error`、`runner_error`、`runner_lost`；`context_limit` 只保留常量。
8. 验收 5（停止与 Shell 终止）和验收 7（轮次成对与汇总）在内存替身用例里（`test_task_execution_control.py`、`test_turn_events_rebuild.py`）。`test_run_events_pg.py` 覆盖验收 1–4、6 与快照往返；未设置 `RAY_TEST_DATABASE_URI` 时跳过，且会清空目标库的 `public` schema。

## 执行效率修订（2026-10-08，已批准）

浏览器展示扩展为可选截图、正文、页面元信息和 outcome，持久化与 SSE 同源；保留旧截图事件读取。显式截图登记会话文件，事件保存 run/call 关联及尺寸、字节、捕获时间；截图是用户可下载产物，暂不作为模型视觉输入。每运行最多 8 次捕获尝试/24 MiB，单张 8 MiB/1600 万像素/最长边 8192，总捕获与存储预算 20 秒；历史截图不清理。

验收：覆盖受影响契约的定向检查，与受控页面读数、表单读回和产物展示共同核对；证据和进度只登记总计划。
