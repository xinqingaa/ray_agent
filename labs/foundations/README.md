# 基础实验

通过独立脚本观察模型调用、工具执行、异步服务和浏览器操作。教学顺序见 [lessons](../../lessons/README.md)，实验总体说明见 [labs](../README.md)。

## 主题导航

| 脚本组 | 内容 |
|---|---|
| `3_4`～`3_6` | 模型 API、流式输出、SDK 和多模态 |
| `3_7`～`3_10` | 工具调用、Pydantic、结构化输出与响应展示 |
| `3_11` | 语音交互示例 |
| `4_2`～`4_4` | 上下文与 ReAct 实验 |
| `4_5`～`4_6` | 同步、异步与 FastAPI |
| `6_5`～`6_11` | MCP 2.2 服务端、客户端、手写对照与外部工具 |
| `10-4`、`10-6` | 浏览器操作与 CDP |
| [demo-code/](demo-code/) | 模型与 Agent 综合示例 |
| [天气 Agent 入口](<2-2 code/weather/__main__.py>)、[交互界面入口](<2-2 code/ui/main.py>) | A2A 配套示例 |

## 运行入口

顶层脚本使用本目录的 [pyproject.toml](pyproject.toml) 与 [uv.lock](uv.lock)，需要 Python 3.12+ 和 uv。例如，在本目录准备依赖后运行模型调用示例：

```bash
uv sync --locked
uv run --locked python '3_4_DeepSeek API调用.py'
```

该示例从本地环境读取 `DEEPSEEK_API_KEY`。其他脚本的凭据、服务地址、输入设备或浏览器要求需查看各自入口，不能假设全部脚本使用相同配置。

`demo-code/`、`2-2 code/weather/` 和 `2-2 code/ui/` 分别维护独立环境，应在对应目录运行。保留 `resources/` 等资源的相对路径。

## 模型交互对照

在本目录使用前述依赖环境运行。配置 `DEEPSEEK_API_KEY`，可从本地 `.env` 加载；不要将密钥提交到仓库。两个 `3_4` 脚本默认使用 `deepseek-chat`，可通过 `DEEPSEEK_MODEL` 指定当前服务可用的模型；比较时保持该配置一致。

```bash
uv run --locked python '3_4_DeepSeek API调用.py'
uv run --locked python '3_4_DeepSeek API流式调用.py'
```

两者询问同一个问题：“请用一句话说明：为什么写入文件后还要读取确认？”普通脚本打印完整 JSON、正文和结束原因；流式脚本逐段打印正文，最后输出拼接结果和结束原因。缺少密钥会在发出请求前退出；HTTP 错误不会作为回答解析。超时参数分别限制连接等待和读取等待，不是整次任务的总时限。

流式脚本处理该 Chat Completions 接口的一行 `data:` JSON 与 `[DONE]` 约定，跳过空行、注释和无候选回答的统计块，不是通用 SSE 客户端。缺少结束标记或结束原因时会报告部分结果；`length` 等原因会原样显示，不代表完整回答。需要推理输出或工具调用的场景不在这两个文本实验的展示范围内。

客户端回归验证使用本地 HTTP 服务，不访问外部模型：

```bash
uv run --locked python -m unittest discover -s tests -p test_model_interaction.py -v
```

覆盖同输入对照、首段在服务端结束前显示、空增量与统计块、长度结束原因、缺失结束标记、HTTP 错误及缺少密钥。真实模型调用的课程验证状态见 [制作进度](../../lessons/progress.md)。

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
