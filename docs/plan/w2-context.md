# W2：上下文治理

所属：[二次开发总计划](README.md)。前置：W1。规模：中，1 个对话。可与 W3 并行。

## 目标与不做

**目标：** 每次模型请求前确认放得进窗口；单个工具结果不会撑爆上下文，但完整内容仍可再读；历史接近窗口时自动压缩，压缩后任务能继续并保留目标与约束。

**不做：** 跨会话记忆、向量检索、专用外存服务与引用表；二进制和媒体内容；精确计费。

## 现状

以下是 W2 实施前的代码事实，对应已提交的 W3 `c0822dc`。下列文件在 W2 中已改写，行号不再指向当前源码，按需用 `git show c0822dc:<路径>` 查看。

- 记忆只追加（`domain/models/memory.py`），`compact()` 只把 `browser_view`、`browser_navigate` 的结果替换为 `(removed)` 并删除推理字段，按工具类型而非预算触发；W3 把这次清理记为 `context(op=compact)` 事件。
- `context_window` 只随 `turn(started)` 记录、用于用量展示，`context_estimate` 恒为空；`max_tokens` 默认 8192。
- 文件读取工具已支持 `start_line`、`end_line`、`max_length`（[`tools/file.py`](../../ray_agent/api/app/domain/services/tools/file.py)），可以分段读取沙箱文件。
- MCP/A2A 结果在协议适配层按字符数与列表项截断后才进入上下文（`protocols/common.py` 的 `describe_content()`），被截掉的部分不可再读。
- Shell 输出在沙箱内存中无上限累积（`sandbox/app/services/shell.py`）。

## 设计

### 请求容量检查

每次模型请求前估算输入量：上一次响应的 `prompt_tokens` 作为已知部分，加上其后新增消息与本次工具 schema 变化的估算值（按字符数乘系数估算，中文与英文分别取系数；没有 usage 时全部估算）。可用输入上限为 `context_window − max_tokens − 安全余量`，余量默认取窗口的 5%。

- 估算结果按来源分为系统提示词、工具 schema、对话历史、工具结果四部分，随 W3 的轮次开始事件记录（字段 `context_estimate`），开发者视图据此显示上下文构成；W3 尚未合入时先作为函数返回值并有单元测试；
- 估算值超过压缩水位（默认可用上限的 75%）时先压缩，再重新估算；
- 压缩后仍超过可用上限，以失败结束，原因 `context_limit`；
- 请求因上下文超长被服务端拒绝时，同样先尝试一次压缩，再失败。

### 工具结果整形

在工具结果写入记忆之前统一处理，实现为 W1 工具管线执行后段的一个处理函数，适用于所有工具：

- 结果序列化后超过单条上限（默认 8,000 字符）时，把完整内容写入沙箱文件 `/home/ubuntu/.rayagent/outputs/<call_id>.txt`（路径随 W7.3 的执行身份调整），模型收到首段与尾段预览、总长度、文件路径，以及“可用 read_file 按行分段读取”的提示；
- `called` 事件记录进入上下文的预览本身，以及整形元数据：原始字符数、是否截断、完整内容路径，界面的工具卡据此显示“完整输出已保存”；
- 写文件失败时退回为纯截断，并在结果中注明完整内容不可再读；
- MCP/A2A：把原始文本或 JSON 在 `describe_content()` 截断之前交给整形函数落盘，截断规则只作用于进入上下文的预览；
- Shell：沙箱侧为单个 Shell 会话的累积输出设上限（默认 1 MB，超出保留尾部并标记截断位置），避免内存无限增长。

整形后删除旧 `compact()` 中按浏览器工具名替换正文的逻辑；浏览器页面内容走同一套上限。

### 自动压缩

压缩只作用于发给模型的记忆；会话事件里的原始记录不变。

