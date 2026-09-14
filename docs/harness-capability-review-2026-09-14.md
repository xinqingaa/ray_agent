# RayAgent Harness 能力评估与改进候选

评估日期：2026-09-14。代码基线：RayAgent `28e1bb8`（工作区另有课程文档改动，见末节）。评估时部署为本机 Compose（`manus-api`/`manus-ui`/`manus-postgres`/`manus-redis`/`nginx`），入口 `localhost:8088`，动态沙箱镜像 `manus-sandbox`。

**本文是调研快照与改进候选，不是决策记录，也不表示已经排期。** 当前阶段仍以课程制作与系统学习为主（见 [执行计划](../PLAN.md)），是否优化、何时优化、优化到什么程度，等课程制作完成后再单独判断。文中的"建议"均为候选方案，不是已完成能力，也不构成对现有实现的否定。

产品结构以 [架构说明](architecture.md) 为准；章节制作状态只在[课程进度](../lessons/progress.md)维护；工作区方向的早期调研见[工作区演进调研](workspace-harness-research.md)（2026-09-09，基线 `a798654`），本文不重复其内容。

## 1. 评估目的与方法

起因是判断"这套实现与课程对 Agent Harness 工程师岗位有多少说服力"。判断标准取"核心链路与核心价值"，不按代码复杂度或完整度与行业产品比较。

本次评估分三条独立证据：

- **静态审计**：逐层核对 `ray_agent/api/app`（约 12.6 千行 Python）的模型调用、工具协议、上下文、主循环、可靠性、可观测性、协议接入与测试，记录文件与行号。同时核对 `ray_agent/sandbox` 与 Compose 配置。
- **真实端到端运行**：经产品自身的 nginx 入口 `localhost:8088` 创建会话并发起一次文件任务，捕获完整 SSE 事件流、容器日志、数据库记录与 Docker 状态。这是本次新增的运行证据。
- **产品路径只读探针**：经沙箱自身 HTTP 接口查询执行身份与超时状态。特别说明：`docker exec` 不继承应用进程环境，用它得到的 `HOME` 不代表产品执行路径，本次不采用该值。

评估对象包括产品实现与课程文档两部分。课程文档部分的核对结果已直接落实为修订（见第 7 节），本文只保留与方法、结论有关的记录。

## 2. 端到端运行观察：一次 12 字节任务的代价

任务原文：在当前沙箱创建 `/home/ubuntu/eval-check.txt` 写入 `harness-eval`，读回确认，作为附件交付。模型 `glm-5.2`，终态 `completed`。

| 观察项 | 实测值 |
|---|---|
| 会话标识 | `3cb937b6-6b95-46c5-94af-16a14e16cfc0` |
| 端到端耗时 | 36.4 秒（首事件 07:56:45 → `done` 07:57:21） |
| 模型调用次数 | 13（规划 3 次 + 执行 10 次），全部非流式 |
| 累计 prompt tokens | 64,763；完成 tokens 1,295 |
| 单次 prompt tokens 轨迹 | 规划 1,759 → 执行 4,934、5,062、5,127、5,197、5,279 → … → 6,227 |
| 首次可用输出延迟 | 约 14 秒（07:56:45 请求 → 07:57:19 首个 usage 事件） |
| 工具调用 | 7 次，其中真实工具 3 次（写、读、读），纯通知 4 次 |
| 计划变化 | 3 步 → 2 步 |
| 事件构成 | 42 条：tool 14、usage 13、message 5、plan 4、step 4、title 1、done 1 |
| 交付产物 | 12 字节，附件 ID `05ee7a69-…` |
| 任务结束后环境 | 容器 `rayagent-sandbox-2d1c9247` 仍 `Up` |

同一轮还观察到两处值得记录的现象：

- **一次 `write_file` 在会话内落了 4 条同名文件记录。** 同一会话的 `files` 数组里有 4 条 `/home/ubuntu/eval-check.txt`，存储侧对应 4 个不同 key（4 次 12 字节上传），而工具记录只有一次写入、交付附件只有一条。第 5.2 节给出根因。
- **上下文压缩确实触发了一次。** 日志显示步骤边界处执行记忆压缩，随后规划请求的 prompt 从 5,279 降到 2,822。它是被动、偶发、只清特定内容的，不是按预算水位工作的策略（见第 5.1 节）。

这组数字本身就是最好的说明：任务产出 12 字节，代价是 6 万余 prompt tokens、13 次串行模型调用和一个 14 秒的无反馈窗口。

## 3. 能力清单：核心链路逐项状态

