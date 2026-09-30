# 课程同步计划（草稿）

编制日期：2026-09-29。这是[总计划第 7 节](README.md#7-课程同步追加工作验收之后)的逐章展开，供课程阶段开工。tag `v2` 仅是 W0–W8 首轮验收基线；课程开工须等总计划中 W9/W10 返工及 W11 工作区通过验收，再以届时代码与证据校准本文，不能把未实施的工作区方案写入课程事实。评测数字来自各包已入库的报告，每条任务多为 1 次，不外推成功率。综合对照见 [W8 对比报告](evidence/w8-comparison-2026-09-29.md)（合并 [w8-2026-09-29-0d9ea1f.md](evidence/w8-2026-09-29-0d9ea1f.md)；16 次必过检查均通过、0 重试，首字延迟 245–1748 ms）。

本次不改 `lessons/` 正文与 `lessons/assets/`。旧方案的推导保留为对照，不另写一套课程。通用原理图不重画；下表“重画”只列把旧主链路画成当前产品路径的图。

2026-09-30 完整审计后补充：追加范围的最终产品基线、镜像与验收 tag 按[执行入口阶段 E](execution.md#阶段-e真实验收与事实文档收口)冻结；`v2` 不移动。课程开工再核对 W11 的文件操作/恢复失败/旧写入者寿命、有限项目记忆及新增组合任务证据，本文历史章节草稿不提前作为已实现事实。该补充只校准课程前置，不授权本轮修改课程正文。

| 类别 | 章节 |
|---|---|
| 重写主线 | 04、05、06、07、08、10 |
| 局部更新 | 02、03、09、11、12、16 |
| 基本保留 | 01、13、14、15 |

代码位置不在本章重复贴路径，统一从[代码地图](../code-map.md)进入。

## 01 认识 Agent Harness：从一句请求到任务完成

**类别：** 基本保留。最后校准，避免把尚未改的后文提前写成新实现。

**要改的小节：**

- 「RayAgent 怎样组合这些职责」：执行核心改为单循环与 `update_plan`，去掉把 Plan + ReAct 写成当前组合的句子。
- 「怎样理解一次完成」：completed 只表示没有工具调用的回复；停止是 cancelled，重启区分提问等待与审批等待。

**依据：** [Harness 工程](../harness.md)；[架构说明](../architecture.md)的结束路径。评测不作本章主证据。

**配图：** [`01-system-overview.svg`](../../lessons/assets/01-system-overview.svg) 问的是模型之外谁组织任务，基本保留。

## 02 与模型交互

**类别：** 局部更新。

**要改的小节：**

- 「普通输出与流式输出，改变的是接收方式」「从片段拼回回答」：默认流式组装；文本增量走不落库的 `delta`；工具调用等组装完成再执行；推理分片不推页面、不计首字；`request_timeout` 在流式时是首片与片间空闲上限。
- 「在实验中看清两个 stream」：实验仍可讲通用流式；项目实现段改指 `turn(completed).ttft_ms` 与失败时的 `attempt` 事件。

**依据：** [W6 子计划](w6-streaming.md)及其实施修正；[W6 评测](evidence/w6-2026-09-29-33964e0.md)（E1 的 `ttft_ms` 为 871 与 629，E2 各轮为 652、783、751、579）。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：16 次运行 0 重试，已完成轮次首字延迟 245–1748 ms，不在草稿里外推。

**配图：** [`02-response-streaming.svg`](../../lessons/assets/02-response-streaming.svg) 是普通响应与流式响应的原理图，基本保留。

## 03 工具与行动

**类别：** 局部更新。

**要改的小节：**

- 「程序执行，再把结果送回去」：一次回复的多个调用按顺序执行、按调用 ID 回填；执行段只调用一次，异常变成失败结果。
- 「参数有效与操作获准是两个问题」：三段管线；校验之后才是 allow / ask / deny。deny 与用户拒绝都回填结果，并在事件上与执行失败分开。计划与提问不受策略约束。

**依据：** [W1 子计划](w1-agent-loop.md)的工具管线交接；[W7 子计划](w7-control-safety.md)的审批事件顺序。本地测试见代码地图「工具三段管线」「工具策略授权」。浏览器里的策略禁止与内置工具 ask 仍未走查，见[能力与边界](../capabilities.md#未验证的范围)，正文不要写成已经在界面上验证过。

**配图：** [`03-tool-call-execution.svg`](../../lessons/assets/03-tool-call-execution.svg) 是声明与执行的原理图，基本保留。

## 04 Agent Loop 与 ReAct

**类别：** 重写主线。通用的“看返回类型再决定是否继续”保留；产品实现从双角色改成一个 `AgentLoop`。

**要改的小节：**

- 「落到本课的接口」：一份记忆、名称 `agent`；退出条件是回复里没有 `tool_calls`。
- 「为什么必须再进入同一过程」：同一次回复的全部调用都执行，悬空调用按离开方式补结果。
- 「ReAct 是每一拍里如何决定」：保留为通用叫法。不要再把 Planner 与执行器写成 RayAgent 当前的两个角色。
- 「实验里谁在维持这套判断」：labs 里的简化循环与产品循环分开写。
- 「停下来之后，还要看结果」：最终答复不是目标达成；交付看 `deliver_files`。

**依据：** [W1 子计划](w1-agent-loop.md)；[W1 评测](evidence/w1-2026-09-28-9faa304.md)（E1–E6 模型调用 55→20，prompt tokens 285218→92653）。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：E1–E6 各 2 次必过检查均通过，相对 W0 模型调用与 prompt tokens 下降、无 `message_notify_user`。

**配图：** [`04-feedback-loop.svg`](../../lessons/assets/04-feedback-loop.svg) 图内已写明是最小工具反馈循环、外层计划不在图中，基本保留。

## 05 上下文与记忆

**类别：** 重写主线。

**要改的小节：**

- 「上下文包含哪些信息」「上下文如何随行动变化」：系统提示、历史、工具声明与工具结果；新用户消息时只删推理字段，不再按浏览器工具名裁正文。
- 「从保存到使用，中间发生了什么」：模型历史的每次变化先成为 `context` 事件，请求可以按运行快照重建。
- 「为什么不能一直追加全部信息」「怎样在有限空间内保留判断依据」：请求前容量估算、水位 75%、按轮压缩、用户原文重新注入、压不下则 `context_limit`；单条结果超过 8000 字符时落盘，模型只看预览。
- 「回到实验与 RayAgent」：用 E7 作项目例，并写明窗口被调低，不是默认 65536 下的长任务。

**依据：** [W2 子计划](w2-context.md)实施修正（保留轮数、最小收益、`replace` 携带全文）；[W2 评测](evidence/w2-2026-09-28-c0822dc.md)（E7 压缩 2 次，估算 14593→5777、15347→6030，12 个校验码保留）。真实服务端超长拒绝与默认窗口下的长任务没有运行记录，正文标成未验证。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：E7 两次各压缩 2 次并通过 12 个校验码与 source_total=60（任务期间窗口 24576，非默认 65536）。

**配图：** [`05-context-selection.svg`](../../lessons/assets/05-context-selection.svg)、[`05-request-working-set.svg`](../../lessons/assets/05-request-working-set.svg)、[`05-memory-lifecycle.svg`](../../lessons/assets/05-memory-lifecycle.svg) 是选择、工作集和记忆寿命的原理图，基本保留。

## 06 从 Agent Loop 到完整 Harness

**类别：** 重写主线。本章用一次文件任务串起交接，旧正文的 Planner、步骤结果和总结阶段要换成单循环上的同一次任务。

**要改的小节：** 全章。重点是「用户消息怎样进入持续执行」「第一次决策需要哪些信息」「写入结果怎样参与后续行动」「页面记录为什么不能直接当作模型输入」「沙箱文件怎样成为最终附件」「再看这条完整任务」。附件只来自 `deliver_files`，文件工具写完不会自动变成附件。页面事件先落库再通知，文本增量不进模型历史。

**依据：** [W1 子计划](w1-agent-loop.md)的交付与旁白；[W3 子计划](w3-run-events.md)的事件顺序；[W1 评测](evidence/w1-2026-09-28-9faa304.md)与 [W2 评测](evidence/w2-2026-09-28-c0822dc.md)里的 E2（文件交付）。走查截图 `evidence/w1-2026-09-28-web-*.png`、`evidence/w5-2-2026-09-29-*.png`。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：E2 两次均交付 summary.json、total=60，源文件未改。

**配图：**

- [`06-task-handoffs.svg`](../../lessons/assets/06-task-handoffs.svg)：重画。图中是 Planner、步骤 1、步骤结果和按路径同步附件。
- [`06-file-delivery.svg`](../../lessons/assets/06-file-delivery.svg)：重画。图中是文件工具结束后由运行器同步存储并挂到最终消息。

## 07 规划与内外层循环

**类别：** 重写主线。标题改为「规划与执行决策」。文件名是否改，由课程阶段决定；草稿不改文件。

**要改的小节：**

- 「一项任务、一个步骤与一次工具调用」「单个 Loop 已经能行动，为什么还要计划」：计划改成清单工具，程序不按清单选下一步。
- 「外层是程序，Planner 是其中一个角色」「内层结束以后，控制交回哪里」「看一次外层真正返回的过程」「三步为什么可以变成一步」「内层停了，外层怎么办」：改为 `baseline-v1` 的对照，不再称作当前主路径。假完成守卫与步骤 JSON 随该结构删除。
- 「显式计划带来的收益与代价」「两种常见的进度控制方式」：保留双循环与单循环的对照表。附 [W0 基线](evidence/w0-baseline-2026-09-28-961005d.md)与 [W1 评测](evidence/w1-2026-09-28-9faa304.md)：模型调用 55→20，prompt tokens 285218→92653，E1–E3、E5、E6 的检查结论相同，E4 在 W1 仍未通过（停止要到 W3 才分开）。

**依据：** [W1 子计划](w1-agent-loop.md)；[设计取舍](../decisions.md)的「单循环加计划工具」。短任务可以不调用 `update_plan`，W1 报告里写过，正文不要把清单写成每条任务的必经步骤。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：W8 的 E1 两次工具调用为 0，走查中计划条 3/3 仍可见，短任务与显式清单可分开写。

**配图：**

- [`07-nested-feedback.svg`](../../lessons/assets/07-nested-feedback.svg)：重画。图中外层选择步骤、内层交回步骤结果，画的是旧主链路。
- [`07-progress-control.svg`](../../lessons/assets/07-progress-control.svg)：基本保留，作对照。左侧双循环标明 `baseline-v1`，右侧单循环是当前结构；不要把左侧画成现行产品。

## 08 任务执行与控制

**类别：** 重写主线。

**要改的小节：**

- 「请求交出去了，谁让任务继续」：`chat` 返回 `run_id` / `seq` / `route`；运行中补充在下一次请求模型前纳入。
- 「运行中补充消息，在哪个时刻生效」：不打断当前这批工具。
- 「缺少信息时，等待需要留下什么」：提问后退出协程，回复作为该调用的结果续接同一个运行。
- 「等待确认，怎样才构成执行授权」：策略 ask 进入 `waiting` / `approval`；批准只执行这一次；拒绝回填“用户拒绝执行”。重启后续接的是提问，不是审批。
- 「点击停止之后，要确认到哪一层」：cancelled / `user_stop`，再终止本次运行登记的进程组（SIGTERM，约 3 秒后 SIGKILL）。不回滚文件，不销毁沙箱。正在执行的调用可能只有 `calling`。
- 「次数、时间和消耗，分别限制什么」：`max_iterations` 按一次运行累计；工具调用不重试；上下文容量按单次请求检查，不是 token 预算。

**依据：** [W3 子计划](w3-run-events.md)；[W7 子计划](w7-control-safety.md)。[W3 评测](evidence/w3-2026-09-28-8511bdf.md)：E4 为 cancelled / user_stop，停止后 10 秒内标记增长 0 行（W0 是 5 秒内增长 5 行，且终态仍是 completed）。[W7.1/W7.3 评测](evidence/w7-1-3-2026-09-28-4b413ef.md)：停止后标记停在 8 行，进程组返回 -15。[W7.2 评测](evidence/w7-2026-09-29-b2d83c5.md)：E6 先审批再得到 6912；正式轮耗时受沙箱积压影响。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：E4 两次 cancelled / user_stop、停止后标记 10 秒内增长 0 行；E6 与 E6-deny 在清掉动态沙箱后约 9.7–11.8 s 完成。

**配图：**

- [`08-task-handoff.svg`](../../lessons/assets/08-task-handoff.svg)：重画。下半是运行器把事件写入输出队列再转 SSE；当前是先落库，Redis 只通知序号，文本增量不落库。
- [`08-cancel-boundaries.svg`](../../lessons/assets/08-cancel-boundaries.svg)：重画。图中停止写 completed。
- [`08-wait-and-resume.svg`](../../lessons/assets/08-wait-and-resume.svg)：重画。续接处是「选择未结束步骤」。

## 09 状态与持久化

**类别：** 局部更新。

**要改的小节：**

- 「同一项任务，状态分别归谁」：去掉 Planner / ReAct 两份记忆；补 runs、events 和进程内的 Shell 登记。
- 「一次写入，怎样变成多份记录」：事件、运行计数与会话状态同一事务，提交后再通知。通知不带正文。
- 「等待后，新的运行器怎样接续」：不再读最新计划并选择未结束步骤；提问续接补结果，审批续接先执行被批准的那一次调用。
- 「刷新、重连与重启分别改变什么」：带 seq 的事件可补齐；`delta` 不补。重启把 running 与等待审批标为 interrupted，等待提问保持。

**依据：** [W3 子计划](w3-run-events.md)实施修正；[W4 子计划](w4-ui-data.md)。断网补齐的浏览器观察在总计划第 6 节 W6 条目（序号 1–23）。API 崩溃后沙箱进程不回收，仍是未验证，不要写成启动扫描会杀进程。

**配图：**

- [`09-wait-resume-state.svg`](../../lessons/assets/09-wait-resume-state.svg)：重画。图中是「选择未结束步骤」「不合并后续 StepEvent」。
- [`09-state-ownership.svg`](../../lessons/assets/09-state-ownership.svg)、[`09-action-recording.svg`](../../lessons/assets/09-action-recording.svg)：寿命和记录窗口的通用图，基本保留。改字时若发现事件被画在会话行的 JSON 或 Redis 输出流上，再改为重画。

## 10 事件与可观察性

**类别：** 重写主线。观察入口改为轮次事件、增量通道和运行视图。

**要改的小节：**

- 「一次工具执行，怎样成为页面记录」：`tool(calling/called)` 成对；挂起的审批在答复前没有工具事件；被拒绝或策略禁止的 `called` 带 `denied_by`。
- 「两种流，传递的是不同东西」：按 seq 的 SSE 可续传；`delta` 无 seq、不落库。
- 「怎样把请求、步骤、调用与产物连起来」：用 `run_id` 与轮次序号，不再用步骤事件串线。开发者视图读取重建请求。
- 「有时间戳，就能知道慢在哪里吗」「用量累计能说明多少消耗」：`model_ms`、`ttft_ms`、轮次 usage；页面速度在有用量时按公式，并扣除推理 token。用量不再是单独的 usage 事件。
- 「连接结束、业务结束与观察缺失」「用一条任务检查自己的观察依据」：用 E1/E2 或走查会话说明刷新丢掉半截文本、终态后临时条目消失。

**依据：** [W3 子计划](w3-run-events.md)、[W4 子计划](w4-ui-data.md)、[W6 子计划](w6-streaming.md)；[W6 评测](evidence/w6-2026-09-29-33964e0.md)。运行视图走查截图 `evidence/w6-2026-09-29-*.png`、`evidence/w5-2-2026-09-29-*.png`。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：16 次评测 0 重试；流式停止与运行中刷新、断网恢复等跨包组合各 1 次通过，停止后半截临时内容不留在时间线。

**配图：**

- [`10-event-projection.svg`](../../lessons/assets/10-event-projection.svg)：重画。图中有 Redis 输出流。
- [`10-observation-intervals.svg`](../../lessons/assets/10-observation-intervals.svg)：问的是间隔、耗时和何时看见结果，基本保留；正文用轮次字段解释，不把图改成界面截图。

## 11 沙箱与执行环境

**类别：** 局部更新。

**要改的小节：**

- 「动作最终由哪个进程执行」：Supervisor 管理的服务以 ubuntu 运行；supervisord 主进程仍是 root；需要 root 时用免密 sudo。
- 「「在容器里」不等于已经隔离」：动态容器默认 2048 MiB、2 CPU、512 进程；已有地址模式不套用限额；工作目录不是访问围栏。
- 「谁创建，谁复用，谁负责回收」：`SANDBOX_TTL_MINUTES` 注入为 `SERVER_TIMEOUT_MINUTES`。TTL 真正到期销毁没有等到，正文保持未验证。
- 「用观察结果判断边界」：Shell 初次等待最多 5 秒，未结束返回 running；终止打到进程组。

**依据：** [W7 子计划](w7-control-safety.md)交接（W7.1、W7.3）；[W7.1/W7.3 评测](evidence/w7-1-3-2026-09-28-4b413ef.md)中的执行身份与 E4 进程组。检查脚本的限额数字见总计划第 6 节 W7.1 条目，不在本章复述成新的测量。

**配图：** [`11-environment-lifecycle.svg`](../../lessons/assets/11-environment-lifecycle.svg)、[`11-execution-boundaries.svg`](../../lessons/assets/11-execution-boundaries.svg) 讲的是任务结束环境仍在、以及路径与隔离边界，基本保留。

## 12 文件与任务产物

**类别：** 局部更新。

**要改的小节：**

- 「工作成果怎样成为交付物」「怎样判断交付成立」：只有 `deliver_files` 把沙箱文件上传为附件；部分失败时各路径有原因。只写进沙箱的文件不是附件。
- 「交付以后，谁负责访问与保留」：预览与给模型的结果不是同一份；被整形的结果另有落盘路径。

**依据：** [W1 子计划](w1-agent-loop.md)的 `deliver_files` 结果结构；[W2 子计划](w2-context.md)的整形元数据。E2 在 W1、W2、W7 评测中通过（例如 W2 对照里 source.csv 未改、`total` 正确，以各报告原文为准）。W5 走查有下载 `summary.json` 的记录。

**配图：** [`12-files-in-harness.svg`](../../lessons/assets/12-files-in-harness.svg) 是“选定产物再由程序建立入口”的通用图，基本保留。旧的“工具一结束就同步附件”在 06 的两张图里，不在这张。

## 13 浏览器如何成为工具

**类别：** 基本保留。

**要改的小节：** 开头把“由已有 ReAct 循环决定下一步”改成由单循环决定下一步。页面内容进入上下文的方式与其他工具结果相同，不再写按浏览器工具名裁剪。CDP、截图与工具文本分路的原理不动。

**依据：** [W2 子计划](w2-context.md)删除定点裁剪；代码地图「浏览器连接」。E5 在 W0–W3、W7.2 的评测里通过，那是受控页面取事实，不是完整浏览器产品走查。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：界面回归 1 次，受控页校验码 W8-BX-4418 已取回并完成。

**配图：** [`13-browser-control.svg`](../../lessons/assets/13-browser-control.svg)、[`13-browser-observation.svg`](../../lessons/assets/13-browser-observation.svg) 基本保留。

## 14 通过 MCP 接入外部工具

**类别：** 基本保留。

**要改的小节：**

- 「RayAgent 如何将 MCP 工具接入任务」：删掉“接入已有的 Plan + ReAct、外层计划仍负责步骤组织”。结果截断后的全文交给整形落盘。
- 「Harness 如何管理外部工具的运行」：默认 `mcp:*` 为 ask；更具体的规则优先。多轮 `input_required` 仍按失败返回。

**依据：** [W7 子计划](w7-control-safety.md)；[W7.2 评测](evidence/w7-2026-09-29-b2d83c5.md)的 E6（批准后 6912）。E6 正式轮 174.3 秒不能当成协议变慢，可比耗时等对比报告。A2A 与策略禁止的浏览器走查不要写进本章已验证范围。

**配图：** [`14-mcp-roles.svg`](../../lessons/assets/14-mcp-roles.svg)、[`14-mcp-exchange.svg`](../../lessons/assets/14-mcp-exchange.svg)、[`14-mcp-harness.svg`](../../lessons/assets/14-mcp-harness.svg) 是角色、发现调用和别名路由，基本保留。

## 15 通过 A2A 协作远程 Agent

**类别：** 基本保留。

**要改的小节：** 「RayAgent 如何将远程协作接入任务」「Harness 如何管理远程委派」：默认 `a2a:*` 为 ask；`input_required` / `auth_required` 仍按失败返回；远程产物不会自动成为附件；停止时的远端取消仍不保证成功。审批接真实远程 Agent 没有运行记录，不要写成已走查。

**依据：** [W7 子计划](w7-control-safety.md)未覆盖项；代码地图「A2A」。labs 实验保持协议示例，不改成产品审批教程。[W8 对比报告](evidence/w8-comparison-2026-09-29.md)：A2A 夹具成功（`echo:w8-ping`）与远端失败（`fail`→`A2A_EXPECTED_FAIL`）界面回归各 1 次，均需审批。

**配图：** [`15-a2a-roles.svg`](../../lessons/assets/15-a2a-roles.svg)、[`15-a2a-task.svg`](../../lessons/assets/15-a2a-task.svg)、[`15-a2a-harness.svg`](../../lessons/assets/15-a2a-harness.svg) 基本保留。

## 16 可靠性、验证与评估

**类别：** 局部更新。用评测脚本和前后对比作真实素材。

**要改的小节：**

- 「把任务目标变成可验证的要求」「为结论选择证据与检查方法」：E1–E7 的检查项（交付字段、提问后续接、停止后标记不再增长、浏览器事实、MCP 结果、压缩后校验码）。脚本在 `ray_agent/api/scripts/eval/`，命令仍只链到 API 开发指南，不在本章复制。
- 「通过失败与中断验证执行边界」：停止、失败、中断、提问等待、审批等待是不同终态或活动状态。W0 的 E4 是反例（停了仍 completed）。
- 「用任务集评估稳定性与质量」：单次不能当成功率。列出已有报告的对照关系：W1 对 W0，W2 起 E7，W3 的 E4，W6 的首字延迟，W7.2 的审批。资源积压导致的超时要单独写出，不能并进“新循环更慢”。
- 「用验证结果指导 Harness 改进」：模型调用与 prompt tokens 的下降来自去掉规划调用和 `message_notify_user`，见 W1 报告的工具分布说明；W8 两次运行与脚本失败修复见对比报告正文，不外推成功率。

**依据：** [W0 子计划](w0-baseline-eval.md)与 [基线报告](evidence/w0-baseline-2026-09-28-961005d.md)；[W1](evidence/w1-2026-09-28-9faa304.md)、[W2](evidence/w2-2026-09-28-c0822dc.md)、[W3](evidence/w3-2026-09-28-8511bdf.md)、[W6](evidence/w6-2026-09-29-33964e0.md)、[W7.2](evidence/w7-2026-09-29-b2d83c5.md)；[W8 对比报告](evidence/w8-comparison-2026-09-29.md)（[w8-2026-09-29-0d9ea1f.md](evidence/w8-2026-09-29-0d9ea1f.md)）：E1–E7 与 E6-deny 各 2 次必过均通过、16 次 0 重试，跨包组合与 MCP/A2A/浏览器界面回归按报告各 1 次记录。

**配图：** [`16-failure-observation.svg`](../../lessons/assets/16-failure-observation.svg)、[`16-verification-evidence.svg`](../../lessons/assets/16-verification-evidence.svg) 是超时窗口和证据关系的原理图，基本保留。

## 写作时共用的界限

- 课程里的“当前实现”在同步完成前仍指 `baseline-v1`。改某一章时，该章的项目段落以 W9/W10/W11 全部验收后的明确提交或 tag 校准；`v2` 只用作 W0–W8 首轮对照，不作为后续项目工作区的实现依据。旧双循环的推导保留为对照，不另册维护。
- 各章除上文列出的 W8 观察外，仍只引用各包单次评测并写明次数；W8 数字以对比报告为准，不外推成功率。不要把 W7.2 里因沙箱积压超时的 E6-deny 写成产品失败；W8 正式轮 E6-deny 两次已入库，见对比报告。
- 代码阶段留下的图注“旧基线示意”已从项目级配图撤下。课程配图仍是旧图，直到本计划列出的重画完成。
