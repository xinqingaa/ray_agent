# Writing Progress

项目阶段与验收标准见 [PLAN](../PLAN.md)，课程设计见 [AGENTS](AGENTS.md#course-outline)，章节入口见 [README](README.md)。本文件只维护制作状态与验证缺口。

## Current work

已建立 01–17 章骨架，替换全部原章节，并同步目录、大纲与素材索引。每章已明确核心问题、叙述方向和范围；尚未展开正文或进行本轮运行验证。

下一步：先研究第 06、07 章共同任务及内外层循环，取得后续写作的核心证据，再按依赖制作正文。

## Chapter tracking

| 章节 | 正文状态 | 验证情况 | 下一步 |
|---|---|---|---|
| [01 · The RayAgent System](01-the-rayagent-system.md) | 骨架 | 未进行本章运行验证 | 核对完整链路，确定全景图与循环边界 |
| [02 · Model Interaction](02-model-interaction.md) | 骨架 | 未进行本章运行验证 | 选择同一请求的普通与流式示例 |
| [03 · Tools and Actions](03-tools-and-actions.md) | 骨架 | 未进行本章运行验证 | 选择调用、校验与结果反馈示例 |
| [04 · Agent Loop and ReAct](04-agent-loop-and-react.md) | 骨架 | 未进行本章运行验证 | 核对循环脚本，确认继续与停止条件 |
| [05 · Context and Memory](05-context-and-memory.md) | 骨架 | 未进行本章运行验证 | 确定消息变化与上下文限制的观察 |
| [06 · Run RayAgent: One Complete Task](06-run-rayagent-one-complete-task.md) | 骨架 | 有阶段 1 历史验收，本章未复跑 | 复跑共同任务并记录关键观察 |
| [07 · Planning and Nested Loops](07-planning-and-nested-loops.md) | 骨架 | 未进行本章运行验证 | 追踪共同任务的两层交接与终止 |
| [08 · Task Execution and Control](08-task-execution-and-control.md) | 骨架 | 未进行本章运行验证 | 核对任务入口、运行与取消路径 |
| [09 · State and Persistence](09-state-and-persistence.md) | 骨架 | 未进行本章运行验证 | 建立状态归属与生命周期对照 |
| [10 · Events and Streaming](10-events-and-streaming.md) | 骨架 | 未进行本章运行验证 | 核对事件契约和前后端消费路径 |
| [11 · Sandbox and Execution Environment](11-sandbox-and-execution-environment.md) | 骨架 | 未进行本章运行验证 | 核对沙箱生命周期与实际隔离范围 |
| [12 · Files and Artifacts](12-files-and-artifacts.md) | 骨架 | 未进行本章运行验证 | 追踪文件写入、同步与访问链路 |
| [13 · Browser as a Tool](13-browser-as-a-tool.md) | 骨架 | 未进行本章运行验证 | 核对浏览器连接、会话与反馈路径 |
| [14 · External Tools with MCP](14-external-tools-with-mcp.md) | 骨架 | 未进行本章运行验证 | 选择协议基线并映射产品适配 |
| [15 · Agent Collaboration with A2A](15-agent-collaboration-with-a2a.md) | 骨架 | 未进行本章运行验证 | 核对远程任务与本地结果的映射 |
| [16 · Reliability and Verification](16-reliability-and-verification.md) | 骨架 | 未进行本章运行验证 | 建立故障场景、预期和验证证据表 |
| [17 · From Sessions to Workspaces](17-from-sessions-to-workspaces.md) | 骨架 | 待核对架构现状 | 对照当前能力整理工作区演进差距 |

## Evidence boundaries

本轮只完成文档结构与引用的静态检查。素材中保留的历史验证不代表本章已验证；正文写完与运行验证完成分别记录。未执行的观察标为 `unverified`。

每次制作后更新对应章节的正文状态、已验证范围和一个具体下一步，不复制正文或逐次操作日志。