下表按"核心链路"而非代码量排列。状态分三档：**有·中等**（达到可用且有设计细节）、**有·浅**（存在但不足以支撑生产使用）、**无**。

| 能力维度 | 本项目状态 | 关键位置 | 行业头部通常怎么做 |
|---|---|---|---|
| 流式输出与增量 tool_calls 拼装 | 无 | `llm/openai_llm.py:75-95` | 累积 delta、按 index 拼装 arguments、监控首 token 延迟 |
| Structured outputs / 强约束解码 | 有·浅 | `planner.py:49`、`react.py:43`、`repair_json_parser` | `json_schema` 强约束，校验失败结构化重试 |
| 重试与错误分类 | 有·浅 | `agents/base.py:104-147`、`app_config.py:28` | 429/5xx/超时/超长分类，指数退避 + 抖动 + Retry-After |
| 超时与预算 | 有·浅 | `openai_llm.py:40`、`app_config.py:32-37` | 连接/首 token/整轮/工具级分层超时，预算跨重试累计 |
| 工具 schema 与参数校验 | 有·浅 | `tools/base.py:22-76` | 从类型生成 schema，入参校验，错误回灌模型自纠 |
| 并行工具调用 | 无 | `openai_llm.py:83`、`base.py:133` | 并行 tool_calls，按依赖分组，按 call_id 归并 |
| 上下文预算与压缩 | 无 | `agents/base.py:90`、`models/memory.py:45-58` | token 水位触发，分层摘要，保留目标与未完成项 |
| 计划与执行编排 | 有·中等 | `flows/planner_react.py:134-221` | 计划兼作验收器与授权边界，失败重规划 |
| 反"假完成"守卫 | 有·中等 | `agents/step_guard.py` | 交付物存在性校验、证据与调用绑定、程序化验收 |
| 取消传播 | 有·中等 | `agent_task_runner.py:441-448`、`protocols/a2a.py:70-87` | 幂等取消、跨进程所有权与租约 |
| 幂等与重复提交 | 无 | `agent_service.py:187,204` | 幂等键、去重窗口、副作用参数化幂等 |
| 检查点与崩溃恢复 | 有·浅 | `db_session_repository.py:105-122` | step 级 checkpoint、重启后确定性 resume 与副作用对账 |
| 跨进程并发控制 | 有·浅 | `redis_stream_task.py:24` | 会话级租约与 fencing token |
| 请求级可观测性 | 有·浅 | `logging/logging.py:14-25` | trace_id 贯穿，span 级耗时与成本聚合 |
| MCP 接入深度 | 有·中等 | `protocols/mcp.py` | 认证/OAuth、协议级取消、elicitation、并发 |
| A2A 接入深度 | 有·中等 | `protocols/a2a.py` | streaming/push、认证协商、远程任务对账恢复 |
| 测试覆盖 | 有·中等偏低 | `tests/`（68 例 / 1,716 行） | 模型适配层契约测试、故障注入、回归基准 |

## 4. 已确认的优势：可以作为核心证据的部分

这些不是概念，代码里是实的，也是这套实现值得保留的理由。

1. **双层循环与计划参与调度。** `flows/planner_react.py:134-221` 是完整状态机（IDLE→PLANNING→EXECUTING→UPDATING→SUMMARIZING→COMPLETED）；外层计划用"保留已完成前缀 + 替换剩余步骤"合并（`agents/planner.py:99-113`）。实测计划由 3 步收缩为 2 步，路径正常。
2. **取消链路有真实设计深度。** 捕获 `CancelledError` 后用 `_schedule_detached` 在新 Task 写终态，显式规避 anyio cancel scope（`agent_task_runner.py:441-448`、`:327-333`）；A2A 取消做远端 `cancel_task` 并回传 `canceled`/`not_canceled`/`timeout`/`rejected` 三态（`protocols/a2a.py:70-87`）。这类细节通常来自实际踩坑。
3. **协议层的工程质量最高。** MCP 绑定协议版本并显式校验（`protocols/mcp.py:22,56-59`）、工具分页带游标环检测（`:63-75`）、名字哈希去歧义（`:25-28`）、错误分类到 `timeout`/`protocol_error`/`invalid_response`/`transport_error`（`:92-99`）、明确不自动重放有副作用的调用；`tests/protocols` 用真实 fixture 进程做端到端。
4. **反"假完成"守卫针对真实问题。** `agents/step_guard.py` 拦截"模型在文本里声称写完、但没有真正 `tool_calls`"的情况，并用强提示重催一次。这种"模型会给出不实完成声明"的防御意识，比增加同类 CRUD 更有价值。
5. **状态分层与恢复的判断框架成立。** "页面看到的 / 进程里的 / 已落库的 / 外部副作用"四层分开，并有真实的同会话等待续接证据。
6. **验证习惯。** 课程与进度区分静态核对与运行验证、对未验证项标 `unverified`。这一点比代码量更能说明工程成熟度。

