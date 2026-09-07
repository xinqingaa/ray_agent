# RayAgent 计划

> 总纲：调研现状、目标、已拍板的目录、学习与 SDD 阶段。
> 产品对外名：**RayAgent**。代码目录：`ray_agent/`（由 `mooc-manus` 改名，内部不摊平）。
> 调研日期：2026-09-07。协议版本以当时 PyPI 为准，升级前再核一次。
> `lessons/` 里的 md 用英文。本文是工作总纲，可以中文。



## 0. 已拍板（不要再改方向）
1. **先记清楚，再搬家，再跑产品，再升协议。** 不把第一次启动和升级 A2A/MCP 绑在一起。
2. **不拆 `mooc-manus` 内部。** `api/` / `ui/` / `sandbox/` 以及 API 的 DDD 原样保留。只把外层目录改名为 `ray_agent/`，不把它们抬到 git 根上。
3. **练习脚本离开根目录。** `mas-study` → `labs/foundations/`（不叫 mas）。`a2a-study` → `labs/a2a/`。
4. **一篇 lesson 只讲一个主题。** 禁止再用一篇 md 罩完 foundations 里几十个脚本。
5. **`lessons/` 英文；`specs/` 只放「下一步要做的功能」，和学习笔记分开。**
6. **主循环是自研 Plan+ReAct，不把 LangGraph 当核心。** 仓库里已有 Agent Loop，只是不叫这个名字。
7. `cursor-chat-history` 不是教材，进 `archive/`，默认不提交。

## 1. 我是谁，要学到什么

