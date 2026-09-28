# W0：基线与评测

所属：[二次开发总计划](README.md)。前置：无。规模：小，1 个对话。

## 目标与不做

**目标：** 在改动执行内核之前，建立一套能复跑的端到端评测，并在旧实现上产出基线；同时提供确定性的模型替身，供 W1 起的循环测试使用。

**不做：** 不修改产品行为（包括已知缺陷）；不建设评测平台、打分模型或成功率统计；不接入公网商业站点。

## 现状

- 模型接口是 `Protocol`，只有 `invoke(messages, tools, response_format, tool_choice)` 与四个只读属性（[`domain/external/llm.py`](../../ray_agent/api/app/domain/external/llm.py)），替身实现成本低。
- 已有测试替身散落在各测试文件内（如 `test_planner_react_flow.py` 的内联 `invoke`，该文件已在 W1 删除），没有可复用的脚本化模型。
- 用量已按模型调用发出 `UsageEvent`，工具调用有 `calling/called` 两条 `ToolEvent`，都随会话事件保存，可通过 `GET /sessions/{id}` 读回，足以统计评测指标。
- [labs/verification](../../labs/verification/README.md) 列有 V01–V05 五条任务样本，没有自动运行入口；协议测试已有可自启的 MCP/A2A 夹具（[`tests/protocols/fixture_server.py`](../../ray_agent/api/tests/protocols/fixture_server.py)）。

## 设计

### 基线 tag

在 `082e825` 之后、任何产品改动之前创建 tag `baseline-v1`，含义是“旧 Plan + ReAct 实现与 16 章旧课程的共同基线”。

### 脚本化模型替身

在 API 测试支撑目录（如 `tests/support/scripted_llm.py`）实现 `ScriptedLLM`：

- 构造时接收有序的响应脚本，每项是助手文本、工具调用列表（含 id、name、arguments 字符串）、可选 finish_reason 与 usage，或一个待抛出的异常（模拟传输错误）；
- 每次 `invoke` 记录收到的 messages 与 tools 副本，返回下一项；脚本耗尽时抛出明确异常；
- 支持按条件返回（例如根据最后一条 tool 消息内容选择分支），但保持简单，复杂分支在测试里组合。

W1 起所有循环测试使用它；W3 用它记录实际请求以验证请求重建；W6 在其上扩展流式分片。

### 评测脚本

位置建议 `ray_agent/api/scripts/eval/`，复用 API 的依赖环境（httpx 已可用）。通过 HTTP API 驱动完整产品：创建会话 → 上传材料 → 发送消息 → 消费 SSE 直到终态 → 需要时按脚本回复提问或请求停止 → 读回会话详情与文件 → 下载产物检查。

每条任务是一个声明式定义：输入消息、上传材料、交互脚本（例如“出现提问时回复 X”“开始 N 秒后停止”）、检查函数。

| ID | 任务 | 检查 |
|---|---|---|
| E1 | 纯回答与跨轮记忆：第一轮“记住本会话校验词是青松”，第二轮问校验词 | 第二轮回复含“青松”；第一轮不强制调用工具 |
| E2 | 文件交付（V01）：上传 `source.csv`，要求统计 amount 总和输出 `summary.json` 并提供下载 | 下载到的 JSON 中 total 为 60；源文件字节不变 |
| E3 | 提问续接：请求中故意缺少必要参数（如输出文件名），要求先询问 | 出现提问并等待；回复后继续完成并交付 |
| E4 | 长命令与停止：让 Agent 启动每秒写一行标记的脚本，开始后请求停止 | 记录终态、停止后 5 秒内标记是否继续增长（通过会话 Shell 或文件读取接口观察） |
| E5 | 浏览器取事实：访问一个受控本地页面（评测脚本自启静态服务，沙箱可达的地址按运行指南配置）并提取指定字段 | 回复含页面上的固定字段 |
| E6 | MCP 调用：配置协议夹具的 add 工具，请求计算两数之和 | 回复含正确结果，且有对应 MCP 工具事件 |

W2 追加 E7（长上下文，改编自 V05）。环境不满足时（例如沙箱访问不到本地页面），该任务记为“跳过：原因”，不算通过。

### 指标与报告

每条任务每次运行记录：终态、墙钟耗时、模型调用次数、prompt/completion tokens 合计、工具调用次数与按工具名的分布、检查结果、会话 ID。输出 JSON 原始数据加一份 Markdown 汇总，存放在 `docs/plan/evidence/`，文件名含日期与代码提交短哈希。

同一任务默认跑 1 次；需要比较时由调用方指定次数。报告必须写明模型名、`temperature`、`max_tokens`、`context_window` 与 Agent 配置，否则不同报告不可比较。

## 改动清单

- 新增 `tests/support/scripted_llm.py` 及其自测；
- 新增 `scripts/eval/`：任务定义、运行器、报告生成；
- [API 开发指南](../../ray_agent/api/README.md) 增加评测的运行前提（Compose 已启动、模型已配置）与命令；
- 新增 `docs/plan/evidence/` 下的基线报告。

## 验收

- `ScriptedLLM` 自测通过；
- 在本机 Compose 与真实模型上，E1–E6 各至少运行 1 次并生成报告；失败或跳过的任务如实记录原因。基线报告反映旧实现的真实表现，不因结果不好而调整任务。

## docs 同步

- [API 开发指南](../../ray_agent/api/README.md)：评测命令与前提；
- 本计划第 5、6 节。其他 docs 不变，因为产品行为没有变化。

## 交接

下游依赖：`ScriptedLLM` 的接口；评测脚本的任务注册方式与报告格式；基线报告路径。评测脚本只依赖公开 HTTP 接口与事件类型，W1 保留现有事件类型，W3 改变事件接口时由 W3 同步更新脚本的事件读取部分。
