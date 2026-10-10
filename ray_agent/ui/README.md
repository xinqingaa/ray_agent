# RayAgent UI 开发指南

前端使用 Next.js、React、TypeScript、Tailwind CSS 和 Radix UI，消费 API 数据与事件。用户流程见[产品说明](../../docs/product.md)，设计规则见 [DESIGN.md](DESIGN.md)，整体数据与资源归属见[架构说明](../../docs/architecture.md)。完整部署见[运行指南](../README.md)。本指南维护开发、数据契约及检查入口，命令不表示本轮已执行。

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

项目导航将主页链接、最右侧展开箭头和新增对话入口分开。新增入口使用带项目 id 的聚焦事件及首次进入的地址锚点，准备输入不创建会话。主页管理视图保留输入组件挂载；对话的项目文件复用只读查看器，管理操作只放在主页。普通列表省去系统目录层但使用原路径读取，不能用展示名称发起预览请求。

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

开发者模式通过统一 hook 与区域可见性工厂控制，默认关闭、浏览器存储、同源标签页同步。后续显隐微调集中修改区域策略；入口见[代码地图](../../docs/code-map.md)。模式切换不修改配置、工具权限或事件订阅；关闭/隐藏终端停止轮询，隐藏设置保留草稿及原值。

组件消费 hooks 和 providers 提供的状态。事件契约变化时，同时核对后端映射、前端类型和归一化逻辑，避免只调整展示组件。

进入会话先取详情里的全部运行与事件，记下最大序号，再保持一条 `GET /sessions/{id}/events?after_seq=`。SSE 的 `id` 即序号。断开后按最后收到的序号重连，等待从 500 毫秒翻倍，上限 4 秒。发送消息只调用 `POST /sessions/{id}/chat`，返回 `run_id`、`seq` 与 `route`（`started`、`resumed` 或 `injected`），不再为发送单独开流。

侧栏列表走 `POST /sessions/stream?independent=true`。可见标签共用这一条连接；服务端在目录有写入时重读一页，内容没变不推送，没有通知时约 30 秒兜底。项目列表、展开项目里的对话、项目文件和记忆跟随同一条目录通知，页面重新可见时再核对一次。压缩进行中才按约 3 秒读会话详情里的临时状态，结束后停止。终端仍只在命令运行中按约 1.5 秒读取。

文本增量是没有 `id` 的 `event: delta`，载荷为 `run_id`、`turn`、`attempt`、`delta`。它不写入带序号的事件列表，刷新和重连也不会补发。订阅按 `(run_id, turn, attempt)` 拼成时间线末尾的临时旁白；同一 attempt 的助手消息到达后改由那条已保存消息显示。出现更大的 attempt、另一轮、该轮结束但没有对应助手消息，或运行进入终态时，临时旁白丢掉。断线重连同样丢掉尚未保存的半截文本。

## 视图契约

`useSessionDetail` 提供会话数据、投影 `view`、提交状态、`sendMessage`、`stop`、`replyApproval` 与 `loadTurnRequest`。组件消费 `view`，数据结构以 [session-view.ts](src/lib/session-view.ts)为准；事件合并与状态推导维护在投影层，避免各组件重新推断同一事实。

| 契约 | 处理方式 |
|---|---|
| 活动与终态 | 由 run、wait、approval 及本地提交状态推导；停止不等于完成，压缩状态独立 |
| 工具结果 | calling/called 按调用 ID 合并；失败、跳过、拒绝、未知结果分别表达；实时和历史共用归一化 |
| 审批 | pending 构造调用，结论原地更新，批准后的工具结果合并；expired 为未执行，审批等待不生成提问卡 |
| 临时文本 | 按 run/turn/attempt 合并，完整消息替换；刷新、重连或终态丢弃尚未保存内容 |
| 轮次与用量 | 取已结束轮次；速度由输出量与生成耗时推导，扣除可用的推理量，缺失时标估算；不是瞬时速度 |
| 工作台 | 手选结果或打开文件后固定，回到最新恢复跟随；预览失败显示当前对象错误，旧响应不覆盖当前选择；终端读取失败保留已取得输出 |
| 文件上传 | XHR 给出字节进度，发布数量单独确认；扫描中或服务器落盘不可测阶段不伪造百分比 |
| 项目记忆 | 说明/笔记版本与摘要代次分别处理；冲突保存草稿并取最新值，历史取回用于编辑 |