我不是这个项目的作者，是学习者。 原始课程大纲和目录：[慕课 955 多智能体 MoocManus](https://coding.imooc.com/class/chapter/955.html#Anchor)。

**终点：** 理解核心逻辑和设计思路，能二开、能定制功能，可以自述产品闭环。

要做到这一点，至少要：

1. 掌握核心链路和逻辑（一次用户对话从 UI 走到工具执行再流回前端）。
2. 理解核心设计思路（为什么这样分层、为什么 Plan+ReAct、为什么沙箱、为什么 MCP/A2A 是工具而不是主循环）。

## 2. 学习原则（已对齐）

1. **先跑起来。** 先用完整产品走一遍流程，这是后面一切的基础。
2. **再考虑升级协议/库。** 不把「第一次启动」和「升级 A2A/MCP」绑在一起。一直把过时 API 当终态去背，不能接受；但升级必须发生在能讲清当前实现之后。
3. **文档对照，不改内部目录。** 不重排 `mooc-manus/api` 的 DDD 结构。目标是有一份「从哪开始、学什么」的地图，把现在散落的脚本和课程章节串起来，方便自己复习，也方便别人学。
4. `cursor-chat-history` 只是历史对话参考，不是学习材料。
5. 课程**没有因为不用 LangChain/LangGraph 而落伍。** 落伍的是 A2A/MCP 线格式和 SDK 版本，不是「没有框架名」

后续教学文档放 `lessons/`（尚未创建）。本文是总纲，先落在根目录。

## 3. 仓库现状 vs 目标仓库

### 3.1 现在（尚未搬家）

根目录是课程资料盘，没有总 README，也没有学习地图：

```
imooc-mas/
├── a2a-study/
├── mas-study/
├── mooc-manus/
├── cursor-chat-history/
├── 即时设计MoocManus UI URL地址.txt
└── PLAN.md
```

| 现在 | 性质 | 说明 |
|---|---|---|
| `a2a-study` | 练习 | SDK 当 A2A 服务端；httpx 当客户端 |
| `mas-study` | 练习 | LLM / ReAct / MCP / 浏览器等单点脚本，**不是**一套 MAS 运行时 |
| `mooc-manus` | 产品 | 要二开的全栈 |
| `cursor-chat-history` | 存档 | 不学 |

`a2a-study/client.py` = 官方 SDK。`httpx_a2a.py` = 手写卡片 + `message/send`。产品里的 A2A 几乎是后者的产品化，不是 SDK 那条线。

### 3.2 目标（已选定：产品继续包一层，不摊平）

```
ray-agent/                          # 以后 git 根；对外 RayAgent
├── README.md
├── AGENTS.md
├── .gitignore
├── PLAN.md
│
├── ray_agent/                      # 原 mooc-manus，内部不动
│   ├── api/
│   ├── ui/
│   ├── sandbox/
│   ├── nginx/
│   ├── docker-compose.yml
│   └── README.md
│
├── labs/
│   ├── README.md
│   ├── foundations/                # 原 mas-study（不叫 mas）
│   │   ├── demo/
│   │   ├── llm/
│   │   ├── react/
│   │   ├── http-async/
│   │   ├── mcp/
│   │   └── browser/
│   └── a2a/                        # 原 a2a-study + 原 2-2 code
│       ├── server/
│       ├── client-sdk/
│       ├── client-httpx/
│       ├── weather-agent/
│       └── inspector-ui/
│
├── lessons/                        # 英文 md，一篇一个主题
│   └── README.md
│
├── specs/                          # SDD：下一要做的功能
├── .specify/                       # constitution / templates，搬家后加
│
└── archive/                        # 建议 gitignore
    ├── cursor-chat-history/
    └── js-design-ui-url.txt
```

搬家对照：

| 现在 | 以后 |
|---|---|
| `mooc-manus/` | `ray_agent/` |
| `mas-study/` | `labs/foundations/`（可先整目录搬，子目录后切） |
| `a2a-study/` | `labs/a2a/` |
| `mas-study/2-2 code/weather` | `labs/a2a/weather-agent/` |
| `mas-study/2-2 code/ui` | `labs/a2a/inspector-ui/` |
| `cursor-chat-history/`、即时设计 txt | `archive/` |

`docker compose` 仍在 `ray_agent/` 下跑，和现在进 `mooc-manus/` 一样。

### 3.3 产品内部（不改）

```
ray_agent/
├── api/        # FastAPI，DDD
├── ui/         # Next.js
├── sandbox/    # Ubuntu + Chrome + VNC
├── nginx/
└── docker-compose.yml
```

一次对话：

1. UI → FastAPI 会话（SSE）
2. `AgentService` 建任务、沙箱
3. `AgentTaskRunner` → `PlannerReActFlow`
4. 工具：file / shell / browser / search / message / MCP / A2A
5. 事件进 Redis Stream，前端 SSE
6. 附件和截图走腾讯云 COS

设计要点：

- MCP / A2A 是 Tool；主循环是 Plan + ReAct。
- MCP、A2A 都只当**客户端**。本仓库不托管 MCP Server，也不当 A2A Server。
- 前端展示列表，和执行时「只传已启用服务」，是两套逻辑。

关键文件（搬家后路径）：

| 环节 | 文件 |
|---|---|
| 会话 / SSE | `ray_agent/api/app/interfaces/endpoints/session_routes.py` |
| 编排 | `ray_agent/api/app/application/services/agent_service.py` |
| 跑一轮 | `ray_agent/api/app/domain/services/agent_task_runner.py` |
| 外层流程 | `ray_agent/api/app/domain/services/flows/planner_react.py` |
| 内层 Loop | `ray_agent/api/app/domain/services/agents/base.py` |
| MCP | `ray_agent/api/app/domain/services/tools/mcp.py` |
| A2A | `ray_agent/api/app/domain/services/tools/a2a.py` |

## 4. Agent Loop 和 LangGraph

**有 Loop，没有框架名。**

- **内层：** `BaseAgent.invoke` 里 `for max_iterations`：模型 → `tool_calls` → 执行 → 再问模型。这就是 Agent Loop。
- **外层：** `PlannerReActFlow` 的 `while True`：PLANNING → EXECUTING → UPDATING → SUMMARIZING。
- `labs/foundations` 里部分演示只跑一轮工具，那是教学简化，不能用来判断产品有没有 Loop。

没有 LangChain / LangGraph 是路线：自研 Loop + OpenAI 兼容 SDK。2024–2026 很多生产系统也这样。

| 维度 | 判词 |
|---|---|
| Agent 主循环、Plan+执行 | 没落伍 |
| 不用 LangGraph | 不算落伍；缺的是框架履历，不是不会做 Agent |
| A2A / MCP 版本 | 这里落后，见第 5 节 |
| 沙箱 / SSE / VNC | 仍有教的价值 |

不把 LangGraph 引进主循环。简历需要再另补 StateGraph，对照「就是外层 `while True` 画成图」。

## 5. A2A / MCP 差距（2026-09-07）

概念骨架能学；A2A 字段和 MCP 客户端 API 已经落后。先跑，再按清单升级。

### 5.1 版本

| | 仓库现状 | 当时官方 |
|---|---|---|
| A2A 规范 | 手写 0.3 子集：`agent-card.json` + `message/send` + `kind: text` | 1.0（约 2026-04） |
| A2A SDK | 产品无；练习钉 `a2a-sdk>=0.3.22` | 1.1.2，实现 spec 1.0 |
| MCP SDK | 产品 `mcp==1.22.0` | 1.x 维护线 1.29.1；稳定线 2.1.1（spec 2026-07-28） |

### 5.2 为什么产品没用 `a2a-sdk`

1. 课程 14-10 就是「不用官方 SDK，用 httpx」。
2. 产品只当客户端；SDK 重量在当服务端。
3. 真正多的是缓存、id、enabled、收成 tool schema。
4. `a2a.py`（2025-05-09）早于 SDK 第一个 alpha（2025-05-15）。

现在若接 SDK，走 1.x `ClientFactory`，不要钉 0.3 的 `A2AClient`。更对症的是先让手写客户端认 1.0 的 `supportedInterfaces`。`agent_card.get("url")` 对 1.0-only Agent 会空。

### 5.3 MCP

产品只用：stdio / SSE / Streamable HTTP → `initialize` → `list_tools` → `call_tool`。

- 概念没过时。v1 客户端写法过时。SSE 不建议新代码用。
- 现网 tools 型 server 仍可能互通。
- `CVE-2026-52869`、`CVE-2026-59950` 主要打 Server；当前是 client。以后若起 Server，1.22 不能用。

### 5.4 跑通之后再做（现在不做）

1. MCP `1.22` → `1.29.1`，并加 `<2`。
2. A2A 手写客户端兼容 1.0。
3. 再评估 `a2a-sdk` 1.x、MCP 2.x。

## 6. `lessons/`（英文，按主题拆）

只放文档，不搬产品代码。一篇课一件事，并写明「先跑哪个脚本 / 再看产品哪个文件」。禁止一篇 md 罩完 foundations 里几十个脚本。

```
lessons/
├── README.md                 # map: order, vs labs/specs
├── 00-overview.md
├── 01-run-rayagent.md
├── 02-conversation-loop.md
├── 10-llm-api.md             # labs/foundations/llm
├── 11-react-loop.md          # foundations/react + agents/base.py
├── 12-async-and-http.md
├── 13-mcp.md                 # foundations/mcp + tools/mcp.py
├── 14-browser.md
├── 20-a2a-sdk.md
├── 21-a2a-httpx.md
├── 22-a2a-in-rayagent.md
├── 30-sandbox-and-ui.md
└── 40-protocol-gap.md
```

| 课 | 只讲 | 大约挂哪些脚本 |
|---|---|---|
| `10-llm-api` | 调模型、流式、JSON、Pydantic | `3_4`–`3_6`、`3_8`、`3_9`、`3_10` |
| `11-react-loop` | 手写 tool_calls，对上 `BaseAgent.invoke` | `3_7`、`4_3`、`4_4`、`demo-agent.py` |
| `12-async-and-http` | 异步、FastAPI | `4_5`、`4_6` |
| `13-mcp` | 传输、list/call | `6_5`–`6_11` |
| `14-browser` | 浏览器，对上沙箱 | `10-4`、`10-6` |
| `20` / `21` | SDK 服务端 vs httpx 客户端 | `labs/a2a` 各 1–2 个入口 |
| `22` | 产品为什么手写、1.0 卡片 | 只挂 `tools/a2a.py` |
| `02` / `30` | 产品主链路、沙箱前端 | 不挂 foundations 全量 |

`labs/foundations` 里的中文文件名（如 `3_4_DeepSeek API调用.py`）第二步再改，不和搬家绑在一起。

## 7. SDD

| 目录 | 用途 |
|---|---|
| `.specify/` + `specs/` | constitution → spec → plan → tasks → 实现 |
| `lessons/` | 读懂**已有**产品和 labs |
| `labs/` | 给 lessons 用的可运行小脚本 |

constitution 建议写死：根下产品在 `ray_agent/`；MCP/A2A 是 Tool；主循环自研，不引入 LangGraph；先跑再升协议；`lessons/` 英文。

搬家后再 `specify init` 或手建 `.specify/`。不要和学习笔记混在一个目录。

## 8. 阶段

### 阶段 0 — 总纲（当前）

- [x] 根目录有本文
- [x] 第 3 节起写入：目录决策、Loop 结论、英文拆课、SDD
- [ ] 之后改计划只改本文或 `lessons/`，不靠聊天记录

### 阶段 0.5 — 搬家 + git（跑产品之前）

1. `mooc-manus` → `ray_agent`
2. study → `labs/`（按第 3.2 节）
3. 历史对话 / 即时设计 → `archive/`（gitignore）
4. 根目录补简短 `README.md`（产品名 RayAgent，启动进 `ray_agent/`）
5. 建空的 `lessons/`、`specs/`（可先只有 README / .gitkeep）
6. 在仓库根 `git init`（现在没有必须保留的提交史，先搬家再 init）
7. 不提交 `.env`、密钥、`archive/`

### 阶段 1 — 先跑起来

在 `ray_agent/`：

1. 读 `ray_agent/README.md`
2. 配 `.env`、`api/config.yaml`
3. `docker compose up -d --build`
4. 打开网关端口（默认 `8088`）
5. 先走一条不依赖外部 A2A/MCP 的对话

已知坑：`REDIS_PORT` 以 compose 为准；没有 COS / 模型 key，附件和 Agent 会卡。本阶段不升级协议。

### 阶段 2 — 主链路对照

按一次请求精读：会话与 SSE → Planner/ReAct → 内置工具与沙箱 → Redis 到 UI。补 `lessons/01`、`02`。

### 阶段 3 — 协议直觉

`labs/a2a` 起 SDK 服务端，对产品 httpx 客户端。对照 `tools/mcp.py`。写 `lessons/11`、`13`、`20`–`22`。

### 阶段 4 — 评估升级

按第 5.4 节，一项一项做。

### 阶段 5 — 按规格改产品

`.specify` + 第一条 `specs/001-…`，从「学旧课」转到「按规格改 RayAgent」。

## 9. 当前下一步

1. 阶段 0.5：按第 3.2 节搬家，然后 `git init`。
2. 阶段 1：把 RayAgent 跑起来。