1. 选择压缩范围：保留系统提示词与最近 K 轮（默认 K=3，一轮指一条助手消息及其全部工具结果）原样，其余较早部分进入摘要。范围边界必须落在完整的“助手调用 + 全部结果”之后，不能拆开调用与结果；正在等待回复的批次永远在保留区。
2. 生成摘要：用独立的压缩提示词请求模型（不带工具），输出固定小节：用户目标、用户明确提出的约束（原文引用）、已完成的动作与关键结果、已产生或交付的文件路径、遇到的错误、剩余待办。
3. 替换：把较早部分替换为一条带标记的摘要消息，放在系统提示词之后；再从会话事件中取出**所有用户消息原文**按时间顺序重新注入到摘要之后，使目标与约束不依赖摘要是否写全。用户消息总量本身过大时只保留最近的若干条原文，其余由摘要覆盖，并在摘要消息中说明。
4. 记录：发出一条压缩事件（W1 的事件类型中新增 `compact`，字段为压缩前后估算量、被摘要的轮数、摘要全文、重新注入的用户消息所对应的事件、摘要请求的 usage），界面显示“已压缩上下文”，开发者视图显示摘要全文。摘要与注入消息都在事件中，W3 的请求重建才能覆盖压缩后的请求。
5. 失败出口：摘要请求失败或返回空内容，按模型重试规则重试；仍失败则以 `context_limit` 结束，不静默丢弃历史。

摘要请求计入本次运行的模型请求数与 token 用量。

## 改动清单

- `domain/models/memory.py`：删除定点裁剪，增加按轮切分与替换的能力；
- 循环层：容量估算、压缩触发、结果整形；
- 新增压缩提示词（中英文）；
- `protocols/common.py`：截断前交出原始内容；
- 沙箱 `services/shell.py`：输出上限；
- `domain/models/event.py`：新增 `CompactEvent`，接口投影与前端类型同步；
- `AgentConfig` 或 `LLMConfig`：新增压缩水位、单条结果上限等配置，给出默认值。

## 验收

**自动测试（ScriptedLLM）：**

1. 构造超过水位的历史：触发压缩，摘要消息后紧跟用户原文，保留区原样，任何调用都有对应结果；
2. 压缩边界恰好落在一个多调用批次中间时，边界后移到批次之后；
3. 等待回复中的批次不进入摘要；
4. 摘要请求失败：重试后以 `context_limit` 结束；
5. 压缩后仍放不下：以 `context_limit` 结束；
6. 单条结果超限：模型收到预览与路径，沙箱中文件内容完整；写文件失败时退回截断并注明；
7. MCP 夹具返回 20,000 字符文本，尾部带标记：模型收到预览，用 `read_file` 可读到尾部标记；
8. 容量估算的四部分之和等于总估算值；
9. 请求重建：若 W3 已合入，在其重建测试中追加“压缩后的下一次请求可由事件重建”的用例；否则由 W3 实施时补上，并在交接中注明。

**评测：** 新增 E7（改编自 V05）：会话开头声明“不得覆盖 source.csv”，随后让 Agent 读取足够多的固定材料以触发至少一次压缩，最后要求输出 summary.json。检查：发生过压缩事件、source.csv 未被修改、结果正确。评测配置可调低 `context_window` 以稳定触发压缩，报告中写明配置值。同时复跑 E1–E6，确认没有回退。

## docs 同步

- [架构说明](../architecture.md)：“状态与持久化”中关于记忆与 `compact()` 的描述、控制参数表；
- [Harness 工程](../harness.md)：“决策层”的上下文清理段落；
- [能力与边界](../capabilities.md)：上下文清理、Context 预算、MCP/A2A 截断相关条目；
- [代码地图](../code-map.md)：上下文与记忆分组。

## 交接

下游依赖：`CompactEvent` 的字段；结果整形的落盘路径约定与 `called` 事件中的整形元数据；容量估算的四部分构成；新增配置项。W3 迁移事件存储时包含 `compact` 类型，并把估算构成写入轮次开始事件；W6 流式输出的 usage 结算要继续提供容量估算所需的 `prompt_tokens`；W7.3 调整执行身份后同步落盘目录。

