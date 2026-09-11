# RayAgent：Agent Harness 工程课程

以 RayAgent 为实践载体，学习 Agent Harness 的核心机制、系统设计与工程验证。课程研究模型之外的运行系统如何组织 Context、行动与反馈，让任务持续执行、受到控制，并交付可验证的结果。

先理解通用概念与设计取舍，再对照实验和现有实现。labs 用于隔离机制，RayAgent 用于观察机制组合；读者自行决定阅读、运行或修改。学习后应能解释职责与交接、比较设计方案、定位实现，并用任务与失败场景验证行为。

前五章建立基础认识，第六章串联完整 Harness，随后展开规划、控制、状态、事件、执行环境与外部能力，最终讨论可靠性、评估和长任务工作区。通用策略与项目已实现能力会明确区分。

## 章节目录

| 章 | 主题 |
|---|---|
| 01 | [认识 Agent Harness：从一句请求到任务完成](01-the-rayagent-system.md) |
| 02 | [与模型交互](02-model-interaction.md) |
| 03 | [工具与行动](03-tools-and-actions.md) |
| 04 | [Agent Loop 与 ReAct](04-agent-loop-and-react.md) |
| 05 | [上下文与记忆](05-context-and-memory.md) |
| 06 | [从 Agent Loop 到完整 Harness](06-run-rayagent-one-complete-task.md) |
| 07 | [规划与内外层循环](07-planning-and-nested-loops.md) |
| 08 | [任务执行与控制](08-task-execution-and-control.md) |
| 09 | [状态与持久化](09-state-and-persistence.md) |
| 10 | [事件与可观察性](10-events-and-streaming.md) |
| 11 | [沙箱与执行环境](11-sandbox-and-execution-environment.md) |
| 12 | [文件与任务产物](12-files-and-artifacts.md) |
| 13 | [浏览器如何成为工具](13-browser-as-a-tool.md) |
| 14 | [通过 MCP 接入外部工具](14-external-tools-with-mcp.md) |
| 15 | [通过 A2A 协作远程 Agent](15-agent-collaboration-with-a2a.md) |
| 16 | [可靠性、验证与评估](16-reliability-and-verification.md) |
| 17 | [长任务与项目工作区](17-from-sessions-to-workspaces.md) |

## 相关资料

- [素材索引](map.md)：章节对应的实验、源码与环境入口。
- [Labs](../labs/README.md)：实验环境与运行指南。
- [Application guide](../ray_agent/README.md)：完整产品的部署与运行。
- [Architecture](../docs/architecture.md)：系统边界与实现概览。
- [Authoring guide](AGENTS.md)：课程设计与制作约定。
- [Writing progress](progress.md)：正文制作状态、验证缺口与下一步。
- [Project plan](../PLAN.md)：项目阶段与完成标准。
