# A2A 实验

比较 SDK 与手写 HTTP 客户端如何发现并调用同一个 Agent。教学入口见 [lessons](../../lessons/README.md)，产品协议接入见 [架构说明](../../docs/architecture.md)。

| 入口 | 作用 |
|---|---|
| [main.py](main.py) | 组装 Agent Card、请求处理器和 SDK 服务端，监听 `9999` |
| [agent_executor.py](agent_executor.py) | 接收消息并调用模型，生成返回消息 |
| [client.py](client.py) | 使用 SDK 读取卡片并发送消息 |
| [httpx_a2a.py](httpx_a2a.py) | 用 HTTP 请求读取卡片并发送 JSON-RPC 消息 |

## 运行入口

在 `labs/a2a/` 执行，需要 Python 3.12+ 和 uv：

```bash
uv sync --locked
uv run --locked python main.py
```

运行前核对 `agent_executor.py` 中的模型地址、名称和凭据占位值。该示例直接在代码中配置模型，未提供统一的环境变量加载入口；实际凭据仅供本地使用。

服务运行后，在另一个终端进入同一目录，分别运行客户端：

```bash
uv run --locked python client.py
uv run --locked python httpx_a2a.py
```

客户端默认访问 `http://localhost:9999`。跨设备运行时需同时核对客户端地址和 Agent Card 中的服务地址。

依赖以本目录 [pyproject.toml](pyproject.toml) 和 [uv.lock](uv.lock) 为准，协议升级时核对服务端和两种客户端的行为。示例的流式能力关闭，执行器未实现取消；不要将其视为完整能力示范。

以上入口已静态核对，尚未完成运行验证。