审批提交调用 `replyApproval(toolCallId, 'approve' | 'deny')`，提交状态保持至结论到达；接口出错时重取详情。等待审批时输入框引导批准、拒绝或停止，待答复调用不进入工作台。工具策略经配置 API 整表读写。

模型请求原文使用 `loadTurnRequest` 或 `sessionApi.getTurnRequest`，只读重建，不重放工具。用户操作可用性由共用命令状态判断，按计划执行要核对有效计划，不能只检查 run.mode。

## 文件与图片查看

对话附件和交付文件单击整张文件卡直接打开大预览，关闭后回到原阅读位置；会话文件单击整行在工作台打开，预览标题可点击展开。预览、下载与打包下载使用带可访问名称和提示的图标。不支持的类型保留查看和下载入口，并显示“仅下载”。文件页展示实际文件，不把交付工具回执当作文件正文。托管项目文件共用查看器，刷新后从最新版本重新读取。

CSV/TSV 与 XLSX/XLS 使用表格窗口，工作簿可切换工作表；文本按段读取，Markdown 可切换原文。图片和浏览器截图共用适应窗口、缩放、原始尺寸、拖动和下载。PDF 使用浏览器阅读器。预览来源、资源限制和格式边界见[能力与边界](../../docs/capabilities.md#文件预览与下载边界)，界面只显示短状态和操作。

## 设计与主题

设计原则、视觉语义和交互契约见 [DESIGN.md](DESIGN.md)。取值以 [src/app/globals.css](src/app/globals.css) 为准。

浅色画布、侧栏与弱底色统一由 `:root` token 控制；深色 token 独立保留。品牌标记的界面组件是 [brand-mark.tsx](src/components/brand-mark.tsx)，浏览器图标是 [brand-mark.svg](public/brand-mark.svg)。

主题由 `next-themes` 挂在根布局，`attribute="class"`，默认跟随系统，也可在设置页“外观”分区切换浅色或深色。选择保存在浏览器本地。深色 token 写在 `.dark` 下，不要在组件里再写一套 `dark:` 颜色。

业务界面使用这些 token，例如 `bg-background`、`text-muted-foreground`、`text-state-running`、`bg-signal`。新界面不要写 `gray-*` 或十六进制颜色。计时、轮次、token 和字节数加 `tabular-nums`；命令、路径和代码用 `font-mono`。状态色成对使用文字类与浅底类（`text-state-*` 与 `bg-state-*-soft`）。

## 组件状态目录

开发模式下打开 [http://localhost:3000/dev/components](http://localhost:3000/dev/components)，路由在 [src/app/dev/components/page.tsx](src/app/dev/components/page.tsx)。页面用 [src/fixtures/](src/fixtures/) 里的视图模型夹具，逐个列出运行视图和设置列表的状态，供修改组件时回归。生产构建中该路由返回 404，不带会话侧栏。

历史事件夹具中补写的字段写在 [w1-sessions.ts](src/fixtures/w1-sessions.ts) 文件头；合成终态如何补写 `summary` 与轮次结束时间写在 [states.ts](src/fixtures/states.ts) 文件头。目录页在会话页接入这些组件后保留，供以后改组件时回归。

## 检查与构建

```bash
node scripts/check-model-configuration.cjs
node scripts/check-effort-slider.cjs
node scripts/check-process-block.cjs
node scripts/check-developer-mode.cjs
node scripts/check-workbench-width.cjs
node scripts/check-markdown-preview.cjs
npm run lint
npm run build
npm run start
```

`start` 需要已有构建产物。当前没有覆盖完整交互的自动化测试套件；lint 和构建不验证完整交互。本地事件观察见下节。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

容器使用多阶段构建并输出 standalone 应用。整体启动见 [运行指南](../README.md)，启停与日志见 [Docker 操作说明](../DOCKER.md)。


## 事件观察

安装锁定依赖后，可直接运行本地观察脚本，无需启动 Next.js。命令脚本检查共用可用性；发送脚本模拟响应丢失和受理读回；工作台脚本通过实际共享查看器与项目组件检查乱序响应、取消、分段读取版本、项目刷新与读取失败，传输及基础 UI 元素为替身，不能替代浏览器布局和真实服务验收。React renderer 会输出既有弃用提示：

```bash
node scripts/check-event-observability.cjs
node scripts/check-slash-trigger.cjs
node scripts/check-command-state.cjs
node scripts/check-send-recovery.cjs
node scripts/check-workbench-recovery.cjs
node scripts/check-project-navigation-recovery.cjs
node scripts/check-project-ui-actions.cjs
node scripts/check-project-upload-tree.cjs
```

脚本用项目 TypeScript 转译器加载实际的 SSE 解析与 `projectSession`，不复制实现，也不连接产品服务。它检查 LF 逐字节分块（含中文 UTF-8）、非法 JSON 回调、SSE `id` 保留、重连等待上限、按 seq 去重与补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity、轮次用时与用量、计划的 `changed`，以及停止、重启中断和请求上限的可读原因。增量检查覆盖增量按 `(run_id, turn, attempt)` 累积且不进入带序号的事件列表、同一 attempt 的助手消息替换临时条目、更大 attempt 或另一轮丢弃旧条目、轮次结束或运行终态后没有临时条目，以及没有 usage 时速度标为估算、有 usage 时按公式计算并扣除推理 token。审批检查覆盖只有审批事件时从事件构造调用条目且不生成提问条目、批准后 pending 与结论合并为一条并写回执行结果、拒绝为 denied（`denied_by=user`）、策略禁止在工具组里为 denied 且没有审批条目，以及停止或 API 重启后审批为 expired、调用为未执行。另将两个当前限制明确打印为 `LIMITATION`：EOF 分派未以空行结束的完整 JSON 尾段，以及 CRLF 恰在 CR/LF 之间分块时丢失事件类型。脚本退出成功表示上述行为与限制得到复现，不表示 SSE 标准符合性、hook 挂载或浏览器断线恢复已通过。

类型检查没有单独的 npm script，在本目录执行 `npx tsc --noEmit`。lint 与生产构建见上一节。

项目导航恢复脚本通过实际组件检查分页请求过期、首屏之外的当前项目与对话定位、读取失败保留当前对话，以及清单为空但对象回收待重试时的清理入口；请求与基础 UI 为替身，真实数据库和浏览器需另行验证。

导入审核树检查使用实际扫描器与 React 组件、合成文件和规则，核对筛选不改变上传集合、禁止项无确认入口、未知大小与确认后扫描、覆盖和失败状态。组件状态目录增加“项目导入审核树”，多层和长列表数据明确为合成，不替代真实文件选择与上传验收。

项目主页使用对话、文件、说明、笔记、摘要页签，项目对话与独立对话共用 `SessionItem`。文件管理默认平铺系统目录，不暴露系统目录入口；说明与笔记复用既有草稿、版本冲突及历史编辑器。危险操作确认由 `DataCleanupDialog` 统一处理，`DataCleanupNotice` 在弹窗关闭后继续读取进度；清理完成通过同源通知刷新导航并清除目标草稿。组件检查不能替代永久删除的隔离数据库验证。

项目操作检查使用固定占用响应挂载实际数据确认与设置数据分区，验证查看占用时同时退出父层设置与清空确认再导航，离开被拒绝时不导航、不触发清理；不修改真实任务状态。