## 5. 已发现的问题

### P1：模型调用层缺少流式与结构化约束

- `llm/openai_llm.py:75-95` 使用非流式 `chat.completions.create`，无 `stream=True`，无增量拼装。工具调用只能整包到达。
- `openai_llm.py:83` 显式 `parallel_tool_calls=False`；`agents/base.py:133` 再以 `tool_calls[:1]` 只保留第一条。并行工具调用被两层限制关闭。
- 输出约束只有 `response_format={"type":"json_object"}`，无 `json_schema`；靠提示词里手写的接口说明加 `json_repair` 兜底。
- 重试固定 `max_retries=3`、固定 `_retry_interval=1.0`（`base.py:36`），无错误分类、无退避、无抖动；429、5xx、鉴权失败、上下文超长同等对待。
- LLM 超时硬编码 3600 秒（`openai_llm.py:40`），无请求级、轮次级或工具级超时。
- 实测后果：首次规划 14 秒无任何输出；13 次调用全部串行。

### P1：缺少 Context 预算与成本工程

- `app_config.py:22` 的 `context_window` 全项目只用于 `agents/base.py:90` 组装 `UsageEvent`，没有任何代码用它做判断（全仓 `token_count`/`count_tokens`/`tiktoken` 无实质命中）。
- `models/memory.py:45-58` 的 `compact()` 只把 `browser_view`/`browser_navigate` 的 tool 内容替换为 `(removed)` 并删除 `reasoning_content`；不摘要、不按水位裁剪，不改动 Shell、文件、搜索、协议结果，也不动 user/assistant 消息。
- 调用点唯一：`flows/planner_react.py:194`，在步骤边界压缩 React 的记忆；Planner 的记忆从不压缩。
- 缺少工具结果的长度预算（仅协议侧 `protocols/common.py:12-26` 做了 16k 字符截断）。
- 实测后果：12 字节任务累计 64,763 prompt tokens，单次 prompt 从 4,934 线性增长到 6,227；长任务只能等到模型端或上游报错。

这是与头部产品差距最结构性的一条，也最接近"Harness 工程师"岗位的核心能力定义。项目自己的调研文档 [workspace-harness-research.md](workspace-harness-research.md) 已提及相关工作区与上下文议题，此处从成本与预算角度补充实测数据。

### P1：幂等、检查点与跨进程所有权缺失

- 无幂等键。`agent_service.py:187` 在会话运行中接受新消息并各自 `input_stream.put`；`:204` 以不同 offset 从同一输出流读取，两个并发请求会互相抢事件。`tests/core/test_task_execution_control.py:141-160` 的 `test_chat_selects_task_and_does_not_deduplicate` 明确断言不去重（两次输入、两次 `invoke`）。
- `redis_stream_task.py:24` 的任务注册表是进程内类字典。多 worker 部署下 `Task.get()` 取不到任务，`stop_session` 会静默不取消。
- 恢复只有快照式：Plan、Step、事件与两份 Memory 全量存库，靠最新 `PlanEvent` 反序列化（`domain/models/session.py:46-54`）。没有 step 级 checkpoint、没有已完成副作用记录、没有 stale-RUNNING 清理器。

### P2：实测发现的产物记录缺陷（可复现）

一次 `write_file` 产生 4 条同名文件记录。根因已定位到接口契约不一致：

- `infrastructure/repositories/db_session_repository.py:143-165` 的 `remove_file(session_id, file_id)` 按 `file["id"] != file_id` 过滤。
- 调用方 `domain/services/agent_task_runner.py:195` 传入的是 `file.filepath`。
- 因此过滤永远匹配不到任何元素，旧记录从不删除；每次同步都追加一条新记录，并在文件存储中留下一个新 key。

对用户可见的交付不受影响（`_sync_message_attachments_to_storage` 会用新对象覆盖事件里的附件列表），但会话记录与存储会随同步次数累积冗余。这是"静态读代码不容易发现、跑一次就能看见"的典型问题。

### P2：模型调用层与校验层缺少测试

