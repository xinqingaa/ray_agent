# W1：单循环执行内核

所属：[二次开发总计划](README.md)。前置：W0。规模：大，建议 2 个对话——对话一完成后端内核与测试；对话二完成前端最小兼容、评测复跑与 docs 更新。

## 目标与不做

**目标：** 用一个 Agent 循环替换 Planner + ReAct 双循环。模型在同一循环里调用工具、维护计划清单、提问和交付文件；没有工具调用的回复就是最终答复。减少模型调用与失败模式，并让评测数据可对比。

**不做：** 上下文压缩与输出整形（W2）；runs/events 表、轮次事件与新 SSE（W3）；审批（W7.2）；流式输出（W6）；Shell 缺陷修复（W7.1）。本包沿用现有会话状态枚举和事件类型，使旧界面在最小改动下可用。

## 现状

以下是 W1 实施前的代码事实，行号对应提交 `9faa304`；其中 `flows/planner_react.py`、`agents/planner.py`、`agents/react.py`、`agents/base.py`、`prompts/react.py` 已在 W1 删除，按需用 `git show 9faa304:<路径>` 查看。

- `flows/planner_react.py` 以状态机驱动 规划 → 执行步骤 → 更新计划 → 总结；`agents/planner.py` 强制 `json_object` 与 `tool_choice="none"`。
- `agents/react.py` 要求每步输出 Step JSON（第 82–94 行），解析失败即终止；第 96–102 行的假完成守卫与 `summarize()` 的附件 JSON（第 143–177 行）都依附于这个结构。
- `agents/base.py` 第 133 行只保留第一个工具调用；第 117–126 行空回复时写入一条伪造的用户消息；第 152–166 行工具异常重试 `max_retries` 次；第 193–226 行 `roll_back` 在续接时补提问结果或删除最后一条消息。Planner 与执行器各有一份记忆。
- 执行提示词强制每步调用 `message_notify_user`（`prompts/react.py` 第 27–30 行）；系统提示词要求“严禁列表”“至少数千字”，环境描述与镜像不符（[`prompts/system.py`](../../ray_agent/api/app/domain/services/prompts/system.py) 第 26、85–86、93–101 行）。
- 运行器在每个事件后检查输入流，有新消息就中断当前流程改道（[`agent_task_runner.py`](../../ray_agent/api/app/domain/services/agent_task_runner.py) 第 428–430 行）；文件工具每次 `called` 都会把目标文件同步到存储（第 275–283 行）。
- `LLMInvokeResult` 只有 message 与 usage，丢弃了 finish_reason（[`openai_llm.py`](../../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) 第 97–106 行）。

## 设计

### 循环

新增 `AgentLoop`（[`domain/services/flows/agent_loop.py`](../../ray_agent/api/app/domain/services/flows/agent_loop.py)），替换 `PlannerReActFlow`。一份记忆，名称 `agent`。简化的控制关系：

```python
async def run(user_message):
    replied = await repair_dangling_calls(status, user_message, started_call_ids)  # 续接时补齐悬空调用
    if not replied:                                     # 回复提问时回复已作为提问结果
        memory.compact(); memory.add_user(user_message)
    for turn in range(max_iterations):
        memory.add_users(drain_injected_messages())         # 运行中补充的消息
        response = await call_model(memory, tools)          # 传输错误才重试
        if response.truncated:
            handle_truncation(); continue                   # 半截调用不执行
        memory.add_assistant(response)                      # 完整保存全部 tool_calls
        if not response.tool_calls:
            yield final_answer(response.content); return
        for call in response.tool_calls:                    # 按返回顺序执行
            if call.is_ask_user:
                yield ask_and_wait(call); return            # 后续调用留待续接时补结果
            result = await pipeline.run(call)               # 执行前 → 执行一次 → 执行后
            memory.add_tool_result(call.id, result)         # 先写记忆，再发布 called 事件
    fail("max_iterations")
```

要点：

