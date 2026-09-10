# 基础实验

通过独立脚本观察模型调用、工具执行、异步服务和浏览器操作。教学顺序见 [lessons](../../lessons/README.md)，实验总体说明见 [labs](../README.md)。

## 主题导航

| 脚本组 | 内容 |
|---|---|
| `3_4`～`3_6` | 模型 API、流式输出、SDK 和多模态 |
| `3_7`～`3_10` | 工具调用、Pydantic、结构化输出与响应展示 |
| `3_11` | 语音交互示例 |
| `4_1`～`4_4` | 工具反馈循环、上下文与 ReAct 实验 |
| `4_5`～`4_6` | 同步、异步与 FastAPI |
| `6_5`～`6_11` | MCP 2.2 服务端、客户端、手写对照与外部工具 |
| `10-4`、`10-6` | 浏览器操作与 CDP |
| [demo-code/](demo-code/) | 模型与 Agent 综合示例 |
| [天气 Agent 入口](<2-2 code/weather/__main__.py>)、[交互界面入口](<2-2 code/ui/main.py>) | A2A 配套示例 |

## 运行入口

顶层脚本使用本目录的 [pyproject.toml](pyproject.toml) 与 [uv.lock](uv.lock)，需要 Python 3.12+ 和 uv。例如，在本目录准备依赖后运行模型调用示例：

```bash
uv sync --locked
uv run --locked python '3_4_Chat Completions API调用.py'
```

聊天模型脚本读取 `LLM_API_KEY`、`LLM_MODEL_NAME`、`LLM_BASE_URL`，先看本目录 `.env`，缺项再读 `ray_agent/.env`。字段与产品相同，可写同一组值。高德、浏览器等其他凭据仍看各自入口。

`demo-code/`、`2-2 code/weather/` 和 `2-2 code/ui/` 分别维护独立环境，应在对应目录运行。保留 `resources/` 等资源的相对路径。

## 模型交互对照

在本目录使用前述依赖环境运行。两个 `3_4` 脚本按 OpenAI 兼容的 Chat Completions 构造请求，三项都从 `LLM_*` 读取，没有默认厂商地址或模型名。不要将密钥提交到仓库。比较两个脚本时保持同一套配置。

```bash
uv run --locked python '3_4_Chat Completions API调用.py'
uv run --locked python '3_4_Chat Completions API流式调用.py'
```

两者询问同一个问题：“请用一句话说明：为什么写入文件后还要读取确认？”普通脚本打印完整 JSON、正文和结束原因；流式脚本逐段打印正文，最后输出拼接结果和结束原因。缺少密钥会在发出请求前退出；HTTP 错误不会作为回答解析。超时参数分别限制连接等待和读取等待，不是整次任务的总时限。

流式脚本处理该 Chat Completions 接口的一行 `data:` JSON 与 `[DONE]` 约定，跳过空行、注释和无候选回答的统计块，不是通用 SSE 客户端。缺少结束标记或结束原因时会报告部分结果；`length` 等原因会原样显示，不代表完整回答。需要推理输出或工具调用的场景不在这两个文本实验的展示范围内。

客户端回归验证使用本地 HTTP 服务，不访问外部模型：

```bash
uv run --locked python -m unittest discover -s tests -p test_model_interaction.py -v
```

覆盖同输入对照、首段在服务端结束前显示、空增量与统计块、长度结束原因、缺失结束标记、HTTP 错误及缺少密钥。真实模型调用的课程验证状态见 [制作进度](../../lessons/progress.md)。

## 工具调用与结构化输出

在本目录使用前述依赖环境和 `LLM_*` 配置。`3_7` 观察一次工具执行：模型返回 `tool_calls` 后，程序按名字调用 `calculator`，把结果以 `role: tool` 追加到消息，再请求一次模型。文件名和类名含 ReAct，控制流却是执行后用 `tool_choice="none"` 强制生成文本，不是持续反馈循环。计算器在本进程里计算表达式，不写 hello.txt，也不经过沙箱。

