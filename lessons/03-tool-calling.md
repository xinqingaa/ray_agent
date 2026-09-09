# Tool calling and structured output

看模型如何声明并调用工具，以及用 Pydantic / JSON 约束输出。

跑 `labs/foundations/` 下：`3_7_为ReAct Agent添加计算工具.py`、`3_8_Pydantic解析数据.py`、`3_8_Pydantic结合Tool Calls实现数据提取.py`、`3_9_DeepSeek JSON Output示例.py`。入口见 [基础实验](../labs/foundations/README.md)。

这里的一次 tool call 不能当成产品主循环。ReAct 多轮在 [04](04-context-and-react.md)，产品工具组装在 [10](10-models-and-tools-in-the-product.md)。
