# RayAgent UI 开发指南

前端使用 Next.js、React、TypeScript、Tailwind CSS 和 Radix UI，消费 API 数据与事件。用户流程见[产品说明](../../docs/product.md)，设计规则见 [DESIGN.md](DESIGN.md)，整体数据与资源归属见[架构说明](../../docs/architecture.md)。完整部署见[运行指南](../README.md)。本指南维护开发、数据契约及检查入口，命令仅提供运行入口，不表示已经通过。

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

项目导航、草稿和返回路径遵循 [UI 设计说明](DESIGN.md#项目入口与任务查看)。普通列表用显示路径阅读，实际请求使用原路径，不能用省略系统目录后的展示名称发起读取。

## 代码导航

| 职责 | 入口 |
|---|---|
| 页面与路由 | [src/app/](src/app) |
| HTTP、流式请求和类型 | [src/lib/api/](src/lib/api) |
| 会话视图模型 | [session-view.ts](src/lib/session-view.ts) |
| 事件投影 | [session-projection.ts](src/lib/session-projection.ts) |
| 事件归一化 | [session-events.ts](src/lib/session-events.ts) |
| 会话详情与实时订阅 | [use-session-detail.ts](src/hooks/use-session-detail.ts) |
| 共享会话状态 | [src/providers/](src/providers) |
| 交互与结果展示 | [src/components/](src/components) |

开发者模式通过统一 hook 与区域可见性工厂控制，默认关闭、浏览器存储、同源标签页同步。后续显隐微调集中修改区域策略；入口见[代码地图](../../docs/code-map.md)。模式切换不修改配置、工具权限或事件订阅；关闭/隐藏终端停止轮询，隐藏设置保留草稿及原值。会话的“聊天／日志”与侧栏的“对话／项目”复用分段控件并横向翻页，减少动态效果时关闭过渡；日志模式隐藏输入区但保留输入组件，切回聊天恢复草稿。

组件消费 hooks 和 providers 提供的状态。事件契约变化时，同时核对后端映射、前端类型和归一化逻辑，避免只调整展示组件。确认计划按钮附带来源运行、计划 ID、计划事件序号和持久请求标识；响应丢失后的重试沿用草稿里的原标识。

进入会话先取详情里的全部运行与事件，记下最大序号，再保持一条 `GET /sessions/{id}/events?after_seq=`。SSE 的 `id` 即序号。断开后按最后收到的序号重连，等待从较短间隔翻倍，直到上限。间隔见[运行参数与限额](../../docs/limits.md)。发送消息只调用 `POST /sessions/{id}/chat`，返回 `run_id`、`seq` 与 `route`（`started`、`resumed` 或 `injected`），不再为发送单独开流。

侧栏列表走 `POST /sessions/stream?independent=true`。可见标签共用这一条连接；服务端在目录有写入时重读一页，内容没变不推送，没有通知时按较长间隔兜底。项目列表、展开项目里的对话、项目文件和记忆跟随同一条目录通知，页面重新可见时再核对一次。压缩进行中才定期读会话详情里的临时状态，结束后停止。终端仍只在命令运行中定期读取。间隔见[运行参数与限额](../../docs/limits.md)。

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
| 文件上传 | XHR 给出字节进度，发布数量单独确认；扫描中或服务器落盘不可测阶段不伪造百分比 |
| 项目记忆 | 说明/笔记版本与摘要代次分别处理；冲突保存草稿并取最新值，历史取回用于编辑 |

审批提交调用 `replyApproval(toolCallId, 'approve' | 'deny')`，提交状态保持至结论到达；接口出错时重取详情。等待审批时输入框引导批准、拒绝或停止，待答复调用不进入工作台。工具策略经配置 API 整表读写。

模型请求原文使用 `loadTurnRequest` 或 `sessionApi.getTurnRequest`，只读重建，不重放工具。用户操作可用性由共用命令状态判断，按计划执行要核对有效计划，不能只检查 run.mode。

对话滚动离开底部一段距离后停止跟随，并显示回到底部的图标按钮。距离以组件实现为准。失败重试的展示关联保存在当前浏览器 localStorage：立即隐藏旧失败提示，不重复显示本次重试的用户消息；刷新和重新进入沿用，原始事件不删除。该关联不跨浏览器同步，也不追溯修改此前未记录关联的重试。

## 文件与图片查看

输入区可以粘贴图片，图文混合粘贴保留文字；图片只显示缩略图，悬浮或键盘聚焦时显示预览和移除按钮，触屏保留按钮。图片名称与大小放在共用大预览中。文字高度按内容、宽度、字号和视口重新计算，达到上限后内部滚动；Enter 发送，Shift + Enter 换行，兼容 Alt + Enter。独立首页恢复草稿后聚焦一次，项目和会话沿用主动聚焦入口。图片发送固定使用 `image_mode=auto`，不依赖模型目录加载、不显示视觉能力提示；后端按本次实际模型组织像素或文件材料。旧请求与发送恢复仍兼容 `files`，恢复旧草稿后新提交使用自动方式。API/UI 需一起更新。

附件与项目文件共用预览接口和查看器，按资源版本处理分页及异步归属。格式能力见 [产品说明](../../docs/product.md#文件预览)，点击、下载、焦点与缩放交互见 [UI 设计说明](DESIGN.md#文件与图片阅读)，预算见 [运行参数与限额](../../docs/limits.md)。

## 设计与主题

设计原则、视觉语义和交互契约见 [DESIGN.md](DESIGN.md)。取值以 [src/app/globals.css](src/app/globals.css) 为准。

浅色画布、侧栏与弱底色统一由 `:root` token 控制；深色 token 独立保留。品牌标记的界面组件是 [brand-mark.tsx](src/components/brand-mark.tsx)，浏览器图标是 [brand-mark.svg](public/brand-mark.svg)。

主题由 `next-themes` 挂在根布局，`attribute="class"`，默认跟随系统，也可在设置页“外观”分区切换浅色或深色。选择保存在浏览器本地。深色 token 写在 `.dark` 下，不要在组件里再写一套 `dark:` 颜色。

业务界面使用这些 token，例如 `bg-background`、`text-muted-foreground`、`text-state-running`、`bg-signal`。新界面不要写 `gray-*` 或十六进制颜色。计时、轮次、token 和字节数加 `tabular-nums`；命令、路径和代码用 `font-mono`。状态色成对使用文字类与浅底类（`text-state-*` 与 `bg-state-*-soft`）。

## 组件状态目录

开发模式下打开 [http://localhost:3000/dev/components](http://localhost:3000/dev/components)，路由在 [src/app/dev/components/page.tsx](src/app/dev/components/page.tsx)。页面用 [src/fixtures/](src/fixtures) 里的视图模型夹具，逐个列出运行视图和设置列表的状态，供修改组件时回归。生产构建中该路由返回 404，不带会话侧栏。

历史事件夹具中补写的字段写在 [w1-sessions.ts](src/fixtures/w1-sessions.ts) 文件头；合成终态如何补写 `summary` 与轮次结束时间写在 [states.ts](src/fixtures/states.ts) 文件头。组件目录用于修改视图时的状态回归。

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
npm run start
```

`start` 需要已有构建产物。当前没有覆盖完整交互的自动化测试套件；lint 和构建不验证完整交互。本地事件观察见下节。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

`check-slash-command-menu.cjs` 挂载实际菜单与圆环，使用 DOM 几何替身检查鼠标高亮不滚动、键盘最小滚动、滚轮位置不回拉、静止指针不抢选择、未知态及禁用压缩；`check-composer-images.cjs` 另核对关闭后松键不重开、查询变化可重新打开。长列表的实际滚动、锚定、搜索高度与键盘交互仍需浏览器走查。

图片输入检查使用实际输入组件、剪贴板提取和草稿模块，替换上传、模型目录与基础 UI；覆盖单次提取不重复、混合文字、部分成功、迟到响应归属、缩略图操作入口、不依赖模型目录发送、多图自动提交和旧模式受理核对。高度、聚焦、悬浮样式与系统剪贴板行为需实际浏览器核对，不能由组件替身推导。

容器使用多阶段构建并输出 standalone 应用。整体启动见 [运行指南](../README.md)，启停与日志见 [Docker 操作说明](../DOCKER.md)。


## 事件观察

安装锁定依赖后，可直接运行本地观察脚本，无需启动 Next.js。命令脚本检查共用可用性；发送脚本模拟响应丢失和受理读回；工作台脚本通过实际共享查看器与项目组件检查乱序响应、取消、分段读取版本、项目刷新与读取失败，传输及基础 UI 元素为替身，不能替代浏览器布局和真实服务验收。React renderer 会输出既有弃用提示：

```bash
node scripts/check-event-observability.cjs
node scripts/check-plan-progress.cjs
node scripts/check-chat-progress.cjs
node scripts/check-slash-trigger.cjs
node scripts/check-command-state.cjs
node scripts/check-slash-command-menu.cjs
node scripts/check-send-recovery.cjs
node scripts/check-workbench-recovery.cjs
node scripts/check-project-navigation-recovery.cjs
node scripts/check-project-ui-actions.cjs
node scripts/check-project-upload-tree.cjs
```

脚本用项目 TypeScript 转译器加载实际的 SSE 解析与 `projectSession`，不复制实现，也不连接产品服务。它检查 LF 逐字节分块（含中文 UTF-8）、非法 JSON 回调、SSE `id` 保留、重连等待上限、按 seq 去重与补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity、轮次用时与用量、计划的 `changed`，以及停止、重启中断和请求上限的可读原因。增量检查覆盖增量按 `(run_id, turn, attempt)` 累积且不进入带序号的事件列表、同一 attempt 的助手消息替换临时条目、更大 attempt 或另一轮丢弃旧条目、轮次结束或运行终态后没有临时条目，以及没有 usage 时速度标为估算、有 usage 时按公式计算并扣除推理 token。审批检查覆盖只有审批事件时从事件构造调用条目且不生成提问条目、批准后 pending 与结论合并为一条并写回执行结果、拒绝为 denied（`denied_by=user`）、策略禁止在工具组里为 denied 且没有审批条目，以及停止或 API 重启后审批为 expired、调用为未执行。另将两个当前限制明确打印为 `LIMITATION`：EOF 分派未以空行结束的完整 JSON 尾段，以及 CRLF 恰在 CR/LF 之间分块时丢失事件类型。脚本退出成功表示上述行为与限制得到复现，不表示 SSE 标准符合性、hook 挂载或浏览器断线恢复已通过。

计划展示检查加载实际投影与组件，用合成事件检查当前步骤与完成数量、稳定身份的改名和重排、计划重置、有效清单与关闭时不挂载弹层、计划条仅在本次运行有计划或计划模式待确认时出现（上一次清单、新运行未写计划、普通运行结束后均不出现）及主动停止的单处表达；历史检查覆盖跨运行归并、无需计划归属隔离、只保留最新清单、多份切换、单份无导航和空态提示；结构化计划检查覆盖 stage/step 关系、稳定顶层分母、schedule 后续标注、缺失成果的部分交付及弹框清单；展示只保留简短标题、描述、任务项和状态，完整目标、范围、解释与成果记录不占用清单，子项不重复计数；不连接模型或产品服务。

类型检查没有单独的 npm script，在本目录执行 `npx tsc --noEmit`。lint 与生产构建见上一节。

项目导航恢复脚本通过实际组件检查分页请求过期、首屏之外的当前项目与对话定位、读取失败保留当前对话，以及清单为空但对象回收待重试时的清理入口；请求与基础 UI 为替身，真实数据库和浏览器需另行验证。

导入审核树检查使用实际扫描器与 React 组件、合成文件和规则，核对筛选不改变上传集合、禁止项无确认入口、未知大小与确认后扫描、覆盖和失败状态。组件状态目录增加“项目导入审核树”，多层和长列表数据明确为合成，不替代真实文件选择与上传验收。

项目主页使用对话、文件、说明、笔记、摘要页签，项目对话与独立对话共用 `SessionItem`。文件管理默认平铺系统目录，不暴露系统目录入口；说明与笔记复用既有草稿、版本冲突及历史编辑器。危险操作确认由 `DataCleanupDialog` 统一处理，`DataCleanupNotice` 在弹窗关闭后继续读取进度；清理完成通过同源通知刷新导航并清除目标草稿。组件检查不能替代永久删除的隔离数据库验证。

项目操作检查使用固定占用响应挂载实际数据确认与设置数据分区，验证查看占用时同时退出父层设置与清空确认再导航，离开被拒绝时不导航、不触发清理；不修改真实任务状态。

构建时生成公开 `build-manifest.json`，随 standalone 最终镜像提供；其输入指纹覆盖源文件、public、构建配置、依赖清单和编译使用的公开 API 地址。轻量计划核对不新增清单版本，正常工具活动不触发定时声明；相关检查包含结构化确认读回、沿用请求标识和承接准备、分层展示、收起计数和部分交付显示。

模型与思考强度以版本化的同源 localStorage 偏好成对保存；新对话使用有效最近选择，本地记录读完前不采用目录默认值，已有会话只沿用自身的服务端选择；字段未加载或历史字段缺失时，发送不携带模型与思考参数，由后端沿用会话设置及兼容解析，输入区显示“沿用对话设置”。全局偏好变化不覆盖已有会话，用户仍可在会话内主动切换。仅浏览历史不覆盖偏好，菜单保存失败不记忆，发送成功才更新实际使用的选择；存储不可用时保留标签页内存。`check-model-configuration.cjs` 覆盖恢复值传入发送选择、会话隔离、字段缺失与迟到详情、同源偏好变化、会话切换、失效目录回退和存储失败，不代替真实刷新与多标签操作。

## skill 输入与设置

设置的 skill 分区独立于开发者模式，切换分区保留未保存正文和导入操作；关闭仍使用统一未保存提示。导入响应未知时沿原操作查询，结果未知时同一输入重试沿用操作身份，明确失败或过期后重新获取。内置 skill 仅可查看和启停。

输入框把所选 skill 显示为正文开头的整段名称，`/skill 名 任务`、草稿和受理读回携带 skill ID 与版本；`check-composer-images.cjs` 同时核对快捷输入、无正文保留草稿、选择恢复和相同正文不同 skill 的受理隔离。`check-skills-settings.cjs` 使用实际 skill 设置组件，替换网络、弹层宿主与 Markdown 渲染，覆盖只读边界、包文件阅读与迟到响应隔离、草稿排版与保留、关闭保护、安装重试及详情收尾、直接编写、本地文件分类与选入后自动打开，以及无正文 DELETE 请求头。Markdown 实际渲染、名称选中与预览、菜单的键盘跟随与鼠标独立滚动、来源切换动画、叠层焦点、窄屏布局、社区导航及文件夹、ZIP 与 Markdown 选择需在真实浏览器核对。
