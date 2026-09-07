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
| `6_5`～`6_11` | MCP 服务端、客户端与外部工具 |
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

命令来自脚本和配置核对，尚未逐一运行验证。本文件提供导航，具体概念与产品对照由 lessons 讲解。