- `OpenAILLM` 适配层在 `tests/` 中零引用：超时、参数组装、异常包装均无覆盖。
- `agents/base.py` 的重试路径与 `_invoke_tool` 无直接测试；工具参数过滤与"工具未找到"分支无测试。
- `agents/planner.py:69,94` 的 `Plan.model_validate` 无 try/except，模型返回非 JSON 会以 ValidationError 冒泡为通用错误，该路径无测试。
- `agents/base.py:116` 工具未找到时 `return ValueError(...)` 而非 `raise`，后续 `result.model_dump_json()` 会失败。当前因 7 个工具箱全部注册、两处查找条件一致而走不到该分支，属潜伏缺陷。

### P2：请求级可观测性不足

- 事件模型与用量统计是完整的：10 类领域事件、SSE 投影、会话/本轮累计、从已存事件重算（`models/token_usage.py:54-61`）。
- 但全仓无 `request_id`/`trace_id`，无法把一次模型调用与前端某条事件、某次 HTTP 请求对应起来。
- 无单次调用耗时、首 token 延迟、重试次数记录；无按 Agent、工具、步骤的耗时与失败聚合；用量只有 token 没有成本口径。

### P3：系统提示中的沙箱环境描述与实测不符

`domain/services/prompts/system.py` 与 `en/system.py` 的 `<sandbox_environment>` 声称：

- "Node.js 20.18.0" —— 实测 v24.20.0（Dockerfile 使用 `node_24.x` 源）。
- "用户: `ubuntu`，拥有 sudo 权限" —— 实测执行身份 `uid=0`、`whoami=root`。
- "主目录: /home/ubuntu" —— 实测产品路径下 `HOME=/home/ubuntu`，这一条正确。

该提示经 `planner.py:48` 与 `react.py:42` 拼进系统提示，每次模型调用都会下发，且没有测试断言其内容。这是产品代码问题，不是课程文档问题；课程第 11 章的结论与实测一致。是否修改见第 6 节。

### P3：遗留与清理项

- `domain/services/tools/tool.py`（222 行）为死代码，全仓零引用，工具名与 `tools/file.py` 重复。
- 动态容器在任务达到终态后仍保留（本次实测确认），这与第 11 章记录的"`done` 不 `destroy`"一致，属已知设计，不是缺陷；列出是为了记录资源占用。

## 6. 改进候选

以下均为候选方案，供课程制作完成后判断。每项给出改动位置与验收标准，不涉及排期。

### 候选 A：模型调用层补流式、增量 tool_calls 与错误分类退避

- **改动位置**：`infrastructure/external/llm/openai_llm.py`（流式分支、分层超时）、`domain/services/agents/base.py`（按 index 拼装 `tool_calls`、错误分类与退避）。
- **动机**：消除 14 秒无反馈窗口；使工具调用与并行能力可用；让失败可区分、可观测。
- **验收**：首 token 延迟成为可观察指标；429 与鉴权失败在日志中可区分且退避次数可查；流式下工具调用拼装正确（建议单列一组夹具，这是最易写错的环节）。
- **代价**：改动集中在两个文件，但流式 + 工具调用的组合状态较多，需要新的测试入口。

### 候选 B：可观测的 Context 预算器

- **改动位置**：`domain/models/memory.py`（水位触发的分层摘要）、新增 token 计数入口、`flows/planner_react.py:194`（触发点）。
- **动机**：把"被动增长、等模型报错"改为"按预算主动管理"；让每次请求的实际 prompt token 可观察。
- **验收**：能看到每次请求的 prompt token 曲线；超过水位触发摘要而非报错；摘要后仍保留目标、未完成步骤与关键产物路径。
- **附带价值**：本文第 2 节的实测数据可直接作为教学案例；这也是最能把"读懂头部设计"变成"亲手做过"的一项。

### 候选 C：幂等、恢复与产物记录修复

- **改动位置**：先修 `db_session_repository.py:143-165` 与 `agent_task_runner.py:195` 的 id/path 不一致；再加会话级去重与 stale-RUNNING 清理。
- **动机**：消除可复现的冗余记录；让重复提交与进程重启有明确行为。
- **验收**：同一路径同步多次后会话 `files` 只保留一条；重复提交同一请求只产生一次执行；重启后遗留 `RUNNING` 会话有明确处置路径。
- **代价**：最小的一项，证据最硬（现有 bug 可直接对比"改前 4 条 / 改后 1 条"）。

### 关于系统提示的不实描述（小改动，需先定范围）

三个可选层次，从低风险到改变行为：

1. **只修事实**：把 Node 版本改为 24.x，把用户描述改为"以 root 身份执行"。
2. **从构建注入**：镜像构建时把实际版本写入环境变量，提示词读取它，避免下次升级再次漂移。
3. **真正降权运行**：让服务以 `ubuntu` 身份运行，使提示词成立。这会改变权限模型，与第 11 章"身份不等于隔离"一节直接相关，属于二开范围。

