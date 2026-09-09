# A2A labs

看 A2A 1.0 如何用 Agent Card 发现对端，再用 JSON-RPC 发消息；对照 SDK 客户端和手写 HTTP。

在 `labs/a2a/` 先起 `main.py`，再分别跑 `client.py` 和 `httpx_a2a.py`。期望：发送 `ray-agent-lab`，收到 `A2A_LAB_OK:ray-agent-lab`。步骤见 [A2A 实验](../labs/a2a/README.md)。基线无需 Key。

`2-2 code/weather/` 与 `2-2 code/ui/` 是历史综合，不进本课、不写运行步骤。模型模式 `A2A_LAB_MODE=deepseek` 可选，不是验收。

实验里的服务端不能当成产品职责。产品是客户端，见 [14](14-mcp-and-a2a-in-the-product.md)。
