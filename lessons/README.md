# RayAgent Lessons

通过聚焦示例对照产品行为，理解 RayAgent 如何规划任务、调用工具、管理执行并把结果送回界面。

阶段进度与完成标准只维护在 [执行计划](../PLAN.md)。学习顺序、labs 与产品模块对照见 [学习地图](map.md)。

## Lesson order

序号从 01 递增。先 Part A（只跑 `labs/`），再 Part B（组合 `ray_agent`）。

### Part A · Labs

| # | Lesson |
|---|---|
| 01 | [Model API](01-model-api.md) |
| 02 | [Streaming output](02-streaming-output.md) |
| 03 | [Tool calling and structured output](03-tool-calling.md) |
| 04 | [Context and ReAct](04-context-and-react.md) |
| 05 | [Async HTTP](05-async-http.md) |
| 06 | [MCP labs](06-mcp-labs.md) |
| 07 | [A2A labs](07-a2a-labs.md) |
| 08 | [Browser and CDP](08-browser-and-cdp.md) |

### Part B · RayAgent

| # | Lesson |
|---|---|
| 09 | [Run the application](09-run-the-application.md) |
| 10 | [Models and tools in the product](10-models-and-tools-in-the-product.md) |
| 11 | [Plan and ReAct](11-plan-and-react.md) |
| 12 | [State and events](12-state-and-events.md) |
| 13 | [Sandbox and storage](13-sandbox-and-storage.md) |
| 14 | [MCP and A2A in the product](14-mcp-and-a2a-in-the-product.md) |
| 15 | [Failure and change points](15-failure-and-change-points.md) |

按主题反查（不是学习顺序）见 [学习地图](map.md#index-by-topic)。

## Lesson format

文档标题用英文，正文用中文。每课只覆盖一个连贯主题。不强制统一小节标题。

## Teaching and evidence

从可观察的输入输出出发，再追踪执行与数据变化，最后解释抽象与取舍。不要把 lesson 写成类清单或代码注释译文。

区分代码事实、设计意图的推断和改进建议。注释和历史讨论只作线索；关于行为的判断应对着代码核对，相关处还应对着实际运行。

使用已验证的示例、截图和输出。未执行过的步骤必须标明，并说明复现所需环境。安装步骤链接到对应 lab 或服务指南，不要在 lesson 里再维护一套部署说明。

教学简化必须写明：练习里的一次工具调用不能代表产品主循环；客户端示例不能代表协议的全部能力。Part A 不讲产品主循环；Part B 不重讲脚本，只写「脚本里见过的现象在产品里落在哪里、还多了什么」。

一课完成的标准是：学习者能讲清行为、定位实现、指出边界。不要求借此新增产品功能或迁移框架。

当前各课均为骨架。正文待按 01→15 填写，未运行的观察一律标 `unverified`。

## Related material

- [学习地图](map.md)：章节、练习脚本与产品模块对照
- [Labs](../labs/README.md)：实验选择、环境与运行入口
- [Architecture](../docs/architecture.md)：系统边界、状态归属与交互契约
- [Application guide](../ray_agent/README.md)：部署配置与运行检查
- [Execution plan](../PLAN.md)：阶段顺序与学习完成标准

架构说明是精简的实现对照；lessons 用示例和观察展开讲解。示例或解释过时时更新对应课，不要重复维护全局架构或项目进度。