- **完整调用集合：** 保存模型返回的全部 `tool_calls`，按数组顺序串行执行，按 call ID 配对结果。请求参数仍保持 `parallel_tool_calls=False` 的兼容处理，但执行层不再截断。缺失 ID 时生成一次并随消息保存，之后不得重建。
- **结果回填：** 未知工具、参数 JSON 解析失败、参数校验失败都在管线执行前段生成该调用的失败结果回填模型，不抛异常、不终止任务。工具抛出异常时转为失败结果，**不自动重试**。
- **模型重试：** 只对传输类错误（连接、超时、5xx、限流；模型适配层抛出带 `retryable` 标记的 `LLMRequestError`）重试，`max_retries` 沿用旧语义，是单次模型请求的最多尝试次数；每次尝试都计入本次运行的模型请求数，返回了响应的尝试各发一条用量事件。空回复（既无文本也无调用）视为可重试错误，不写入记忆，不再伪造用户消息。
- **截断：** `finish_reason == "length"` 时，本次响应不写入记忆、不执行任何调用；追加一条要求缩短输出的提示后重试一次，再次截断则以失败结束，原因 `output_truncated`。提示以带“[系统提示]”前缀的 user 消息写入，因为部分 OpenAI 兼容服务不接受对话中途的 system 消息。
- **预算：** 沿用 `AgentConfig.max_iterations` 字段，语义从“单个步骤的迭代上限”改为“单次运行的模型请求上限”；耗尽时以失败结束，原因 `max_iterations`。token 级预算与容量检查属于 W2。
- **结束：** 没有工具调用的助手文本就是最终回复，格式为 Markdown，不再要求 JSON，之后发出 `DoneEvent`。失败结束时发出带原因代码（`max_iterations`、`output_truncated`、`model_error`）的 `ErrorEvent`，不再发 `DoneEvent`。

### 工具三段管线

工具分发固定为三段，每段是按注册顺序执行的处理函数列表，由循环层持有，不做插件系统：

| 段 | 输入 → 输出 | W1 提供 | 后续挂载 |
|---|---|---|---|
| 执行前 | 调用 → 继续，或直接给出结果（短路） | 工具存在性、参数 JSON 解析与 schema 校验，失败时短路为失败结果；记录开始时间 | W7.2 策略检查（deny 短路、ask 进入等待） |
| 执行 | 调用 → 原始结果 | 调用工具一次；异常转为失败结果，不重试 | — |
| 执行后 | 调用与结果 → 结果 | 计算耗时，写入 `called` 事件 | W2 结果整形（落盘与预览） |

短路时执行段与其余执行前处理都不运行，执行后段照常运行，保证每个调用都有耗时与事件。处理函数不得吞掉调用：任何路径都必须产出一个与 call ID 配对的结果。参数解析是严格的 `json.loads`（空字符串视为 `{}`，结果必须是对象），不做 JSON 修复；schema 校验是轻量实现，只检查必填字段、顶层类型与枚举。循环在 `called` 事件发布前把结果写入记忆，在事件之后停止不会把已执行的调用补成“未执行”。

### 运行中补充消息

用户在运行中发送的新消息照常写入任务输入流与会话事件。运行器不再因输入流非空而中断流程；改为向 `AgentLoop` 提供 `drain_injected_messages()`，循环在每次模型请求前取出全部待处理消息，作为用户消息追加。这样补充要求在当前工具批次结束后生效，不会打断正在执行的工具，也不会留下悬空调用。

### 提问、续接与悬空调用