交接接口（2026-09-28 实现）：

- **容量检查：** [`AgentLoop._ensure_capacity()`](../../ray_agent/api/app/domain/services/flows/agent_loop.py)，每轮在发出 `turn(started)` 之前执行。估算器 [`ContextBudget`](../../ray_agent/api/app/domain/services/context/budget.py) 以上一次请求的 `prompt_tokens` 为已知部分，按那次请求的字符估算比例分摊到四部分，其后新增的消息与工具 schema 差额按字符估算（中日韩字符 0.7 token/字，其余 0.3，每条消息另加 4）；没有 usage、或记忆被替换、清理后全部按字符估算。可用上限 `limit = context_window − max_tokens − ceil(context_window × context_safety_ratio)`，水位 `watermark = limit × compact_watermark`。
- **`context_estimate`（`turn(started)`）：** `system_prompt`、`tools`、`history`、`tool_results`（整数 tokens，四者之和即 `total`）、`total`、`limit`、`watermark`、`context_window`、`max_tokens`、`method`（`usage` 或 `chars`）。`history` 含 user、assistant 消息与摘要消息，`tool_results` 是 tool 消息。
- **压缩触发：** 估算超过水位时 `trigger=watermark`；服务端以上下文超长拒绝时，该轮以 `turn(completed, error="context_overflow")` 结束，随后 `trigger=overflow` 强制压缩一次并重发，同一轮再次被拒即失败。水位触发时，可摘要部分扣除重新注入的原文后不到可用上限的 15%，跳过压缩、不发摘要请求。
- **压缩产物：** 先发 `compact` 事件，再发 `context(op=replace)`，其 `messages` 是 system 之后的全部新消息：摘要消息（user 角色，以 `[上下文摘要]` 开头），被摘要范围内的用户原文（含对提问的回复，按时间顺序，总量不超过 `compact_user_chars`，从最近往前取），保留区原样。`compact` 字段：`trigger`、`before_estimate`、`after_estimate`（同 `context_estimate` 结构）、`summarized_turns`、`kept_turns`、`summary`（全文）、`reinjected_event_seqs`（重新注入原文对应的 `message` 事件 `seq`；提问回复不是 `message` 事件，没有对应项）、`omitted_user_messages`、`usage`（`attempts`、`prompt_tokens`、`completion_tokens`、`cached_tokens`）。运行账本把 `usage.attempts` 计入 `model_requests`，把 tokens 计入运行合计，不加轮数。SSE 事件名 `compact`，`data` 字段同上。
- **失败：** 摘要请求失败或返回空内容时按 `max_retries` 重试，仍失败则运行 failed，原因 `context_limit`，记忆不变；压缩后仍超过 `limit`，或 overflow 时没有可压缩的轮次，同样以 `context_limit` 失败。错误文本分别说明是摘要失败、估算超限还是服务端拒绝。
- **结果整形：** [`ResultShaper`](../../ray_agent/api/app/domain/services/context/shaping.py) 是执行后段最后一个处理函数。结果序列化后超过 `tool_result_max_chars`，或协议适配层带来了截断前的完整内容时触发。完整内容按“每字段一行、长文本原样展开”的格式写入沙箱 `/home/ubuntu/.rayagent/outputs/<call_id>.txt`（`call_id` 中 `[A-Za-z0-9_.-]` 以外的字符替换为 `_`），由运行器的 `_write_output()` 经沙箱 `write_file` 写入，目录不存在时由沙箱创建。进入记忆的预览是一个 `ToolResult`：`success`、`message`（前 500 字），`data` 含 `truncated`、`total_chars`、`total_lines`、`full_output_path`、`note`（读取提示或失败说明）、`head`（上限的 45%）、`tail`（上限的 20%），序列化后超过上限时首尾同比收缩。写入失败时 `full_output_path` 为空，`note` 说明不可再读。
- **整形元数据：** `tool(called)` 事件与 SSE 的 `shaping` 字段为 `original_chars`（完整内容字符数）、`preview_chars`、`truncated`、`full_output_path`、`error`；未整形时为空。`function_result` 是进入上下文的预览；运行器在进程内用整形前的结果填充搜索结果等展示内容。
- **落盘目录与执行身份：** 当前沙箱服务以 root 运行，目录由 root 创建。W7.3 改为普通用户执行后，需保证该用户对 `/home/ubuntu/.rayagent/outputs` 可写并可被 `read_file` 读取；若改路径，同步 `shaping.OUTPUT_DIR` 与中英文系统提示词里的路径（`prompts/system.py`、`prompts/en/system.py` 的文件规则各一处）。
- **配置项（`AgentConfig`）：** `context_safety_ratio`（0.05）、`compact_watermark`（0.75）、`compact_keep_turns`（3，保留区含 system 与工具 schema 超过水位的 60% 时逐步减到 1）、`compact_user_chars`（16000）、`tool_result_max_chars`（8000）。`GET/POST /api/app-config/agent` 可读写；设置页尚未提供编辑项。
- **给 W4/W5：** `context.op` 取值改为 `append`、`strip_reasoning`、`replace`；需要消费 `compact` 事件（界面显示“已压缩上下文”，开发者视图显示摘要全文）、`tool.shaping`（工具卡显示“完整输出已保存”或“不可再读”）、`turn(started).context_estimate`（上下文环与构成）。本包未改 `ray_agent/ui/`。
- **给 W6：** 容量估算依赖每次成功请求的 `prompt_tokens`（`AgentLoop._request_model()` 在成功后调用 `budget.record_usage()`）；流式结算缺少 usage 时估算退回全部按字符计算，仍可工作但偏保守。超长拒绝识别在 `openai_llm._is_context_exceeded()`（400/413 且错误码或信息含上下文长度标记），换模型客户端时需提供同样的 `LLMRequestError.context_exceeded`。
- **沙箱 Shell：** 单个会话的累积输出按字符计上限约 1 MB，超出上限 256K 后裁剪一次，只保留尾部并以截断标记开头；该会话较早的控制台记录合计超限时清空为标记。

