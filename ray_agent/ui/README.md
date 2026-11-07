# RayAgent UI 开发指南

共享界面使用 Vite、React、React Router、TypeScript、Tailwind CSS 和 Radix UI，运行在桌面宿主的 WebView 中，消费核心数据与事件。用户流程见[产品说明](../../docs/product.md)，设计规则见 [DESIGN.md](DESIGN.md)，整体数据与资源归属见[架构说明](../../docs/architecture.md)，宿主与运行方式见[桌面开发指南](../desktop/README.md)。本指南维护开发、数据契约及检查入口，命令仅提供运行入口，不表示已经通过。

## 安装与启动

使用 Node.js 22 与 npm。依赖和脚本以 [package.json](package.json) 与 [package-lock.json](package-lock.json) 为准。

```bash
npm ci
```

日常开发在 `ray_agent/desktop` 运行 `npm run dev`，它会在本目录启动 Vite 开发服务器（端口固定，见 [vite.config.ts](vite.config.ts)）并打开宿主窗口。单独运行本目录的 `npm run dev` 也能启动开发服务器，但业务页面只在宿主窗口中工作，普通浏览器只显示“请从 RayAgent 应用打开”；不需要核心的[组件状态目录](#组件状态目录)可以在普通浏览器打开。

## 核心连接与平台能力

界面不配置 API 地址。[core-gate.tsx](src/components/core-gate.tsx) 经宿主命令读取核心状态：启动中显示等待，就绪后把接口地址与实例令牌交给 [core-client.ts](src/lib/core-client.ts) 再渲染业务页面，失败、版本不匹配或核心退出时显示原因、日志尾部与重新启动入口。核心重新拉起后令牌变化，业务页面整体重新挂载。轮询间隔见[运行参数与限额](../../docs/limits.md#桌面宿主与核心进程)。

- 普通请求与 SSE 由请求封装经 `coreUrl` 拼地址、`coreHeaders` 加 `Authorization`，组件只传 `/sessions/...` 这类相对路径，不自行拼主机或令牌。
- 图片与 PDF 由 WebView 按 URL 加载，带不了请求头：[preview.ts](src/lib/api/preview.ts) 的 `previewContentUrl` 先申请短期票据并缓存，临近到期重新申请，再把票据拼进内容地址。令牌不进 URL。
- 下载、打包下载与保存图片经宿主的保存对话框完成；HTML 文件与外部链接交给系统浏览器打开。界面中的跨源链接点击由 [external-links.ts](src/lib/external-links.ts) 统一转交宿主，WebView 本身不打开外部页面。
- 访问宿主的代码只在 [platform.ts](src/lib/platform.ts)，组件和检查脚本只依赖这一个模块；宿主命令的语义见[桌面开发指南](../desktop/README.md#界面与宿主的接口)。
- 退出请求由 [quit-guard.tsx](src/components/quit-guard.tsx) 接住：没有活动任务直接确认退出，否则先弹出确认；读取会话失败时同样先确认。

## 代码导航

| 职责 | 入口 |
|---|---|
| 应用入口与路由 | [main.tsx](src/main.tsx)、[app.tsx](src/app.tsx)、[src/pages/](src/pages) |
| 路由封装 | [navigation.tsx](src/lib/navigation.tsx)：组件统一从这里取 `Link`、`useRouter`、`usePathname` 与 `useParams` |
| 核心连接与宿主能力 | [core-client.ts](src/lib/core-client.ts)、[platform.ts](src/lib/platform.ts)、[core-gate.tsx](src/components/core-gate.tsx) |
| HTTP、流式请求和类型 | [src/lib/api/](src/lib/api) |
| 会话视图模型 | [session-view.ts](src/lib/session-view.ts) |
| 事件投影 | [session-projection.ts](src/lib/session-projection.ts) |
| 事件归一化 | [session-events.ts](src/lib/session-events.ts) |
| 会话详情与实时订阅 | [use-session-detail.ts](src/hooks/use-session-detail.ts) |
| 共享会话状态 | [src/providers/](src/providers) |
| 交互与结果展示 | [src/components/](src/components) |

开发者模式通过统一 hook 与区域可见性工厂控制，默认关闭，保存在本地存储。显隐策略集中维护；入口见[代码地图](../../docs/code-map.md)。模式切换不修改配置、工具权限或事件订阅；关闭/隐藏终端停止轮询，隐藏设置保留草稿及原值。会话的“聊天／日志”使用分段控件并横向翻页，减少动态效果时关闭过渡；日志模式隐藏输入区但保留输入组件，切回聊天恢复草稿。

组件消费 hooks 和 providers 提供的状态。事件契约变化时，同时核对后端映射、前端类型和归一化逻辑，避免只调整展示组件。确认计划按钮附带来源运行、计划 ID、计划事件序号和持久请求标识；响应丢失后的重试沿用草稿里的原标识。

### 契约类型与错误

事件、错误、响应包装与核心状态的类型来自 [ray_agent/contracts](../contracts/README.md) 的生成结果，经路径别名 `@contracts/*` 引用，在 [types.ts](src/lib/api/types.ts) 中派生为界面使用的名称：前端把事件信封 `{event, data}` 统一为 `{type, data}`（`SSEEventData`，按类型取单个事件用 `SSEEventOf`）。只用 `import type` 引用生成文件，它们不进入打包产物，检查脚本的转译也不需要解析这些路径。其余接口类型仍为手写，修改对应接口时替换为生成类型；契约变化后先重新生成，再运行下文的类型检查与构建。

请求封装把失败统一为 `ApiError`：`status` 为 HTTP 状态，没有收到响应（超时、断网）时为 0；`code` 是核心返回的机器可读代码（如 `conflict`、`gone`），另有 `retryable`、`retryAfterMs`、`resourceVersion` 与 `details`。`rejected` 为真表示核心已明确拒绝，可以解除待核对状态；其余失败结果未知，先读回再决定是否重试。按冲突、过期等情况分支时判断 `code`，不要比较 HTTP 状态数字。

进入会话先取详情里的全部运行与事件，记下最大序号，再保持一条 `GET /sessions/{id}/events?after_seq=`。SSE 的 `id` 即序号，每帧的 `data` 带 `seq` 与 `event_version`。断开后按最后收到的序号重连，等待从较短间隔翻倍，直到上限。间隔见[运行参数与限额](../../docs/limits.md)。发送消息只调用 `POST /sessions/{id}/chat`，返回 `run_id`、`seq` 与 `route`（`started`、`resumed` 或 `injected`），不再为发送单独开流。

侧栏列表走 `POST /sessions/stream?independent=true`。可见标签共用这一条连接；服务端在目录有写入时重读一页，内容没变不推送，没有通知时按较长间隔兜底。页面重新可见时再核对一次。压缩进行中才定期读会话详情里的临时状态，结束后停止。终端仍只在命令运行中定期读取。间隔见[运行参数与限额](../../docs/limits.md)。

文本增量是没有 `id` 的 `event: delta`，载荷为 `run_id`、`turn`、`attempt`、`delta`。它不写入带序号的事件列表，刷新和重连也不会补发。订阅按 `(run_id, turn, attempt)` 拼成时间线末尾的临时旁白；同一 attempt 的助手消息到达后改由那条已保存消息显示。出现更大的 attempt、另一轮、该轮结束但没有对应助手消息，或运行进入终态时，临时旁白丢掉。断线重连同样丢掉尚未保存的半截文本。

## 视图契约

`useSessionDetail` 提供会话数据、投影 `view`、提交状态、`sendMessage`、`stop`、`replyApproval` 与 `loadTurnRequest`。组件消费 `view`，数据结构以 [session-view.ts](src/lib/session-view.ts)为准；事件合并与状态推导维护在投影层，避免各组件重新推断同一事实。

| 契约 | 处理方式 |
|---|---|
| 活动与终态 | 由 run、wait、approval 及本地提交状态推导；停止不等于完成，压缩状态独立 |
| 工具结果 | calling/called 按调用 ID 合并；失败、跳过、拒绝、未知结果分别表达；实时和历史共用归一化 |
| 审批 | pending 构造调用，结论原地更新，批准后的工具结果合并；expired 为未执行，审批等待不生成提问卡 |
| 临时文本 | 按 run/turn/attempt 合并，完整消息替换；刷新、重连或终态丢弃尚未保存内容 |
| 计划条 | `planBarMode` 区分 live/proposal/空态，依据当前运行归属与有效计划决定；确认入口与查看清单分开，提交中禁用，承接后显示准备执行。层级、进度与交互见 [设计契约](DESIGN.md#页面与状态契约) |
| 轮次与用量 | 从 turn 与 run 汇总生成本次统计，会话累计另算；可见文本估算与实际 usage 区分，生成速度扣除可用推理量。展示见 [状态表达](DESIGN.md#状态表达与恢复路径) |
| 计划历史 | `planHistory` 按计划身份归并每份最新清单，承接跨运行，无需计划声明不覆盖旧清单；打开时默认最新，打开期间手选保持。查看交互见设计契约 |
| 工作台 | 手选结果或打开文件后固定，回到最新恢复跟随；预览失败显示当前对象错误，旧响应不覆盖当前选择；终端读取失败保留已取得输出 |

审批提交调用 `replyApproval(toolCallId, 'approve' | 'deny')`，提交状态保持至结论到达；接口出错时重取详情。等待审批时输入框引导批准、拒绝或停止，待答复调用不进入工作台。工具策略经配置 API 整表读写。

模型请求原文使用 `loadTurnRequest` 或 `sessionApi.getTurnRequest`，只读重建，不重放工具。用户操作可用性由共用命令状态判断，按计划执行要核对有效计划，不能只检查 run.mode。

对话滚动离开底部一段距离后停止跟随，并显示回到底部的图标按钮。距离以组件实现为准。失败重试的展示关联保存在 WebView 的 localStorage：立即隐藏旧失败提示，不重复显示本次重试的用户消息；刷新和重新进入沿用，原始事件不删除。该关联不跨设备同步，也不追溯修改此前未记录关联的重试。

## 文件与图片查看

输入区可以粘贴图片，图文混合粘贴保留文字；图片只显示缩略图，悬浮或键盘聚焦时显示预览和移除按钮，触屏保留按钮。图片名称与大小放在共用大预览中。文字高度按内容、宽度、字号和视口重新计算，达到上限后内部滚动；Enter 发送，Shift + Enter 换行，兼容 Alt + Enter。独立首页恢复草稿后聚焦一次，会话沿用主动聚焦入口。图片发送固定使用 `image_mode=auto`，不依赖模型目录加载、不显示视觉能力提示；后端按本次实际模型组织像素或文件材料。旧请求与发送恢复仍兼容 `files`，恢复旧草稿后新提交使用自动方式。API/UI 需一起更新。

附件与交付文件共用预览接口和查看器，按资源版本处理分页及异步归属。格式能力见 [产品说明](../../docs/product.md#文件预览)，点击、下载、焦点与缩放交互见 [UI 设计说明](DESIGN.md#文件与图片阅读)，预算见 [运行参数与限额](../../docs/limits.md)。

## 设计与主题

设计原则、视觉语义和交互契约见 [DESIGN.md](DESIGN.md)。取值以 [src/globals.css](src/globals.css) 为准。

浅色画布、侧栏与弱底色统一由 `:root` token 控制；深色 token 独立保留。品牌标记的界面组件是 [brand-mark.tsx](src/components/brand-mark.tsx)，页面图标是 [brand-mark.svg](public/brand-mark.svg)。

主题由 `next-themes`（与框架无关）挂在 [app.tsx](src/app.tsx) 的根组件，`attribute="class"`，默认跟随系统，也可在设置页“外观”分区切换浅色或深色。选择保存在 WebView 本地存储。深色 token 写在 `.dark` 下，不要在组件里再写一套 `dark:` 颜色。

业务界面使用这些 token，例如 `bg-background`、`text-muted-foreground`、`text-state-running`、`bg-signal`。新界面不要写 `gray-*` 或十六进制颜色。计时、轮次、token 和字节数加 `tabular-nums`；命令、路径和代码用 `font-mono`。状态色成对使用文字类与浅底类（`text-state-*` 与 `bg-state-*-soft`）。

## 组件状态目录

开发服务器运行时，在宿主窗口或普通浏览器打开 Vite 地址下的 `/dev/components`，路由在 [app.tsx](src/app.tsx)。页面不连接核心，用 [src/fixtures/](src/fixtures) 里的视图模型夹具逐个列出运行视图和设置列表的状态，供修改组件时回归。生产构建不包含该路由，也不带会话侧栏。

事件夹具中的合成字段见 [w1-sessions.ts](src/fixtures/w1-sessions.ts) 文件头；合成终态如何补写 `summary` 与轮次结束时间写在 [states.ts](src/fixtures/states.ts) 文件头。组件目录用于修改视图时的状态回归。

## 检查与构建

```bash
node scripts/check-model-configuration.cjs
node scripts/check-composer-images.cjs
node scripts/check-skills-settings.cjs
node scripts/check-effort-slider.cjs
node scripts/check-process-block.cjs
node scripts/check-developer-mode.cjs
node scripts/check-workbench-width.cjs
node scripts/check-markdown-preview.cjs
npm run lint
npm run build
```

`build` 先做类型检查，再输出静态产物到 `dist/`，由桌面构建打进应用。构建与 `npx tsc --noEmit` 的类型检查会读取 `../contracts/generated` 中的生成类型，契约过期时先在契约目录运行 `npm run generate`。当前没有覆盖完整交互的自动化测试套件；lint 和构建不验证完整交互。本地事件观察见下节。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

`check-slash-command-menu.cjs` 挂载实际菜单与圆环，使用 DOM 几何替身检查鼠标高亮不滚动、键盘最小滚动、滚轮位置不回拉、静止指针不抢选择、未知态及禁用压缩；`check-composer-images.cjs` 另核对关闭后松键不重开、查询变化可重新打开。长列表的实际滚动、锚定、搜索高度与键盘交互仍需在宿主窗口走查。

图片输入检查使用实际输入组件、剪贴板提取和草稿模块，替换上传、模型目录与基础 UI；覆盖单次提取不重复、混合文字、部分成功、迟到响应归属、缩略图操作入口、不依赖模型目录发送、多图自动提交和旧模式受理核对。高度、聚焦、悬浮样式与系统剪贴板行为需在宿主窗口核对，不能由组件替身推导。


## 事件观察

安装锁定依赖后，可直接运行本地观察脚本，无需启动开发服务器或宿主。命令脚本检查共用可用性；发送脚本用实际的 `ApiError` 构造模拟响应丢失、网关失败与核心明确拒绝，检查受理读回；工作台脚本通过实际共享查看器检查乱序响应、取消、分段读取版本、换源重置与读取失败，传输、宿主能力及基础 UI 元素为替身，不能替代宿主窗口中的布局和真实核心验收。React renderer 会输出既有弃用提示：

```bash
node scripts/check-event-observability.cjs
node scripts/check-plan-progress.cjs
node scripts/check-chat-progress.cjs
node scripts/check-slash-trigger.cjs
node scripts/check-command-state.cjs
node scripts/check-slash-command-menu.cjs
node scripts/check-send-recovery.cjs
node scripts/check-workbench-recovery.cjs
```

脚本用项目 TypeScript 转译器加载实际的 SSE 解析与 `projectSession`，不复制实现，也不连接产品服务。它检查 LF 逐字节分块（含中文 UTF-8）、非法 JSON 回调、SSE `id` 保留、重连等待上限、按 seq 去重与补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity、轮次用时与用量、计划的 `changed`，以及停止、重启中断和请求上限的可读原因。增量检查覆盖增量按 `(run_id, turn, attempt)` 累积且不进入带序号的事件列表、同一 attempt 的助手消息替换临时条目、更大 attempt 或另一轮丢弃旧条目、轮次结束或运行终态后没有临时条目，以及没有 usage 时速度标为估算、有 usage 时按公式计算并扣除推理 token。审批检查覆盖只有审批事件时从事件构造调用条目且不生成提问条目、批准后 pending 与结论合并为一条并写回执行结果、拒绝为 denied（`denied_by=user`）、策略禁止在工具组里为 denied 且没有审批条目，以及停止或 API 重启后审批为 expired、调用为未执行。另将两个当前限制明确打印为 `LIMITATION`：EOF 分派未以空行结束的完整 JSON 尾段，以及 CRLF 恰在 CR/LF 之间分块时丢失事件类型。脚本退出成功表示上述行为与限制得到复现，不表示 SSE 标准符合性、hook 挂载或真实断线恢复已通过。

计划展示检查加载实际投影与组件，用合成事件检查当前步骤与完成数量、稳定身份的改名和重排、计划重置、有效清单与关闭时不挂载弹层、计划条仅在本次运行有计划或计划模式待确认时出现（上一次清单、新运行未写计划、普通运行结束后均不出现）及主动停止的单处表达；历史检查覆盖跨运行归并、无需计划归属隔离、只保留最新清单、多份切换、单份无导航和空态提示；结构化计划检查覆盖 stage/step 关系、稳定顶层分母、schedule 后续标注、缺失成果的部分交付及弹框清单；展示只保留简短标题、描述、任务项和状态，完整目标、范围、解释与成果记录不占用清单，子项不重复计数；不连接模型或产品服务。

类型检查没有单独的 npm script，在本目录执行 `npx tsc --noEmit`。lint 与生产构建见上一节。

`check-model-configuration.cjs` 覆盖模型与思考选择的恢复、发送传递、会话隔离、字段缺失、迟到详情、同源偏好变化、目录回退和存储失败。选择与草稿契约见 [UI 设计](DESIGN.md#草稿弹层与视图连续性)；脚本不代替真实刷新与多标签操作。

## skill 输入与设置

设置的 skill 分区独立于开发者模式，切换分区保留未保存正文和导入操作；关闭仍使用统一未保存提示。导入响应未知时沿原操作查询，结果未知时同一输入重试沿用操作身份，明确失败或过期后重新获取。内置 skill 仅可查看和启停。

输入框把所选 skill 显示为正文开头的整段名称，`/技能名 任务`、草稿和受理读回携带 skill ID 与版本；`check-composer-images.cjs` 同时核对快捷输入、无正文保留草稿、选择恢复和相同正文不同 skill 的受理隔离。`check-skills-settings.cjs` 使用实际 skill 设置组件，替换网络、弹层宿主与 Markdown 渲染，覆盖只读边界、包文件阅读与迟到响应隔离、草稿排版与保留、关闭保护、安装重试及详情收尾、直接编写、本地文件分类与选入后自动打开，以及无正文 DELETE 请求头。Markdown 实际渲染、名称选中与预览、菜单的键盘跟随与鼠标独立滚动、来源切换动画、叠层焦点、窄屏布局、社区导航及文件夹、ZIP 与 Markdown 选择需在宿主窗口核对。