- `message_ask_user` 调用时发出现有的 `MessageEvent`（问题文本）与 `WaitEvent`，运行器把会话置为 waiting 并退出；提问调用经过执行前段的检查，但不产生工具事件。同一批次中位于提问之后的调用不执行。
- 用户回复到来时，循环开头的 `repair_dangling_calls` 找出最后一条助手消息中没有结果的调用：提问调用的结果写为用户回复内容，其余调用写为“未执行：等待用户回复后重新决策”。然后才追加新的用户消息（回复本身已作为提问结果，不重复追加）。
- 任务被停止或失败后再次发消息时，同一函数把悬空调用补为“未执行：任务已停止”或“未执行：任务失败”；其中已在会话事件里发出 `calling` 的调用补为“执行中断：任务在该调用执行期间被停止（失败），调用可能已部分生效，结果未知”。停止写入的会话状态是 completed，进程中断时仍是 running，两者都按停止处理。任何模型请求都不包含没有结果的调用。
- 删除旧的 `roll_back` 逻辑。

### 工具调整

| 工具 | 处理 |
|---|---|
| `update_plan` | 新增。参数 `plan: [{step, status}]`（status 为 pending / in_progress / completed，最多一个 in_progress）与可选 `explanation`。更新运行内的计划并发出 `PlanEvent(status=updated)`，步骤映射到现有 `Plan.steps`（id 按序号生成，in_progress 映射为 running）。只维护清单，不调度。 |
| `deliver_files` | 新增。参数 `paths: [str]` 与可选 `note`。逐个校验沙箱中文件存在，上传到文件存储并关联会话；返回每个路径的成功文件信息或错误原因。至少一个成功时，运行器发出带附件的助手 `MessageEvent`。实现上由运行器注入交付函数，工具本身不直接依赖存储。 |
| `message_ask_user` | 保留，行为见上节。 |
| `message_notify_user` | 从默认工具集移除。进度通过助手随工具调用附带的文本（旁白）与计划清单表达。 |
| 文件工具 | `called` 事件只填充预览内容，不再同步到存储；会话文件列表只包含用户上传与 `deliver_files` 交付的文件。 |

### 标题

旧实现由 Planner 生成会话标题。新实现在会话标题为空或仍是创建时的占位标题“新对话”时，用用户消息去掉首尾空白后的前 30 个字符作为标题并发出 `TitleEvent`，不额外调用模型。

### 提示词

重写中英文系统提示词，删除规划器与执行步骤提示词：

- 删除“严禁列表”“至少数千字”等写作强制要求，改为按任务需要选择格式与长度；
- 环境描述以 W0 基线运行中实际观察到的镜像信息为准（执行身份、Python/Node 版本、工作目录），W7.3 修改镜像后再同步；
- 说明循环约定：复杂任务先用 `update_plan` 写清单并在推进时更新，简单任务不必写；需要文件成果时必须调用 `deliver_files`，路径必须是已写入的文件；缺少必要信息且无法合理假设时才提问；最终回复直接给出结果。

### 上下文清理

旧实现在步骤成功结束后调用 `Memory.compact()`（清空浏览器查看与导航结果的正文、删除 `reasoning_content`）。单循环没有步骤边界，改为在每次以新用户消息开始运行时调用；回复提问属于同一轮，不清理，以免删掉同一轮工具循环仍需回传的思考内容。一次运行内不做清理，token 级容量检查与压缩属于 W2。

### 事件与前端最小兼容

本包不新增事件类型。`StepEvent` 不再产生；`PlanEvent` 由 `update_plan` 产生；助手旁白用现有 `MessageEvent` 发出。前端只做必要修改：

- 时间线在没有 step 事件时已支持工具平铺显示（[`session-events.ts`](../../ray_agent/ui/src/lib/session-events.ts) 第 260–280 行），核对显示正常；
- 计划面板读取最新的 `PlanEvent` 步骤，核对 running 状态的图标与进度文字；
- 与 `message_notify_user` 相关的显示逻辑若因工具移除而失效则删除。

实际修改：工具记录中 `update_plan` 与 `deliver_files` 显示为一行文字（“更新计划清单：已完成 m / n”“交付文件 …”），不打开工具预览；计划面板为进行中步骤增加图标，折叠时显示进行中的一项（没有则显示下一项待办或最后一项）；UI 事件观察脚本增加单循环事件的检查。

### 需要删除或替换的代码