未决：浏览器与 A2A 的大结果只有单元路径覆盖，没有真实运行记录；E7 只跑 1 次；服务端超长拒绝没有真实拒绝的运行记录；W2 未改 UI，`compact` 事件与整形元数据在页面上尚无展示。

## 实施修正（2026-09-28）

实施中以代码为准修正了本文以下内容：

1. “现状”改为标注 W3 提交 `c0822dc` 的快照，去掉已失效的行号链接。
2. **`context` 事件的 `op`：** W3 的 `compact` 改名为 `strip_reasoning`（浏览器正文替换已删除，只剩删除推理字段），新增 `replace`。旧值 `compact` 在读取时按 `strip_reasoning` 解析，这偏离了总计划“不兼容旧数据”的原则。原因是开发库由并行的工作包共用，不清库也能读回 W3 期间的旧事件。代价是：旧运行里曾被替换的浏览器正文，在请求重建中会显示为原文。W8 收口时可删除这条兼容。
3. **`replace` 携带替换后的全部消息：** `replace` 事件记录 system 之后的完整新序列，而不是差量，请求重建直接替换即可。验收 9 在 `test_turn_events_rebuild.py` 中由运行器驱动真实循环完成压缩；`test_run_events_pg.py` 另加 JSONB 往返用例，覆盖 `compact`、`shaping`、运行计数与重建。
4. **保留轮数可变，并设最小收益：** 保留区（含 system 与工具 schema）超过水位的 60% 时，K 从 3 逐步减到 1，给摘要和用户原文留空间。E7 冒烟中出现过一次无效压缩：只摘要了一条很短的回复，却保留了一个读入 6 份材料的大批次，估算不降反升（15226 → 15413），白白多了一次摘要请求。因此增加规则：水位触发时，可摘要部分扣除重新注入的原文后不足可用上限的 15%，就跳过压缩；overflow 触发时仍强制压缩。
5. **用户原文的来源：** 原文说“从会话事件中取出所有用户消息原文”，实现改为取被摘要范围内记忆中的用户原文，再按顺序匹配会话 `message` 事件的 `seq`。这样既包含对提问的回复（它不是 `message` 事件），又排除循环自己写入的 `[系统提示]` 与上一次的摘要；保留区里的用户消息原位不动，不会重复注入。上一次重新注入的原文在下次压缩时会再次进入摘要范围，因此仍会被重新注入。
6. **服务端超长拒绝：** 由 `LLMRequestError.context_exceeded` 标识，判定条件是 400/413 且错误码或信息含上下文长度关键字。该轮以 `turn(completed, error="context_overflow")` 结束后强制压缩并重发，压缩事件的 `trigger` 为 `overflow`。
7. **摘要请求的计数：** 每次尝试计入循环的模型请求数（受 `max_iterations` 约束），由账本按 `compact.usage` 计入运行合计，不写 `turn` 事件。评测脚本的逐轮核对同时累加 `turn(completed)` 与 `compact.usage`。
8. **预览格式：** 完整内容不落原始 JSON，而是按“每字段一行、长文本原样展开”的格式落盘，使 `read_file` 的行号有意义。预览的 `data` 增加 `total_lines`；首尾比例为上限的 45% 与 20%，转义导致超限时同比收缩。协议结果经 `ToolResult` 的私有字段带上截断前的内容，只在进程内传给整形步骤；只要协议层截断过，即使预览不超过上限也会落盘。
9. **Shell 上限：** 按 Python 字符数计，而不是字节数；超出上限 256K 才裁剪，避免每次追加都复制整段输出；同一会话较早的控制台记录合计超限时一并清空为标记。沙箱没有测试套件，这部分由手工脚本验证：写入约 2.8 MB 后保留 1,290,282 字符，以截断标记开头。
10. **提示词写死落盘路径：** 中英文系统提示词的文件规则各增加一行，说明预览、路径 `/home/ubuntu/.rayagent/outputs/` 与分段读取方式；另在循环说明中增加一行，说明 `[上下文摘要]` 消息。W7.3 改路径时需同步这三处（两份提示词与 `OUTPUT_DIR`）。
11. **搜索结果展示用整形前的结果：** `tool(called)` 事件的 `function_result` 是进入上下文的预览；运行器填充搜索展示内容时改用进程内保留的整形前结果，页面不受整形影响。
12. **`context_estimate` 的内容：** 在四部分之外还记录 `total`、`limit`、`watermark`、`context_window`、`max_tokens` 与估算方式 `method`。字符系数为中日韩字符 0.7、其余 0.3、每条消息加 4；真实首轮的字符估算为 4920，实际 `prompt_tokens` 为 4485，偏保守约 10%，有 usage 后按实际值校准。
13. **E7 的具体形态：** 共 4 轮：声明约束；在一轮内读 m01–m06；在一轮内读 m07–m12；输出并交付 `summary.json`（`source_total` 与 12 个校验码）。每份材料约 2,300 字符，校验码放在中段。读取分两轮，是为了让模型即使一次回复读完 6 份，单轮最大体量也在可用上限之内。任务期间经 `POST /app-config/llm` 把 `context_window` 调为 24576、`max_tokens` 调为 4096（可用上限 19251、水位 14438），结束后在 `finally` 中恢复；报告的检查项记录了这两个值和恢复值。第一次冒烟时，“每次回复只读一份”被理解为每轮只读一份，模型改用 grep 取校验码，没有触发压缩；措辞改为“在这一轮里依次完整读取、不要用 shell 提取片段”。
14. **`Memory.compact()` 删除，改为 `strip_reasoning()`：** 原浏览器结果替换的回归用例改为断言新用户消息只删推理字段、页面正文保留。
