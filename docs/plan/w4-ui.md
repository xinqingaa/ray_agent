# W4：前端适配

所属：[二次开发总计划](README.md)。前置：W3（新接口）；W1、W2 的事件语义。规模：中，1 个对话。

## 目标与不做

**目标：** 页面按 W3 的事件接口订阅一条按序号续传的事件流，会话状态以运行状态为准，时间线准确呈现单循环的过程：用户消息、助手旁白、工具调用、计划清单、提问、交付、压缩与终态。

**不做：** 视觉重设计；设置页重构；流式增量渲染（W5）；审批卡片（W6，本包预留组件位置）。VNC、文件预览、工具预览面板保持现有行为。

## 现状

- [`hooks/use-session-detail.ts`](../../ray_agent/ui/src/hooks/use-session-detail.ts) 同时维护“发送消息的流”和“空消息的补齐流”，流结束后延迟重连（第 102–129 行、第 226–305 行）；会话状态从 step、tool、wait、done、error 事件推断（第 62–99 行），发送时先乐观置为 running。
- [`lib/session-events.ts`](../../ray_agent/ui/src/lib/session-events.ts) 按 step 分组工具（第 174–259 行），没有 step 时平铺；`collapseRetriedTurns` 与 `trimToLastUserMessage` 会隐藏同内容重试之前的失败轮次（第 427–470 行）。
- 计划面板读取最新 plan 事件并合并 step 事件的状态（第 333–360 行；[`components/plan-panel.tsx`](../../ray_agent/ui/src/components/plan-panel.tsx)）。
- 已有本地观察脚本 [`scripts/check-event-observability.cjs`](../../ray_agent/ui/scripts/check-event-observability.cjs)，转译并执行真实 UI 模块验证 SSE 解析与时间线构建。

## 设计

### 订阅

- 进入会话：请求会话详情，得到事件列表（含 seq）与最新运行状态，记录最大 seq；随后打开 `GET /sessions/{id}/events?after_seq=` 的 SSE，页面存在期间保持一条连接，断开后按最后收到的 seq 重连（指数退避，上限数秒）。
- 发送消息：调用 `POST /chat`，只负责提交；新事件从已打开的订阅到达。不再为发送单独开流。
- 去重：按 seq 丢弃已经收到的事件，保证重连与重复推送不产生重复条目。
- 状态：以最新运行状态为准。只有收到运行状态变化的事件或重新拉取详情时才改变显示状态；发送时的“提交中”只是按钮的临时禁用，不改写运行状态。

### 时间线

| 条目 | 来源 | 展示 |
|---|---|---|
| 用户消息 | 用户 `MessageEvent` | 文本与上传附件 |
| 助手旁白 | 伴随工具调用的助手文本 | 较弱样式，位于其后的工具卡片之前 |
| 工具卡片 | `ToolEvent`，按 `tool_call_id` 合并 calling/called | 平铺，复用现有工具组件与预览面板 |
| 提问 | `message_ask_user` 与等待状态 | 问题卡片；输入框提示“回复将继续当前任务” |
| 交付 | 带附件的助手消息 | 文件卡片，可预览、下载 |
| 压缩 | `compact` 事件 | 一行提示“已压缩较早的上下文” |
| 最终回复 | 最后一条助手消息 | Markdown |
| 终态条 | 运行状态与原因 | completed 不显示；failed 显示原因（映射为可读文字）；cancelled 显示“已停止”；interrupted 显示“服务重启导致中断” |

同一会话的多次运行按时间自然排列；失败轮次保留，不再因同内容重试而隐藏。删除 step 分组逻辑、`collapseRetriedTurns`、`trimToLastUserMessage` 及相关重试裁剪。“重试”按钮保留为“以相同内容再发一次”，只发送消息，不删除已有事件。

### 计划面板与用量

- 计划面板只读取最新的 plan 事件，状态直接来自事件（pending、running、completed），去掉 step 合并逻辑；运行结束后面板保留最后的清单。
- 用量显示改为“本次运行”与“会话累计”，数据来自 usage 事件或运行汇总。

### 状态与交互

- running：显示停止按钮；输入框可用，发送的内容作为补充要求注入（W1 语义），提示文字说明这一点；
- waiting：输入框提示回复提问；
- 终态：输入框可发送新消息，将创建新运行。

## 改动清单

- `lib/api/session.ts`、`lib/api/types.ts`、`lib/api/fetch.ts`：新接口、seq/run_id 字段、运行状态与原因类型；
- `hooks/use-session-detail.ts`：重写订阅与状态；
- `lib/session-events.ts`：新的时间线构建，删除 step 分组与重试裁剪；
- `components/`：旁白、提问、交付、压缩、终态条的展示；计划面板与用量显示调整；
- `scripts/check-event-observability.cjs`：更新为新的事件形态与去重、断线补齐用例。

## 验收

- `npm run lint` 与生产构建通过；
- 观察脚本覆盖：按 seq 去重、重连后补齐、calling/called 合并、失败轮次保留、各终态条的显示文字；
- 真实浏览器（Compose 与真实模型）：完成 E2（计划清单、工具记录、交付文件下载）、E3（提问与回复后继续）；任务运行中刷新页面，事件完整、不重复；运行中断开网络再恢复，页面补齐期间的事件；运行中停止，显示“已停止”；运行中重启 API，显示“服务重启导致中断”。截图只用于当次验证记录，存放在 `docs/plan/evidence/`，不作为课程配图。

## docs 同步

- [产品说明](../product.md)：会话与任务、观察与历史、怎么判断任务完成；
- [UI 开发指南](../../ray_agent/ui/README.md)：订阅方式与检查脚本；
- [代码地图](../code-map.md)：前端分组；
- [能力与边界](../capabilities.md)：SSE 重连与补齐从“未验证”移出（以实际验证结果为准）。

## 交接

下游依赖：时间线条目的组件划分（W5 在助手消息位置渲染增量文本；W6 在提问卡片旁增加审批卡片）；订阅 hook 的事件分发入口。
