# RayAgent Lessons

通过聚焦示例对照产品行为，理解 RayAgent 如何规划任务、调用工具、管理执行并把结果送回界面。

阶段进度与完成标准只维护在 [执行计划](../PLAN.md)。章节、labs 与产品模块的对照见 [学习地图](map.md)。

## Topic map

| Area | Lesson | Topics |
|---|---|---|
| Application flow | [01](01-application-flow.md) | 一次完整对话与模块职责 |
| Models and tools | [02](02-models-and-tool-calling.md)、[03](03-react-loop.md) | 模型 API、结构化输出、工具调用、ReAct |
| Planning | [04](04-planning.md) | 任务拆解、执行、计划更新与总结 |
| State and events | [05](05-state-and-events.md) | 持久化、异步 HTTP、Redis Streams、SSE、界面更新 |
| Sandbox | [06](06-sandbox.md) | 浏览器、Shell、文件与存储 |
| Protocols | [07](07-mcp.md)、[08](08-a2a.md) | MCP 工具、A2A Agent、客户端/服务端与产品接入 |
| Failure behavior | [09](09-failure-behavior.md) | 错误、迭代上限、取消、断连与清理 |

## Lesson format

标题与章节标题用英文，正文用中文。每课只覆盖一个连贯主题，并包含：

1. Learning objectives and prerequisites.
2. Essential concepts and a runnable example where useful.
3. Product code entry points and the execution path.
4. Design rationale, limitations, and relevant failure behavior.
5. Understanding checks or a focused observation experiment.

## Teaching and evidence

从可观察的输入输出出发，再追踪执行与数据变化，最后解释抽象与取舍。不要把 lesson 写成类清单或代码注释译文。

区分代码事实、设计意图的推断和改进建议。注释和历史讨论只作线索；关于行为的判断应对着代码核对，相关处还应对着实际运行。

使用已验证的示例、截图和输出。未执行过的步骤必须标明，并说明复现所需环境。安装步骤链接到对应 lab 或服务指南，不要在 lesson 里再维护一套部署说明。

教学简化必须写明：练习里的一次工具调用不能代表产品主循环；客户端示例不能代表协议的全部能力。需要解释接口变化时，仍以已验证实现为中心。

一课完成的标准是：学习者能讲清行为、定位实现、指出边界。不要求借此新增产品功能或迁移框架。

当前各课均为骨架（Status: stub）。正文待按地图顺序填写，未运行的观察一律标 `unverified`。

## Related material

- [学习地图](map.md)：章节、练习脚本与产品模块对照
- [Labs](../labs/README.md)：实验选择、环境与运行入口
- [Architecture](../docs/architecture.md)：系统边界、状态归属与交互契约
- [Application guide](../ray_agent/README.md)：部署配置与运行检查
- [Execution plan](../PLAN.md)：阶段顺序与学习完成标准

架构说明是精简的实现对照；lessons 用示例和观察展开讲解。示例或解释过时时更新对应课，不要重复维护全局架构或项目进度。
