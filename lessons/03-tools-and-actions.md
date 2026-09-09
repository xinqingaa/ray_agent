# 工具与行动

模型提出的动作如何真正执行？

## 叙述方向

解释同一条 message 上 `content` 与 `tool_calls` 的分流，以及工具声明、参数约束与程序执行的分工。沿一次调用追踪结果如何以 `role: tool` 返回模型。以 `tool_calls` 为主路径；旧字段 `function_call` 只作对照。若模型把 Anthropic 风格 `tool_use` 写进 `content`，点明产品兼容层，不展开 Messages API。

## 材料与范围

主要载体：labs：工具调用、结构化数据。材料与实现入口见 [素材索引](map.md#chapter-materials)。

一次工具调用不等于完整 Agent Loop。

[上一章：与模型交互](02-model-interaction.md) · [课程目录](README.md) · [下一章：Agent Loop 与 ReAct](04-agent-loop-and-react.md)
