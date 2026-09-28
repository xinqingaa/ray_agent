# W3：运行与事件事实源

所属：[二次开发总计划](README.md)。前置：W1。规模：中到大，2 个对话——对话一完成表、写入顺序、状态、停止与启动扫描；对话二完成轮次事件与运行指标、请求重建、SSE 接口与评测脚本适配。可与 W2 并行。

## 目标与不做

**目标：** 每次运行有独立身份和明确终态；事件以数据库为事实源、按会话内序号保存；每一轮模型请求有带时间与用量的边界事件；每次模型请求的内容都能由事件重建；页面断线或刷新后能按序号补齐；停止真正向下传播到沙箱进程；API 重启后不留下“永远在运行”的会话。

**不做：** 多实例执行所有权与租约、请求去重、调用级持久意图与 unknown 对账、自动恢复执行、旧数据迁移。记忆继续存放在 sessions 行上（W2 压缩后大小有界）。

## 现状

- 会话状态只有 pending / running / waiting / completed / failed，停止写 completed（[`agent_service.py`](../../ray_agent/api/app/application/services/agent_service.py) 第 250–266 行；[`agent_task_runner.py`](../../ray_agent/api/app/domain/services/agent_task_runner.py) 第 438–444 行）。
- events、files、memories 都是 sessions 行上的 JSONB 数组（[`infrastructure/models/session.py`](../../ray_agent/api/app/infrastructure/models/session.py)）；`add_event` 追加数组，`get_by_id` 读取整行（[`db_session_repository.py`](../../ray_agent/api/app/infrastructure/repositories/db_session_repository.py) 第 56–64、105–122 行）。
- 事件先写 Redis 输出流、取得 stream ID 作为事件 ID，再写数据库（运行器第 91–99 行）。`chat` 接口把“提交消息”和“读取输出流”放在同一个 SSE 请求里（`agent_service.chat` 第 135–248 行）；前端在流结束后用空消息请求反复重连（[`use-session-detail.ts`](../../ray_agent/ui/src/hooks/use-session-detail.ts) 第 102–129 行）。
- 执行中的任务只登记在进程内注册表（[`redis_stream_task.py`](../../ray_agent/api/app/infrastructure/external/task/redis_stream_task.py)），应用启动时执行 Alembic 迁移后不检查遗留状态（[`main.py`](../../ray_agent/api/app/main.py) 第 44–69 行）。
- 沙箱已提供按 Shell 会话终止进程的接口，API 侧有 `shell_kill_process` 工具。

## 设计

### 数据

新增两张表，通过新的 Alembic 迁移建立；同一迁移删除 sessions 上的 events 列。开发库按服务指南重建，不转换旧数据。

**runs：** `id`、`session_id`、`status`、`reason`（可空，如 `max_iterations`、`context_limit`、`output_truncated`、`user_stop`、`api_restart`）、`started_at`、`ended_at`、`model_requests`、`tool_calls`、`prompt_tokens`、`completion_tokens`、`cached_tokens`（供应商不返回时为空）、`config_snapshot`（JSONB，记录本次运行使用的模型名、Agent 配置、渲染后的系统提示词全文与工具 schema 列表，供请求重建使用）。

**events：** `session_id`、`seq`（会话内从 1 递增）、`run_id`（可空，用户消息属于它触发的运行）、`type`、`payload`（JSONB）、`created_at`（毫秒精度）。主键 `(session_id, seq)`。`seq` 在插入事务内按会话取最大值加一，由主键冲突保证唯一；冲突时重试。

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

终态不可再改。waiting 的运行收到回复后回到 running，继续同一个运行 ID；completed、failed、cancelled、interrupted 之后的新消息创建新运行。`completed` 只表示循环正常结束，不表示目标达成。

### 轮次与运行事件

一轮指一次模型请求及其返回的工具批次（与 W2 压缩的“轮”同义；压缩摘要请求不算一轮，其用量记在 `compact` 事件上）。新增两种事件类型，删除 `UsageEvent`，用量改由轮次结束事件携带：

