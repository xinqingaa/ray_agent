# RayAgent UI 开发指南

前端使用 Next.js、React、TypeScript、Tailwind CSS、Radix UI 和 noVNC。它消费 API 数据与事件，展示会话、计划、工具结果和沙箱画面。项目导航、打开项目、输入命令和上下文环的当前交互不在本指南维护，见[总计划](../../docs/plan/README.md)指向的 W5 修订与 W9、W10、W11。侧栏和导入审核以 W5 修订为准。

整体数据流见 [架构说明](../../docs/architecture.md)，完整应用部署见 [运行指南](../README.md)。以下命令在 `ray_agent/ui/` 执行，依据项目配置核对，尚未完成运行验证。

## 安装与启动

使用 Node.js 22 与 npm，与 [Dockerfile](Dockerfile) 的构建环境保持一致。依赖和脚本以 [package.json](package.json) 与 [package-lock.json](package-lock.json) 为准。

```bash
npm ci
npm run dev
```

开发页面默认地址为 [http://localhost:3000](http://localhost:3000)。启动前按下节配置 API 地址。

## API 地址与访问方式

请求封装读取 `NEXT_PUBLIC_API_BASE_URL`，未设置时使用 `http://localhost:8088/api`。默认值定义在 [fetch.ts](src/lib/api/fetch.ts)，[next.config.ts](next.config.ts) 没有配置 API 转发规则。

| 方式 | 地址配置 | 请求路径 |
|---|---|---|
| 本地 UI 连接本地 API | 在 `.env.local` 设置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api` | 浏览器直接访问 API；需确认可达性与跨域配置 |
| 本地 UI 连接运行中的网关 | 使用默认地址，或填写实际网关地址 | 浏览器访问网关，再由网关转发 API 请求 |
| Compose 部署 | 构建参数设置为 `/api` | 浏览器向页面同源网关发送请求，由 Nginx 转发 |

`localhost` 指浏览器所在设备。通过另一台设备访问 UI 时，需要配置浏览器能访问的 API 或网关地址。

环境变量在开发服务启动或应用构建时读取。修改后重启开发服务；部署产物需要重新构建，不能仅调整已构建容器的运行时变量。

## 代码导航

| 职责 | 入口 |
|---|---|
| 页面与路由 | [src/app/](src/app/) |
| HTTP、流式请求和类型 | [src/lib/api/](src/lib/api/) |
| 会话视图模型 | [session-view.ts](src/lib/session-view.ts) |
| 事件投影 | [session-projection.ts](src/lib/session-projection.ts) |
| 事件归一化 | [session-events.ts](src/lib/session-events.ts) |
| 会话详情与实时订阅 | [use-session-detail.ts](src/hooks/use-session-detail.ts) |
| 共享会话状态 | [src/providers/](src/providers/) |
| 交互与结果展示 | [src/components/](src/components/) |

组件消费 hooks 和 providers 提供的状态。事件契约变化时，同时核对后端映射、前端类型和归一化逻辑，避免只调整展示组件。

进入会话先取详情里的全部运行与事件，记下最大序号，再保持一条 `GET /sessions/{id}/events?after_seq=`。SSE 的 `id` 即序号。断开后按最后收到的序号重连，等待从 500 毫秒翻倍，上限 4 秒。发送消息只调用 `POST /sessions/{id}/chat`，返回 `run_id`、`seq` 与 `route`（`started`、`resumed` 或 `injected`），不再为发送单独开流。

文本增量是没有 `id` 的 `event: delta`，载荷为 `run_id`、`turn`、`attempt`、`delta`。它不写入带序号的事件列表，刷新和重连也不会补发。订阅按 `(run_id, turn, attempt)` 拼成时间线末尾的临时旁白；同一 attempt 的助手消息到达后改由那条已保存消息显示。出现更大的 attempt、另一轮、该轮结束但没有对应助手消息，或运行进入终态时，临时旁白丢掉。断线重连同样丢掉尚未保存的半截文本。

`useSessionDetail` 在原有的会话、文件、事件和 `sendMessage` 之外，返回投影结果 `view`、提交中的 `submitting`（与 `streaming` 相同）、`stop`、`replyApproval` 和 `loadTurnRequest`。某一轮发给模型的请求也可以用 `sessionApi.getTurnRequest`。字段约定见 [W4 子计划](../../docs/plan/w4-ui-data.md#视图模型契约)。

会话页只渲染 `view`：状态条、时间线、计划条和上下文环都读这份投影。正在增长的条目 id 放在 `handlers.streamingItemId`。停止调用 `stop()`。运行中按回车仍可发送补充要求；等待回复时占位符说明回复会继续当前任务，发送按钮恢复为发送。消息一经送出，时间线末尾只显示一句「正在思考」，发送按钮改为暂停；沙箱未就绪改为「正在准备执行环境」，停止中改为「正在停止」，出现工具行后不再另写一句。生成过程中，时间线显示逐步增长的文本，这一句随之收起。状态行在输入框上方，进行中和等待只显示用时和轮次。失败、已停止和已中断的原因只在时间线终态条。再发或重试时先收起上一轮终态。已结束轮次的速度在 `completion_tokens`、`ttft_ms` 都有值且 `model_ms` 更大时按 `completion_tokens / (model_ms − ttft_ms)` 计算，`reasoning_tokens` 有值时先从分子扣除，缺少用量时按字符估算。速度只在开发者视图的已结束轮次行显示，并在尝试次数大于 1 或扣除了推理 token 时用提示说明偏差。失败尝试的原因代码在提示里写成「连接中断或超时」「输出流中断」「空回复」「模型拒绝请求」「已停止」；只有传输中断、流中断和空回复在不再重试时才加上「已达到重试上限」。审批事件（`approval`）投影为时间线上的审批条目：挂起的调用在答复前没有工具事件，调用视图从审批事件本身构造，MCP 标题用 `service` 与 `service_tool`；结论事件原地更新同一条目，批准后该调用的 `tool` 事件写回条目里的调用，不另起工具组；`expired` 时调用标为未执行。审批挂起时的 `wait` 不生成提问条目。`run(waiting, reason=approval)` 时 activity 为 `waiting_approval`。审批卡的批准与拒绝调用 `replyApproval(toolCallId, 'approve' | 'deny')`，提交中状态保持到结论事件到达；接口出错时提示并重新拉取详情。等待批准时输入框禁用，占位符引导批准、拒绝或暂停；等待中的调用不进入工作台。设置页工具策略分区经 `getToolPolicy` / `updateToolPolicy` 整表读写 `/app-config/tool-policy`。工作台进入会话时默认关闭，点击顶部入口、工具记录或文件预览后打开；打开后默认跟随最新工具，点开某次调用后固定，直到「回到最新」。搜索、MCP、远程 Agent、计划和其他工具默认落在结果页，Shell、浏览器、文件调用分别落在专属页；没有相应调用时不显示空的终端或浏览器标签。终端在该次 Shell 调用仍为运行中时，按约 1.5 秒调用 `sessionApi.viewShell`（请求体字段为 `session_id`），浏览器 `online` 事件触发时立即重读；读取失败时保留上次输出并提示。开发者视图用 `loadTurnRequest` 显示某一轮重建出的请求。当前会话的运行状态会写回会话列表里的对应项，终态后侧栏不再停在「运行中」。组件状态目录在接入后保留。

## 设计与主题

设计方案、颜色、字体、间距、圆角和组件状态清单见 [DESIGN.md](DESIGN.md)。取值以 [src/app/globals.css](src/app/globals.css) 为准。

浅色画布、侧栏与弱底色统一由 `:root` token 控制；深色 token 独立保留。品牌标记的界面组件是 [brand-mark.tsx](src/components/brand-mark.tsx)，浏览器图标是 [brand-mark.svg](public/brand-mark.svg)。

主题由 `next-themes` 挂在根布局，`attribute="class"`，默认跟随系统，也可在设置页“外观”分区切换浅色或深色。选择保存在浏览器本地。深色 token 写在 `.dark` 下，不要在组件里再写一套 `dark:` 颜色。

业务界面使用这些 token，例如 `bg-background`、`text-muted-foreground`、`text-state-running`、`bg-signal`。新界面不要写 `gray-*` 或十六进制颜色。计时、轮次、token 和字节数加 `tabular-nums`；命令、路径和代码用 `font-mono`。状态色成对使用文字类与浅底类（`text-state-*` 与 `bg-state-*-soft`）。

## 组件状态目录

开发模式下打开 [http://localhost:3000/dev/components](http://localhost:3000/dev/components)，路由在 [src/app/dev/components/page.tsx](src/app/dev/components/page.tsx)。页面用 [src/fixtures/](src/fixtures/) 里的视图模型夹具，逐个列出运行视图和设置列表的状态，供修改组件时回归。生产构建中该路由返回 404，不带会话侧栏。

夹具里按 W3 契约补写的字段写在 [w1-sessions.ts](src/fixtures/w1-sessions.ts) 文件头；合成终态如何补写 `summary` 与轮次结束时间写在 [states.ts](src/fixtures/states.ts) 文件头。目录页在会话页接入这些组件后保留，供以后改组件时回归。

## 检查与构建

```bash
node scripts/check-model-configuration.cjs
npm run lint
npm run build
npm run start
```

`start` 需要已有构建产物。当前没有覆盖完整交互的自动化测试套件；lint 和构建不验证完整交互。本地事件观察见下节。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

容器使用多阶段构建并输出 standalone 应用。整体启动见 [运行指南](../README.md)，启停与日志见 [Docker 操作说明](../DOCKER.md)。


## 事件观察

安装锁定依赖后，可直接运行本地观察脚本，无需启动 Next.js。命令脚本检查共用可用性；发送脚本模拟响应丢失和受理读回；工作台脚本通过实际 React effects 检查乱序响应、双范围 diff、刷新与读取失败，传输及基础 UI 元素为替身，不能替代浏览器布局和真实服务验收。React renderer 会输出既有弃用提示：

```bash
node scripts/check-event-observability.cjs
node scripts/check-slash-trigger.cjs
node scripts/check-command-state.cjs
node scripts/check-send-recovery.cjs
node scripts/check-workbench-recovery.cjs
node scripts/check-project-navigation-recovery.cjs
node scripts/check-project-upload-tree.cjs
```

脚本用项目 TypeScript 转译器加载实际的 SSE 解析与 `projectSession`，不复制实现，也不连接产品服务。它检查 LF 逐字节分块（含中文 UTF-8）、非法 JSON 回调、SSE `id` 保留、重连等待上限、按 seq 去重与补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity、轮次用时与用量、计划的 `changed`，以及停止、重启中断和请求上限的可读原因。W6 另检查增量按 `(run_id, turn, attempt)` 累积且不进入带序号的事件列表、同一 attempt 的助手消息替换临时条目、更大 attempt 或另一轮丢弃旧条目、轮次结束或运行终态后没有临时条目，以及没有 usage 时速度标为估算、有 usage 时按公式计算并扣除推理 token。W7.2 另检查只有审批事件时从事件构造调用条目且不生成提问条目、批准后 pending 与结论合并为一条并写回执行结果、拒绝为 denied（`denied_by=user`）、策略禁止在工具组里为 denied 且没有审批条目，以及停止或 API 重启后审批为 expired、调用为未执行。另将两个当前限制明确打印为 `LIMITATION`：EOF 分派未以空行结束的完整 JSON 尾段，以及 CRLF 恰在 CR/LF 之间分块时丢失事件类型。脚本退出成功表示上述行为与限制得到复现，不表示 SSE 标准符合性、hook 挂载或浏览器断线恢复已通过。

类型检查没有单独的 npm script，在本目录执行 `npx tsc --noEmit`。lint 与生产构建见上一节。

项目导航恢复脚本通过实际组件检查分页请求过期、首屏之外的当前项目与对话定位、读取失败保留当前对话，以及清单为空但对象回收待重试时的清理入口；请求与基础 UI 为替身，真实数据库和浏览器需另行验证。

导入审核树检查使用实际扫描器与 React 组件、合成文件和规则，核对筛选不改变上传集合、禁止项无确认入口、未知大小与确认后扫描、覆盖和失败状态。组件状态目录增加“项目导入审核树”，多层和长列表数据明确为合成，不替代真实文件选择与上传验收。
