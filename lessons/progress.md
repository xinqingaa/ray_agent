# Writing Progress

项目阶段与验收标准见 [PLAN](../PLAN.md)，课程设计见 [AGENTS](AGENTS.md#course-outline)，章节入口见 [README](README.md)。本文件只维护制作状态与验证缺口。

## Current work

第 01–04 章正文定稿；第 05 章已按通用概念与机制重写，配图改为用户指定的 Fireworks Style 1，待内容审阅。foundations 聊天脚本已统一为 `LLM_*`，可与产品 `.env` 使用同一组。其余章节仍为骨架。

下一步：审阅第 05 章的内容深度与新配图，再制作第 06 章并复跑共同任务。第 02–04 章真实模型观察仍待补跑；第 05 章真实 token / `usage` 与 `4_2` 分词仍为 unverified。

## Chapter tracking

| 章节 | 正文状态 | 验证情况 | 下一步 |
|---|---|---|---|
| [01 · 认识 RayAgent：从一句请求到任务完成](01-the-rayagent-system.md) | 正文完成 | 源码与链接静态核对（含步骤失败不进入 `update_plan`）；2 张课程定制 OpenAI 风格 SVG（1600×900）结构、几何与构图检查及 Chromium 渲染目视检查通过；产品未复跑 | 第 06 章取得运行证据后，核对本章共同任务说明 |
| [02 · 与模型交互](02-model-interaction.md) | 正文定稿 | 本地 HTTP 夹具 5 项测试通过；OpenAI 兼容契约与 labs 服务说明核对；SVG 检查及 Chromium 渲染目视检查通过；真实模型调用 unverified | 配置模型密钥后验证实际输出与分块 |
| [03 · 工具与行动](03-tools-and-actions.md) | 正文定稿 | 本地夹具 4 项测试通过；`3_8` 解析脚本实际运行；OpenAI 兼容契约与 labs 控制流核对；SVG 结构、几何与构图检查及 Chromium 渲染目视检查通过；真实模型调用 unverified | 配置模型密钥后验证 `3_7` 是否提出 `tool_calls` 并回传结果 |
| [04 · Agent Loop 与 ReAct](04-agent-loop-and-react.md) | 正文定稿 | 本地夹具 4 项测试通过；`4_1` / `4_3` / `4_4` 控制流静态核对；SVG 结构、几何与构图检查及 Chromium 渲染目视检查通过；真实模型调用 unverified | 配置模型密钥后验证 `4_1` 是否连续提出写入和读取 |
| [05 · 上下文与记忆](05-context-and-memory.md) | 重写完成，待审阅 | 通用概念与原始资料、产品源码静态核对；`5_1` 实际运行，5 项本地夹具测试通过；3 张 Fireworks Style 1 SVG（1600×900）结构、箭头、几何与构图检查通过，Chromium 渲染目视检查通过；真实 token 与 `4_2` 分词 unverified | 审阅正文深度与视觉表达；真实 token 验证仍待完整词表或模型 |
| [06 · 运行 RayAgent：观察一条完整任务](06-run-rayagent-one-complete-task.md) | 骨架 | 有阶段 1 历史验收，本章未复跑 | 复跑共同任务并记录关键观察 |
| [07 · 规划与内外层循环](07-planning-and-nested-loops.md) | 骨架 | 未进行本章运行验证 | 追踪共同任务的两层交接与终止 |
| [08 · 任务执行与控制](08-task-execution-and-control.md) | 骨架 | 未进行本章运行验证 | 核对任务入口、运行与取消路径 |
| [09 · 状态与持久化](09-state-and-persistence.md) | 骨架 | 未进行本章运行验证 | 建立状态归属与生命周期对照 |
| [10 · 事件与流式传递](10-events-and-streaming.md) | 骨架 | 未进行本章运行验证 | 核对事件契约和前后端消费路径 |
| [11 · 沙箱与执行环境](11-sandbox-and-execution-environment.md) | 骨架 | 未进行本章运行验证 | 核对沙箱生命周期与实际隔离范围 |
| [12 · 文件与任务产物](12-files-and-artifacts.md) | 骨架 | 未进行本章运行验证 | 追踪文件写入、同步与访问链路 |
| [13 · 浏览器如何成为工具](13-browser-as-a-tool.md) | 骨架 | 未进行本章运行验证 | 核对浏览器连接、会话与反馈路径 |
| [14 · 通过 MCP 接入外部工具](14-external-tools-with-mcp.md) | 骨架 | 未进行本章运行验证 | 选择协议基线并映射产品适配 |
| [15 · 通过 A2A 协作远程 Agent](15-agent-collaboration-with-a2a.md) | 骨架 | 未进行本章运行验证 | 核对远程任务与本地结果的映射 |
| [16 · 可靠性与验证](16-reliability-and-verification.md) | 骨架 | 未进行本章运行验证 | 建立故障场景、预期和验证证据表 |
| [17 · 从会话走向项目工作区](17-from-sessions-to-workspaces.md) | 骨架 | 待核对架构现状 | 对照当前能力整理工作区演进差距 |

## Evidence boundaries

第 01 章为机制导论，仅做静态核对与图形检查。第 02 章在 foundations 的 Python 3.12 / Requests 2.32.5 环境运行本地 HTTP 回归，验证同输入对照、首段提前显示、空增量与统计块、length 结束原因、缺失终止标记、HTTP 错误和缺少 `LLM_*`。第 03 章在同一环境运行本地夹具，验证参数校验、无工具时不执行、`tool_calls` 执行后以 `role: tool` 回传并带上 `tool_choice="none"`，以及强制 `tool_choice` 抽取字段；`3_8` 解析脚本已实际运行。第 04 章在同一环境运行本地夹具，验证只有 `content` 时停止、写入后再读取会继续请求且不带 `tool_choice`、工具不结束时按上限停止，以及 `3_7` 第二次调用锁死工具。第 05 章本轮在 foundations 锁定环境实际运行 `5_1`，并复跑 5 项本地夹具测试；验证示意消息中的观察与输出，不验证真实模型行为、残缺请求的协议有效性或服务端 token 数。字符统计不是服务端编码；`4_2` 的两处正文不同，且缺少完整词表，仍为 unverified。正文已区分通用策略、教学例子与当前产品行为；核对了消息的加载保存、模型输入及步骤成功后的局部清理。三张 SVG 使用用户指定的 Fireworks Style 1；XML、标记、箭头碰撞、几何与构图检查通过，脚本默认渲染器缺失，改用 Chromium 实际渲染并目视检查中文、文字边界及布局；临时 PNG 未加入项目。真实模型调用本轮未复跑，仍为 `unverified`，正文与图中的响应均为示意；本轮没有启动 RayAgent 产品。素材中保留的历史验证不代表各章已验证；正文写完与运行验证完成分别记录。未执行的观察标为 `unverified`。

每次制作后更新对应章节的正文状态、已验证范围和一个具体下一步，不复制正文或逐次操作日志。