| 类型 | 时机 | 字段 |
|---|---|---|
| `turn`（phase=started） | 模型请求发出前 | `run_id`、`index`（运行内从 1 递增）、`context_estimate`（W2 的四部分估算；W2 未合入时为空） |
| `turn`（phase=completed） | 工具批次全部有结果后，或提问/审批使批次中止时 | `index`、`model_ms`（请求耗时）、`usage`（prompt、completion、cached、reasoning，缺失项为空）、`finish_reason`、`tool_call_ids`、`tools_ms`（批次内工具耗时合计）；W6 增加 `ttft_ms` 与 `attempts` |
| `run` | 运行创建与每次状态变化 | `run_id`、`status`、`reason`；进入终态时附运行汇总：总用时、轮数、工具调用数、tokens 合计 |

`ToolEvent` 的 `called` 保留 W1 写入的耗时与 W2 写入的整形元数据。所有事件的 `created_at` 为毫秒精度，界面的用时与速率只由这些字段计算。

### 请求重建

**不变量：** 每次模型请求发送的消息列表，都能由该运行的 `config_snapshot`（系统提示词与工具 schema）加上会话事件按固定规则重建，结果与实际发送的内容逐字相同。新增会影响模型输入的内容（注入的补充要求、压缩摘要、悬空调用补的结果）都必须先成为事件。

- 实现一个重建函数：输入会话、运行与轮次序号，输出该轮请求的消息列表与工具 schema；
- 测试中用 `ScriptedLLM` 记录实际收到的请求，与重建结果逐项比较，覆盖普通多轮、提问续接、运行中注入、停止后续接；W2 合入后追加压缩后的请求；
- 调试读取接口 `GET /sessions/{id}/runs/{run_id}/turns/{index}/request` 返回重建结果，供开发者视图使用；接口只读，不重放任何动作。

### 写入与通知

1. 运行器把事件与需要同步更新的状态写入数据库，在同一事务中提交；
2. 提交成功后向 Redis 发布通知，内容只有 `session_id` 与 `seq`；
3. 通知失败只记日志，不回滚事件，也不重放动作。

Redis 输出流退役；输入流保留，用于提交消息与运行中补充消息。

### 接口

- `POST /sessions/{id}/chat`：写入用户消息事件，按状态创建新运行、续接等待中的运行或注入到运行中的运行，返回 `{run_id, seq}`，不再承担事件流；
- `GET /sessions/{id}/events?after_seq=N`（SSE）：先从数据库按序号推送 `seq > N` 的全部事件，再订阅通知并推送新事件；订阅建立后再查一次数据库，补上订阅建立前的空档；连接期间每隔若干秒兜底查询一次，防止通知丢失导致停顿；
- `GET /sessions/{id}`：返回会话基本信息、全部运行（状态、原因与汇总）与全部事件（带 seq），事件很多时支持 `after_seq` 分段；
- `GET /sessions/{id}/runs/{run_id}/turns/{index}/request`：见“请求重建”；
- `POST /sessions/{id}/stop`：见下节。

SSE 事件数据中带上 `seq` 与 `run_id`。接口 schema 与前端类型同步修改；W0 评测脚本同步改为使用新接口。

### 停止与启动扫描

**停止：** 在一个事务里把运行置为 cancelled（原因 `user_stop`）并写入终态事件，然后取消执行协程；再对本次运行中调用过 `shell_execute` 的 Shell 会话逐个调用沙箱终止接口（运行器在分发 Shell 调用时登记会话 ID），A2A 沿用已有的远端取消尝试。终止结果写入一条事件，失败不改变运行终态。停止不回滚已写入的文件。

**启动扫描：** 应用启动完成迁移后、开始接收请求前，把所有 running 状态的运行置为 interrupted（原因 `api_restart`）并写入终态事件；waiting 状态保持，用户回复后照常续接。不自动重新执行任何运行。

## 改动清单

- Alembic 新迁移；ORM 模型 runs、events；仓库接口与实现（运行仓库、事件仓库）；UoW 增加对应仓库；
- 领域模型：`Run`、运行状态枚举、`turn` 与 `run` 事件，删除 `UsageEvent`；会话模型去掉 events 字段，需要事件的地方改用事件仓库；
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
- `state-ownership.svg`、`task-exits.svg`、`architecture-overview.svg` 图注标明旧基线示意。

## 交接

下游依赖：events SSE 接口与事件数据中的 `seq`、`run_id`；运行状态、原因与汇总的取值；`turn` 事件字段（W4 据此计算用时与每轮用量，W6 增加首字延迟与尝试次数）；请求重建接口（W5 开发者视图）；通知通道（W6 的流式增量复用它，增量不落库）；Shell 会话登记（W7.1 的进程收尾复用）。
