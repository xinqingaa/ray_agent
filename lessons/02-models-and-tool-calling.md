# Models and tool calling

Status: stub
Area: Models and tools
Prerequisites: [01](01-application-flow.md) 的模块边界

## 1. Learning objectives and prerequisites

- 能说明 Chat Completions 里消息、流式输出、tool calls、JSON/结构化输出分别解决什么问题。
- 能在产品里找到模型适配和工具声明，并指出参数 schema 必须与实现一致。
- 前置：本机 Python 3.12+、`uv`；Recommended 脚本需要模型 Key。安装见 [基础实验](../labs/foundations/README.md)。

## 2. Essential concepts and a runnable example

| 档位 | 脚本（均在 `labs/foundations/`） |
|---|---|
| Recommended | `3_4_DeepSeek API调用.py`、`3_4_DeepSeek API流式调用.py`、`3_7_为ReAct Agent添加计算工具.py`、`3_8_Pydantic解析数据.py`、`3_8_Pydantic结合Tool Calls实现数据提取.py`、`3_9_DeepSeek JSON Output示例.py` |
| Optional | `3_5_Kimi多模态API测试.py`、`3_6_OpenAI SDK重构代码.py`、`3_6_OpenAI SDK重构多模态LLM调用.py`、`3_10_使用流式输出提升响应速度.py` |
| Skip | `3_11_DeepSeek语音播报助手.py`（语音，产品主路径不覆盖） |

产品模型字段写在 Compose / API 的 `LLM_*`，协议为 OpenAI 兼容 Chat Completions。不要把密钥写进已跟踪的 `config.yaml`。

TODO：跑 Recommended 脚本后，把可见输入输出补进本课。未跑标 `unverified`。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 工具基类与装饰器 | `ray_agent/api/app/domain/services/tools/base.py`、`tool.py` |
| 工具调用兼容 | `domain/services/agents/tool_call_compat.py` |
| 内置文件 / Shell / 浏览器 | `tools/file.py`、`shell.py`、`browser.py` |
| 模型配置回落 | `ray_agent/api/config.yaml` 的 `llm_config`（被环境变量覆盖） |

TODO：从「模型返回 tool_calls」追到 `BaseTool` 执行，再回到消息上下文。完整 ReAct 循环见 [03](03-react-loop.md)。

## 4. Design rationale, limitations, and relevant failure behavior

- lab 里给模型一个计算器，只证明「这种 API 能调工具」，不证明产品会规划多步。
- 产品要求模型支持工具调用；不支持时任务会在模型环路失败。
- 多模态与语音脚本不进入本课验收。

## 5. Understanding checks or a focused observation experiment

- `LLM_BASE_URL` / `LLM_MODEL_NAME` / `LLM_API_KEY` 各控制什么？改 `.env` 后为什么不能只 `restart` 容器？
- 新增一个内置工具时，除了实现函数，还要改哪些声明或组装点？（先列问题，答在正文里）
- 结构化输出和 tool calls 分别在什么场景更合适？
