# Course labs

这些目录是课程练习，不是统一的 Agent 运行时。当前只调整外层位置，保留脚本名称、资源与原有依赖文件。

| 目录 | 来源 | 内容 |
|---|---|---|
| [foundations/](foundations/README.md) | `mas-study/` | LLM、工具调用、ReAct、异步 HTTP、MCP、浏览器等练习 |
| [a2a/](a2a/README.md) | `a2a-study/` | A2A SDK 服务端、SDK 客户端和手写 HTTP 客户端 |

`foundations/demo-code/`、`foundations/2-2 code/weather/`、`foundations/2-2 code/ui/` 包含独立依赖文件。运行示例前先确认所属目录的 README、`pyproject.toml` 和锁文件；不要直接在仓库根安装所有练习依赖。

`2-2 code/` 中的 A2A 相关示例将在划分 lessons 时再整理。此次不拆分目录，也不修改中文脚本名或升级依赖。

产品当前作为 MCP/A2A 客户端使用外部服务；练习目录也包含服务端示例。教学文档入口见 [lessons](../lessons/README.md)，整体顺序见 [PLAN.md](../PLAN.md)。
