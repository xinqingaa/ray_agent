# RayAgent

RayAgent 是一个可以在浏览器里发起任务、在沙箱里真正执行操作的 AI Agent 应用。用户提出目标后，系统用自研的 Plan + ReAct 拆步骤、调工具、更新计划，并把计划、工具记录和产物推回页面。模型负责提出行动；程序负责执行、控制边界、保存状态，并把结果交给用户。

它同时也是 Agent Harness 的教学与实验工程。Harness 指模型之外组织信息、行动、反馈和任务运行的那一层，不是某个框架。课程解释这些机制；labs 把循环、协议、浏览器等拆开观察；现有应用用来看它们组合之后的取舍。

## 你在产品里做什么

打开 Web 页面，新建或继续一次会话，写下要完成的事并发送。页面上可以看到计划、步骤和工具记录；需要时还能查看沙箱浏览器画面。Agent 提问时可以回复，也可以中途停止。任务结束后打开附件下载；刷新后历史还在。

一次已验证的任务是：在沙箱工作目录创建 `hello.txt`，写入内容，读回确认，再作为附件交给用户。文件写在沙箱里，下载的是同步后的副本。

设置里可以配置模型、MCP 与 A2A；这是使用前的准备，不插入上面的任务路径。首次产品验收走的是内置文件工具，不依赖外部协议。

![进入会话、发送目标、看着任务推进，必要时回复或停止，最后取走附件](docs/assets/product-overview.svg)

读图时从左到右：进入会话 → 发送目标 → 看着它推进 → 回复或停止 → 取走结果。

| 能力 | 现在能做什么 | 边界 |
|---|---|---|
| 规划与执行 | 外层计划 + 内层工具循环，步骤可更新 | 主循环自研，不用 LangChain / LangGraph |
| 内置工具 | 读写文件、Shell、浏览器、通知或询问用户 | 工具在沙箱中执行；浏览器经 CDP 与 Playwright |
| 外部能力 | MCP 调用外部工具，A2A 委派远程 Agent | 接入现有工具层，不替代本地任务流程 |
| 观察 | 计划、步骤、工具、用量等事件；SSE 与历史回放 | 连接断开不等于任务结束 |
| 会话与产物 | 会话、事件、Memory 落库；附件可下载 | 会话级任务，不是跨会话项目工作区 |
| 运行形态 | Compose：UI、API、Nginx、PostgreSQL、Redis、动态沙箱 | 每会话一个沙箱；任务结束不自动销毁容器 |

它不是长期操作同一个 Git 仓库的工作区 Agent，也不是托管 SaaS。模型调用目前按完整响应处理，没有独立的目标验收系统。模块边界与发送之后的请求路径见 [架构说明](docs/architecture.md)。

## 这个仓库里有什么

产品、课程和实验分工不同，不要互相替代：

| 路径 | 角色 |
|---|---|
| [ray_agent/](ray_agent/README.md) | 可部署的产品：Web UI、API、沙箱与 Compose |
| [lessons/](lessons/README.md) | 课程，按目录阅读 |
| [labs/](labs/README.md) | 局部机制实验：基础循环、验证方法、A2A |
| [docs/](docs/architecture.md) | 架构说明与调研快照 |

想先跑起来：打开 [运行指南](ray_agent/README.md)。想理解机制：从 [课程第 1 章](lessons/01-the-rayagent-system.md) 读起。想改代码：先读 [架构说明](docs/architecture.md)，再进入对应服务的 README。

## 运行

需要 Docker、Docker Compose，以及支持工具调用的模型服务。附件和截图默认写入本地磁盘，也可以改为腾讯云 COS。

配置、启动和第一次文件任务验收见 [运行指南](ray_agent/README.md)。日常启停与日志见 [Docker 操作说明](ray_agent/DOCKER.md)。

## 文档

- 使用：[运行指南](ray_agent/README.md)、[Docker 操作说明](ray_agent/DOCKER.md)
- 学习：[课程目录](lessons/README.md)、[实验入口](labs/README.md)
- 实现：[架构说明](docs/architecture.md)、[工作指南](AGENTS.md)
- 状态与调研：[执行计划](PLAN.md)、[工作区调研](docs/workspace-harness-research.md)、[Harness 能力评估](docs/harness-capability-review-2026-09-14.md)