```bash
uv run --locked python '3_7_为ReAct Agent添加计算工具.py' '计算 12+30'
uv run --locked python '3_8_Pydantic解析数据.py'
uv run --locked python '3_8_Pydantic结合Tool Calls实现数据提取.py'
uv run --locked python '3_9_JSON Output示例.py'
```

`3_7` 带参数时只处理这一句；不带参数则进入交互输入，输入 `quit` 结束。`3_8` 解析脚本不需要模型密钥，用于观察 `arguments` 字符串的校验成败。另外两个脚本需要密钥：`3_8` 的 tool calls 示例强制模型按 schema 交数据，并不执行业务函数；`3_9` 把 JSON 放在 `content` 里。缺少密钥会在发出请求前退出。

本地回归不访问外部模型：

```bash
uv run --locked python -m unittest discover -s tests -p test_tool_actions.py -v
```

覆盖参数校验、无工具时不执行、`tool_calls` 执行后以 `role: tool` 回传并带上 `tool_choice="none"`，以及强制 `tool_choice` 抽取字段。真实模型是否提出调用见 [制作进度](../../lessons/progress.md)。

## 工具反馈循环

在本目录使用前述依赖环境和 `LLM_*` 配置。`4_1` 观察最小反馈循环：有 `tool_calls` 就执行并再请求，没有则停止，达到 `max_iterations` 则报错。再次请求不使用 `tool_choice="none"`。`write_file` / `read_file` 写在进程内存里，不经过沙箱，默认问题是写入 hello.txt 再读取。

```bash
uv run --locked python '4_1_工具反馈循环.py'
uv run --locked python '4_1_工具反馈循环.py' '请把 hello 写入 hello.txt，再读取文件，告诉我里面是什么。'
```

`4_3` 与 `3_7` 同类：执行后用 `tool_choice="none"` 强制生成文本，不是持续反馈。`4_4` 用递归再请求实现同一条继续条件，可走多步报销表单，但没有迭代上限，也不是产品 Planner。`4_3`、`4_4` 默认进入交互输入，输入 `quit` 结束。缺少密钥会在发出请求前退出。

本地回归不访问外部模型：

```bash
uv run --locked python -m unittest discover -s tests -p test_agent_loop.py -v
```

覆盖只有 `content` 时停止、写入后再读取会继续请求、工具不结束时按上限停止，以及 `3_7` 第二次调用带 `tool_choice="none"`。真实模型是否连续提出写入和读取见 [制作进度](../../lessons/progress.md)。

## MCP 2.2 可复现基线

本目录锁定 `mcp==2.2.0`，客户端显式采用 `2026-07-28` 协议，不回退到旧 `initialize` 握手。

stdio 闭环会由客户端启动本地计算器服务：

```bash
uv run --locked python 6_7_mcp-client-demo.py
uv run --locked python 6_7_mcp-client-with-exit-stack.py
```

两条命令都应发现 `calculator` 并得到结果 `42`。

Streamable HTTP 闭环需要两个终端：

```bash
uv run --locked python 6_9_mcp-code.py
```

```bash
uv run --locked python 6_9_mcp-client.py
```

客户端应发现 `run_code` 并得到结果 `42`。以上 stdio 与 HTTP 闭环已在 macOS/Python 3.12 下实际验证，不需要模型密钥或外部网络。

## 对照与非基线示例

- `6_5_无MCP SDK调用高德MCP.py` 保留手写请求，用于观察不使用 SDK 时需要自行承担的协议处理。
- `6_7_ReAct-Agent-with-mcp.py` 已适配 MCP 2.2，但运行还需要模型密钥。
- `6_8_mcp-bash.py`、`6_10_mcp-external-api.py` 和 `6_11_mcp-client-connect-api.py` 分别依赖本机 Shell 或外部服务，不作为离线验收条件；`6_11` 需要 `BAIDU_MCP_TOKEN`，且对端必须支持目标协议。
- `demo-code/`、`2-2 code/weather/` 和 `2-2 code/ui/` 是独立历史综合环境，不属于阶段 3 的协议教学基线。其中 UI 示例还依赖仓库未包含的上游模块，不能表述为当前可运行示例。

本文件只声明实际验证过的入口；具体概念与产品对照由 lessons 讲解。
