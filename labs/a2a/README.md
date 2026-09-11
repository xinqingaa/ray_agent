# A2A 实验

使用 `a2a-sdk==1.1.2` 比较 SDK 与手写 HTTP 客户端如何按 A2A 1.0 JSON-RPC 发现并调用同一个 Agent。教学入口见 [lessons](../../lessons/README.md)，产品协议接入见 [API 指南](../../ray_agent/api/README.md#mcpa2a)。

| 入口 | 作用 |
|---|---|
| [main.py](main.py) | 组装 1.0 Agent Card、官方请求处理器和路由，监听 `9999` |
| [agent_executor.py](agent_executor.py) | 默认返回确定性结果；可显式切换为模型调用 |
| [client.py](client.py) | 使用 `A2ACardResolver` 和 `ClientFactory` 读取卡片并发送消息 |
| [httpx_a2a.py](httpx_a2a.py) | 手写 1.0 JSON-RPC 请求，用于观察 SDK 封装的协议细节 |

## 可复现基线

在 `labs/a2a/` 执行，需要 Python 3.12+ 和 uv：

```bash
uv sync --locked
uv run --locked python main.py
```

服务运行后，在另一个终端进入同一目录，分别运行客户端：

```bash
uv run --locked python client.py
uv run --locked python httpx_a2a.py
```

两个客户端都会发送 `ray-agent-lab`，通过条件是收到 `A2A_LAB_OK:ray-agent-lab`。该闭环不需要模型密钥，已在 macOS/Python 3.12 下实际验证。

## 可选模型模式

如需观察模型委派，在启动服务前设置：

```bash
export A2A_LAB_MODE=deepseek
export LLM_API_KEY=...
export LLM_BASE_URL=https://api.deepseek.com
export LLM_MODEL_NAME=deepseek-reasoner
```

模型模式不属于阶段 2 的可复现验收基线。客户端默认访问 `127.0.0.1:9999`；跨设备运行时需同时修改客户端地址和 Agent Card 公布地址。

依赖以本目录 [pyproject.toml](pyproject.toml) 和 [uv.lock](uv.lock) 为准。示例只覆盖非流式 Message 回复，未实现任务轮询、远程取消、认证和推送通知；这些完整行为由主产品协议测试覆盖。