`PlannerReActFlow`、`PlannerAgent`、`ReActAgent.execute_step/summarize`、`step_guard.py`、规划器与执行步骤提示词、`MISSING_ATTACHMENT_ERROR` 与附件声明校验、`BaseAgent.roll_back`。`tool_call_compat.py` 的内嵌调用兼容保留，并对其产出执行同样的 ID 与完整性规则。只为 Planner/ReAct 解析 JSON 的 `JSONParser` 接口与 `RepairJSONParser` 实现随之删除，依赖组装不再注入；`json-repair` 包仍留在依赖声明中，锁文件未改。

## 改动清单

- API 领域层：`flows/`（含工具管线）、`agents/`、`prompts/`（含 `en/`）、`tools/`（新增 plan、deliver，调整 message）；
- 模型适配：`LLMInvokeResult` 增加 `finish_reason`，`openai_llm.py` 填充；
- 运行器：注入交付函数与补充消息读取，去掉输入流改道与文件工具同步；
- 测试：新增 `test_agent_loop.py` 与循环夹具 `tests/support/loop_harness.py`，以 `ScriptedLLM` 覆盖下列验收；`test_planner_react_flow.py` 的调度预期由新文件替代后删除，删除 `test_step_guard.py`；执行控制、状态持久化、事件观测、文件产物与任务错误用例按新循环改写；
- 评测脚本：报告可用 `--baseline` 生成与另一份报告的指标对比表，精简事件增加计划事件与工具耗时，检查函数不变；
- 前端：计划面板与时间线的最小核对修改。

## 验收

**自动测试（ScriptedLLM）：**

1. 一次响应含两个调用加一次 `update_plan`：三个结果按 ID 配对、按顺序执行，产生对应 PlanEvent；
2. 未知工具与非法参数 JSON：得到失败结果，循环继续，最终正常结束；
3. 工具抛异常：只执行一次，失败结果回填；
4. 提问位于批次中间：提问后的调用未执行；续接后提问结果为用户回复，后续调用被补为未执行，下一次模型请求不含悬空调用；
5. 运行中注入消息：在下一次模型请求前出现在消息序列中，且不打断当前工具；
6. 交付：路径存在时产生带附件的消息；路径不存在时返回错误结果，不产生附件消息；
7. `finish_reason=length`：调用不执行，重试一次，再次截断以 `output_truncated` 失败；
8. 模型请求达到 `max_iterations`：以失败结束并给出原因；
9. 停止后再发消息：未开始的悬空调用被补为“未执行：任务已停止”，已发出 `calling` 的调用补为“执行中断”；
10. 管线：执行前处理短路时工具不执行、执行后处理仍运行并记录耗时；执行后处理替换的结果进入记忆；多个处理函数按注册顺序执行。

**评测：** 复跑 E1–E6，与基线报告对比模型调用次数、tokens、耗时与检查结果，差异写入报告结论。E4 的停止效果在 W7.1 修复前可能仍不理想，如实记录。评测结束后保留 E2、E3 的会话 ID 写入报告，W5 阶段一据此整理界面夹具。

**真实 Web：** 在浏览器中完成 E2 与 E3，确认计划清单、工具记录、提问与附件下载可见。

## docs 同步

- [架构说明](../architecture.md)：“一次任务的执行”“结束路径与控制平面”中的执行循环、预算参数与结束条件；
- [Harness 工程](../harness.md)：“规划层”“决策层”“内外层循环的交接契约”改写为单循环与计划工具；
- [设计取舍](../decisions.md)：“双层循环”条目改为“单循环加计划工具”，保留旧选择的理由与放弃原因；
- [能力与边界](../capabilities.md)：规划、假完成守卫、并行/多调用、重试相关条目；
- [代码地图](../code-map.md)：规划与执行循环分组；
- [产品说明](../product.md)：计划展示、进展旁白、交付方式；
- 过时的 `task-lifecycle.svg`、`harness-layers.svg`、`product-overview.svg` 在图注标明旧基线示意，W8 重绘。