**当前不建议做的事**（避免为了对齐行业产品而破坏现有结构）：

- 不因"头部产品有"而引入框架替换主循环。自研 Plan + ReAct 是课程与项目的核心资产，第 4 节列出的设计深度也来自它。
- 不在课程制作完成前扩大产品改造范围；第 6 节的候选方案与课程第 12–17 章内容高度重合，可以先作为教材素材，再决定是否落地。
- 不把本文第 3 节的"无"直接理解为项目缺陷——部分能力（如并行工具调用）在当前使用场景下并非必需，是否补齐取决于后续目标。

## 7. 本轮已落实的修订

评估过程中对课程文档的核对结论已直接修订，逐项如下（**课程制作状态与本轮验证证据仍只在[课程进度](../lessons/progress.md)维护，此处只记录与本文结论相关的部分**）：

| 文件 | 修订 |
|---|---|
| `lessons/11-sandbox-and-execution-environment.md` | TTL 表述由"机制存在不等于已生效"改为"机制已按沙箱默认值启用，产品侧 `SANDBOX_TTL_MINUTES` 不生效，到期回收仍未观察到"；已有沙箱销毁限定为 `create()` 与 `get()` 两条不一致路径；"Chrome"改为"Chromium（包名 `chromium`）"；补充"适配层与脚本可显式删除、产品无对外接口"；补充 HOME 与执行身份的区别 |
| `lessons/09-state-and-persistence.md` | 补充"事件、附件元数据与 Agent Memory 存为会话记录内的 JSONB 列，没有独立事件表" |
| `lessons/10-events-and-streaming.md` | 流式对照表的事件清单补上 `title` 与 `error` |
| `lessons/progress.md` | 消除"root 身份未实测"与已记录 `id -u` 为 0 的自相矛盾；新增本轮实测证据与未修改的产品问题记录 |
| `ray_agent/sandbox/README.md` | 已有沙箱模式"销毁不删除外部容器"的笼统表述改为说明两条路径不一致 |

同轮验证：`lessons/map.md` 第 09/10/11 章引用的 37 个文件、被点名符号与跨文件锚点全部有效；三章表格列数一致，无失效链接。

**本次评估自身修正了两处口头结论**，记录在此以免后续引用出错：

1. 最初用 `docker exec` 得到的 `HOME=/root` 不代表产品路径。经沙箱自身接口实测为 `HOME=/home/ubuntu`、`uid=0`。
2. 最初判断"TTL 机制存在但不一定生效"与实测不符。实测 `GET /api/supervisor/timeout-status` 返回 `active=true` 且剩余约 5,960 秒，即倒计时已启用；被忽略的是产品侧配置值，两者需分开表述。

## 8. 证据边界与复现入口

**本次已完成**：

- 静态审计覆盖第 1 节所列范围，记录了文件与行号；第 3 节与第 5 节的每一项判断都有对应代码位置。
- 一次真实端到端运行（会话 `3cb937b6-6b95-46c5-94af-16a14e16cfc0`），完整 SSE 事件流、容器日志、数据库记录与 Docker 状态均有留存。
- 产品路径只读探针：执行身份（`uid=0`、`HOME=/home/ubuntu`）、Node 版本（v24.20.0）、Python 版本（3.10.12）、超时状态（`active=true`、剩余约 5,960 秒）、数据库表结构（`sessions`/`files`/`alembic_version`，事件与记忆为 JSONB 列）。
- 可复现的缺陷定位：一次 `write_file` 生成 4 条同名文件记录，根因指向 `remove_file` 的 id/path 不一致。

**本次未做**，引用时需重新核对：

- 未做故障注入：SSE 断连、API 崩溃、数据库事务故障、多 worker 并发、重复提交实测。
- 未等待 TTL 到期回收，未模拟应用关闭清理，未验证公网出口与租户隔离。
- 未重跑本地边界脚本与协议测试套件；协议层结论来自静态核对与既有测试记录。
- 未测量成本口径（无价格配置），本文的 token 数据不能换算为费用。
- 本次运行留下一个动态沙箱容器（`rayagent-sandbox-2d1c9247`），按设计会由 TTL 回收或手动删除。

**外部依据**：模型调用层与上下文管理的行业做法比较，依据的是公开产品设计与常规工程实践，未逐行核对任何外部产品源码；引用时以当时官方文档为准。

复现命令与运行条件统一维护在[运行指南](../ray_agent/README.md)、[API 指南](../ray_agent/api/README.md)、[沙箱指南](../ray_agent/sandbox/README.md)与[课程进度](../lessons/progress.md)，本文不重复维护。
