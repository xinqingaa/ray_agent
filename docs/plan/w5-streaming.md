# W5：模型流式输出

所属：[二次开发总计划](README.md)。前置：W4（界面入口）；W3（通知通道）。规模：中，1 个对话。

## 目标与不做

**目标：** 模型生成期间页面逐步显示文本；工具调用参数在完整接收并校验后才执行；断流、停止、刷新之后页面不残留半截内容。

**不做：** 切换到 Responses API；推理内容（reasoning）的流式展示；工具参数的流式预览；量化性能目标。

## 现状

- 模型适配只用非流式 `chat.completions.create`，超时硬编码 3600 秒（[`openai_llm.py`](../../ray_agent/api/app/infrastructure/external/llm/openai_llm.py) 第 40、75–95 行）。
- 用量从响应的 `usage` 字段解析（[`llm/usage.py`](../../ray_agent/api/app/infrastructure/external/llm/usage.py)），W2 的容量估算依赖 `prompt_tokens`。
- W1 之后循环依赖 `finish_reason` 判断截断，W3 之后事件经数据库与通知送达页面。

## 设计

### 模型适配

- 新增流式调用路径：`stream=True`，并请求 `stream_options={"include_usage": True}`（供应商不支持时自动去掉该参数重试一次，并在之后的请求中不再携带）。
- 按 `choices[0].delta` 组装：文本片段顺序拼接；`tool_calls` 片段按 `index` 聚合，首个带 id 的片段确定 call ID，`function.arguments` 按顺序拼接；记录最后的 `finish_reason` 与末尾 chunk 中的 usage。
- 返回值与非流式相同的完整结果（message、finish_reason、usage），另通过回调逐段交出文本增量。循环层对完整结果的处理与 W1 一致：没有正常的 `finish_reason`（流在中途结束、连接断开）视为传输错误，按模型重试规则重试，**不执行任何调用**。
- 保留非流式路径，由配置项选择，默认启用流式。`tool_call_compat` 的内嵌调用解析在完整文本组装后执行。
- 顺带把 3600 秒超时改为配置项，流式时作用于首个 chunk 与 chunk 间隔。

### 增量事件

- 文本增量只经 Redis 通知推送，不写数据库：`{session_id, run_id, attempt, delta}`。`attempt` 在同一运行内每次模型请求（含重试）递增。
- 完整的助手消息照常作为事件写入数据库，带上 `attempt`。
- events SSE 把增量作为独立的事件类型推送给当前连接，不分配 seq，重连时不补发。

### 前端

- 在时间线末尾维护一个“生成中”的临时条目，按 `attempt` 累积增量；收到同一 `attempt` 的完整助手消息时，用它替换临时条目；
- 收到更大的 `attempt`、运行进入终态或页面刷新时，丢弃临时条目；
- 未收到增量的供应商或非流式配置下，页面行为与 W4 一致。

## 改动清单

- `infrastructure/external/llm/openai_llm.py`：流式路径与组装；`domain/external/llm.py`：增量回调参数；
- 循环层：传入增量回调、维护 attempt；
- 运行器与通知：增量发布；
- events SSE：推送增量事件类型；
- 前端：临时条目的累积、替换与丢弃；
- `ScriptedLLM`：支持按 chunk 返回，以测试组装逻辑。

## 验收

**自动测试：**

1. 文本与两个工具调用交错分片（参数分成多段、id 只出现在首段）：组装结果与非流式一致；
2. 流在工具参数中途结束：不执行调用，按重试规则重试；
3. `finish_reason=length`：沿用 W1 的截断处理；
4. usage 只出现在最后一个 chunk、或完全缺失：前者正确记账，后者标记用量不可用、容量估算退回字符估算；
5. 供应商拒绝 `stream_options`：去掉后重试成功；
6. 前端观察脚本：增量累积、完整消息替换、更大 attempt 丢弃旧临时条目、终态后无临时条目。

**真实浏览器：** 运行 E1 与 E2，观察文本逐步出现；生成过程中停止，临时内容消失并显示“已停止”；生成过程中刷新，页面只显示已保存的完整内容。记录首段文本出现时间与总耗时，写入评测报告，不设通过阈值。

## docs 同步

- [架构说明](../architecture.md)：事件与投影中的增量通道；
- [设计取舍](../decisions.md)：“模型调用不走流式”改写为新选择，保留原复杂度分析；
- [能力与边界](../capabilities.md)：流式输出条目；
- [代码地图](../code-map.md)：模型调用与事件分组。

## 交接

下游依赖：增量事件的字段；`attempt` 的含义；流式配置项。W7 在综合验收中覆盖流式与停止、压缩同时发生的情况。