## 交接

下游依赖：`AgentLoop` 的事件序列（Title、Message、Tool、Plan、Wait、Error、Done、Usage）；`repair_dangling_calls` 的行为；`deliver_files` 的结果结构；`finish_reason` 字段；工具管线的注册接口。W2 在“模型请求前”插入容量检查与压缩，并在管线执行后段挂载结果整形；W3 替换事件的持久化与发布路径，增加轮次与运行事件并用它们取代 `UsageEvent`，其余事件语义不变；W5 阶段一以本包评测会话的真实事件整理夹具；W7.2 在管线执行前段挂载策略检查。

交接接口（2026-09-28 实现）：

- **工具管线注册：** `AgentLoop.pipeline` 是 [`ToolPipeline`](../../ray_agent/api/app/domain/services/flows/tool_pipeline.py)。`add_before(handler)` 注册执行前处理，签名 `async (ToolInvocation) -> Optional[ToolResult]`，返回结果即短路；`add_after(handler)` 注册执行后处理，签名 `async (ToolInvocation, ToolResult) -> ToolResult`，返回值替换结果并进入记忆，需要额外事件时追加到 `invocation.events`。内置执行前处理（记录开始、解析工具、解析参数、校验参数）先于新注册的处理运行，内置耗时记录先于新注册的执行后处理。W7.2 的策略检查用 `add_before`，W2 的结果整形用 `add_after`。
- **`repair_dangling_calls(status, message=None, started_call_ids=None) -> bool`：** 规则见“提问、续接与悬空调用”；返回用户回复是否已作为提问结果写入。`invoke()` 开头自动调用，`started_call_ids` 取自会话事件中的 `calling` 工具事件。
- **`deliver_files` 结果：** `ToolResult.data` 为 [`DeliveryResult`](../../ray_agent/api/app/domain/services/tools/deliver.py)（`items: [DeliveryItem(path, success, file, error)]`、`note`、`files` 为成功的文件列表）；`success` 为至少一个文件交付成功，`message` 为“已交付 x/y 个文件；失败：…”。交付函数签名 `async (path) -> File`，失败时抛异常，由运行器注入。
- **`finish_reason`：** [`LLMInvokeResult.finish_reason`](../../ray_agent/api/app/domain/models/llm.py)，OpenAI 兼容适配从 `choice.finish_reason` 填充；循环只对 `"length"` 做截断处理。
- **运行结束原因：** `AgentLoop.end_reason`（`RunEndReason`：completed、waiting、max_iterations、output_truncated、model_error）与 `model_requests`，供 W3 的运行记录使用。

## 实施修正（2026-09-28）

实施中以代码为准修正了本文以下内容：

1. “现状”改为标注 W1 前提交 `9faa304` 的快照，去掉指向已删除文件的链接。
2. 标题：会话创建时写入占位标题“新对话”，只判断空标题会使标题永远不更新（真实 Web 走查发现），改为空或占位标题时生成。
3. 停止与失败后的补结果：E4 复跑后续接时，模型把实际已运行一段时间的命令当作“未执行”，据此增加“执行中断，结果未知”一类，用会话中的 `calling` 事件判断调用是否开始。
4. 上下文清理：原文未提及旧实现的步骤边界清理，删除步骤结构后需要新的触发点，补“上下文清理”一节。
5. 截断提示的消息角色、`max_retries` 语义、失败时的事件、提问调用不产生工具事件、参数解析与校验的实际强度、结果先写记忆再发事件，按实现写入对应小节。
6. 测试文件组织：调度预期改由新文件 `test_agent_loop.py` 承载，旧文件删除，而不是在原文件内替换。


## 全量审计修订（2026-10-04，实施中）

交付返回完整/部分/失败及项目补存独立结果。结束前仅对明确交付缺口或未完成计划提供有限一致性反馈，不建设通用验收平台。本轮验证完成前不记为已具备。
