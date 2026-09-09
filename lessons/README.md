# RayAgent Lessons

一条用户请求，如何经过模型决策、工具执行和持续反馈，最终成为一个可观察、有状态、能够处理失败的任务？本课程沿这条主线理解 RayAgent 与现代 Agent 工程。

从系统全景和最小机制出发，第 06 章进入完整产品，第 07 章拆解内外层循环，随后展开任务控制、状态、执行环境、外部协作、可靠性与项目工作区演进。labs 用于隔离机制，RayAgent 用于观察机制的组合；读者自行决定阅读、运行或修改。

## Lesson order

| # | Lesson |
|---|---|
| 01 | [认识 RayAgent：从一句请求到任务完成](01-the-rayagent-system.md) |
| 02 | [与模型交互](02-model-interaction.md) |
| 03 | [工具与行动](03-tools-and-actions.md) |
| 04 | [Agent Loop 与 ReAct](04-agent-loop-and-react.md) |
| 05 | [上下文与记忆](05-context-and-memory.md) |
| 06 | [运行 RayAgent：观察一条完整任务](06-run-rayagent-one-complete-task.md) |
| 07 | [规划与内外层循环](07-planning-and-nested-loops.md) |
| 08 | [任务执行与控制](08-task-execution-and-control.md) |
| 09 | [状态与持久化](09-state-and-persistence.md) |
| 10 | [事件与流式传递](10-events-and-streaming.md) |
| 11 | [沙箱与执行环境](11-sandbox-and-execution-environment.md) |
| 12 | [文件与任务产物](12-files-and-artifacts.md) |
| 13 | [浏览器如何成为工具](13-browser-as-a-tool.md) |
| 14 | [通过 MCP 接入外部工具](14-external-tools-with-mcp.md) |
| 15 | [通过 A2A 协作远程 Agent](15-agent-collaboration-with-a2a.md) |
| 16 | [可靠性与验证](16-reliability-and-verification.md) |
| 17 | [从会话走向项目工作区](17-from-sessions-to-workspaces.md) |

## Related material

- [素材索引](map.md)：章节对应的实验、源码与环境入口。
- [Labs](../labs/README.md)：实验环境与运行指南。
- [Application guide](../ray_agent/README.md)：完整产品的部署与运行。
- [Architecture](../docs/architecture.md)：系统边界与实现概览。
- [Authoring guide](AGENTS.md)：课程设计与制作约定。
- [Writing progress](progress.md)：正文制作状态、验证缺口与下一步。
- [Project plan](../PLAN.md)：项目阶段与完成标准。
