# RayAgent 计划

> 更新日期：2026-09-07。
> 当前目标：先完整学习课程项目，建立稳定理解，再考虑二开。
> 产品名：RayAgent。产品目录：`ray_agent/`，来源于 `mooc-manus/`。
> 本文记录当前采用的决策和阶段状态；后续调整以用户确认的方向为准。

## 1. 目标与顺序

我不是这个项目的原作者，是学习者。课程来源：[慕课多智能体 MoocManus](https://coding.imooc.com/class/chapter/955.html#Anchor)。

学习终点：能够解释核心逻辑和设计思路，讲清产品闭环，并具备后续定制功能的基础。

当前先完成一次范围有限的 Git 初始化和目录整理，随后按以下顺序推进：

1. **跑通原项目。** 这是后续工作的基础。
2. **跑通后立即升级 A2A/MCP。** 不要求先学完整个项目；升级所需的局部代码阅读属于技术准备。
3. **划分 lessons、编写教学文档，系统学习。** 以升级并验证后的实现为主要学习基准。
4. **学习完成后再考虑二开和 SDD。** 不把新增功能作为每个主题的必修作业。
5. **框架替换优先级最低。** 当前重点是学懂已有自研 Loop，之后再评估 LangChain/LangGraph。

避免学习、功能改造、目录重构交替扩张，使学习阶段长期无法结束。

## 2. 当前目录与迁移记录

Git 根目录为当前工作目录 `/Users/lrq/work/ray_agent`，不再重命名工作目录。其内部的 `ray_agent/` 是产品子目录。

```text
ray_agent/                         # Git 根、当前工作目录
├── README.md
├── AGENTS.md
├── .gitignore
├── PLAN.md
├── ray_agent/                     # 原 mooc-manus，内部结构保留
│   ├── api/
│   ├── ui/
│   ├── sandbox/
│   ├── nginx/
│   ├── docker-compose.yml
│   └── README.md
├── labs/
│   ├── README.md
│   ├── foundations/               # 原 mas-study，内部暂时保留
│   │   ├── demo-code/
│   │   ├── 2-2 code/
│   │   └── ...
│   └── a2a/                       # 原 a2a-study，内部暂时保留
├── lessons/
│   └── README.md
└── archive/                       # 纳入 Git，便于跨设备访问
    ├── cursor-chat-history/
    └── js-design-ui-url.txt
```

| 原位置 | 当前路径 |
|---|---|
| `mooc-manus/` | `ray_agent/` |
| `mas-study/` | `labs/foundations/` |
| `a2a-study/` | `labs/a2a/` |
| `cursor-chat-history/` | `archive/cursor-chat-history/` |
| 即时设计地址 txt | `archive/js-design-ui-url.txt` |

本次只移动外层目录。`2-2 code/weather`、`2-2 code/ui` 暂不单独迁移，中文脚本名不修改。后续划分 lessons 时再统一处理分类、依赖环境和路径引用。

`archive/` 是历史参考材料，不是教学文档或执行指令。按用户要求提交到 Git；实际密钥和本地环境文件不提交。

`specs/`、`.specify/` 延后到二开阶段创建。

## 3. 产品与学习入口

产品保留 API 的既有分层，以及 UI、沙箱和网关布局。

一次对话的主要路径：

1. UI 向 FastAPI 发起会话请求，接收 SSE 事件。
2. `AgentService` 准备任务、沙箱和浏览器。
3. `AgentTaskRunner` 驱动 `PlannerReActFlow`。
4. 规划与执行 Agent 调用 file、shell、browser、search、message、MCP、A2A 等工具。
5. 事件通过 Redis Stream 和 SSE 返回 UI；文件与截图涉及 COS 存储。

| 环节 | 代码入口 |
|---|---|
| 会话与 SSE | `ray_agent/api/app/interfaces/endpoints/session_routes.py` |
| 任务编排 | `ray_agent/api/app/application/services/agent_service.py` |
| 任务执行 | `ray_agent/api/app/domain/services/agent_task_runner.py` |
| 外层规划执行流 | `ray_agent/api/app/domain/services/flows/planner_react.py` |
| 内层工具调用循环 | `ray_agent/api/app/domain/services/agents/base.py` |
| MCP | `ray_agent/api/app/domain/services/tools/mcp.py` |
| A2A | `ray_agent/api/app/domain/services/tools/a2a.py` |

产品当前作为 MCP/A2A 客户端，把外部能力接入工具层；labs 中也包含服务端示例。

自研 Loop 是重点学习内容：内层执行模型与工具的循环，外层负责规划、执行、更新和总结。保留现有架构以便理解课程，框架迁移后续再评估。

## 4. 阶段 0：Git 初始化与最小整理

### 工作与提交边界

- [x] 检查目录、嵌套仓库、忽略规则和明显凭据。
- [x] 初始化 `main` 分支，完善根 `.gitignore`。
- [x] 保存原始代码基线：`094b43d`，`chore: preserve original course baseline`。
- [x] 单独提交外层目录迁移：`6109cbc`，`chore: organize product and course labs`。
- [x] 校验 404 个迁移文件均为内容完全一致的重命名。
- [x] 将历史聊天和设计地址纳入 Git。
- [x] 补充根 README、AGENTS、labs 和 lessons 入口。
- [x] 更新本计划，明确后续学习顺序。

文档调整使用独立提交：`docs: define repository layout and learning roadmap`。

### 完成标准

原始基线、纯迁移和文档调整可分别查看；文件完整，依赖保持原状，路径入口有效，实际凭据未进入提交，工作区干净。

这一阶段不启动产品、不升级依赖，也不拆分练习内部目录。原始代码已有的空白格式问题保留在基线中，不扩大为格式化改造。

### 跨设备同步

归档、截图、tokenizer 数据和依赖锁文件随 Git 跟踪；各设备分别准备环境和本地凭据。当前只建立本地提交，远端地址尚未提供，未推送。

## 5. 阶段 1：跑通原项目

- [ ] 阅读产品 README 和实际部署配置。
- [ ] 准备模型配置、本地 `.env`、数据库、Redis、沙箱及任务所需的存储配置。
- [ ] 在 `ray_agent/` 执行 `docker compose up -d --build`，处理阻塞运行的问题。
- [ ] 通过 UI 创建会话，生成计划，执行至少一次真实内置工具，获得最终结果。
- [ ] 检查刷新后的历史展示，记录可复现启动步骤与必要修复。

首次验证先避开外部 A2A/MCP 服务，但仍需要沙箱链路：当前 `AgentService` 创建任务时会创建或取得沙箱，并获取浏览器。

网关默认端口为 `8088`。Redis 等服务地址、端口以实际 Compose 与本地配置为准。COS 对附件和浏览器截图的影响需要在启动验证中确认，不预设所有路径都必然可用。

依赖沿用原项目基线，不在第一次启动时升级：

| 文件 | 当前作用 |
|---|---|
| `ray_agent/api/pyproject.toml` | 声明依赖，包括 `mcp>=1.22.0` |
| `ray_agent/api/uv.lock` | 锁定 MCP `1.22.0` 等依赖 |
| `ray_agent/api/requirements.txt` | Docker 实际安装的依赖，MCP 为 `1.22.0` |
| `labs/a2a/pyproject.toml` / `uv.lock` | A2A SDK 声明 `>=0.3.22`，锁定 `0.3.22` |

完成标准是产品行为跑通，不以页面可见或健康检查成功代替。当前尚未进行运行验证。

## 6. 阶段 2：立即升级 A2A/MCP

原项目跑通后立即进入，不要求先完成整套课程学习。

- [ ] 对照官方规范、SDK 发布说明和迁移文档，确认目标版本并记录来源与日期。
- [ ] 盘点项目实际使用的传输、请求、响应及状态行为，定义升级范围。
- [ ] MCP 与 A2A 分开修改、分开验收，保留可回溯提交。
- [ ] 同步依赖声明、锁文件及 Docker 使用的导出依赖文件。
- [ ] 核对相关 labs，保证后续教学示例与产品学习基准一致。
- [ ] 再次验证产品原有流程，以及工具发现、调用、错误处理等实际使用能力。
- [ ] 记录课程旧写法与升级后写法之间的关键差异。

原计划中的外部版本快照不作为安装指令；实施时重新核实。可根据兼容成本采用过渡版本，但需写明最终目标与尚未完成的迁移。

A2A 不能只验证卡片字段：当前手写客户端在 HTTP 成功、JSON 可解析后直接标记成功，升级时还需验证协议错误与实际使用的任务语义。手写适配或接入官方 SDK 的选择在这一阶段基于需求评估。

完成标准：原有使用范围在选定的新版本上验证通过。不顺带实现所有协议可选功能，也不改造主循环架构。

## 7. 阶段 3：lessons 与系统学习

以升级并验证后的实现为主要基准，先形成课程地图，再按顺序编写、运行和校验主题文档。`lessons/` 使用英文，原始课程资料和本计划可使用中文。

初步主题候选如下，具体拆分在本阶段确定：

| 主题 | 主要关联 |
|---|---|
| 产品总览与启动 | 产品 README、部署配置 |
| 一次对话的完整过程 | session routes、AgentService、AgentTaskRunner |
| LLM API 与结构化输出 | foundations 中的模型调用示例 |
| 工具调用与 ReAct Loop | foundations 中的 ReAct 示例、BaseAgent |
| 规划与执行 | PlannerReActFlow、PlannerAgent、ReActAgent |
| 异步 HTTP 与事件传递 | HTTP 示例、Redis Stream、SSE、UI |
| 沙箱与内置工具 | browser、shell、file、存储 |
| MCP | labs 的服务端与客户端、产品 tools/mcp.py |
| A2A | SDK 与手写 HTTP 示例、产品 tools/a2a.py |
| 状态与失败路径 | 持久化、取消、迭代上限、断连、资源释放 |

每篇 lesson 包含学习目标、必要概念、可运行示例、产品代码入口、执行过程、设计理由和理解检查。只讲一个明确主题，不用一篇文档覆盖几十个脚本。

可以安排调试、观察和小实验，不把新增产品功能作为学习验收条件。涉及升级的内容简短说明旧写法、当前写法和变化原因，避免并行维护两套教程。

### 学习完成标准

- [ ] 能讲清 UI → 模型 → 工具/沙箱 → UI 的完整链路。
- [ ] 能说明主要模块职责、状态归属和数据持久化位置。
- [ ] 能解释 Plan、ReAct、MCP、A2A 的分工和关键设计理由。
- [ ] 能定位常见运行问题，说明重要失败路径的行为与限制。
- [ ] 能指出新增工具、修改执行策略时应该阅读和调整哪些模块。

不要求背下全部代码，也不要求先完成新功能。

## 8. 阶段 4：学习完成后再二开

根据届时的真实目标选第一项功能，再引入 `specs/`、`.specify/` 和适当的 SDD 流程。LangChain/LangGraph 可先做独立对照实验，是否迁移产品以具体收益和成本决定，优先级最低。

## 9. 当前下一步

Git 与目录整理完成后，进入阶段 1：在 `ray_agent/` 跑通原项目。跨设备同步还需用户提供远端仓库地址后配置并推送。
