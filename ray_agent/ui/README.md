# RayAgent UI 开发指南

前端使用 Next.js、React、TypeScript、Tailwind CSS、Radix UI 和 noVNC。它消费 API 数据与事件，展示会话、计划、工具结果和沙箱画面。

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

`useSessionDetail` 在原有的会话、文件、事件和 `sendMessage` 之外，返回投影结果 `view`、提交中的 `submitting`（与 `streaming` 相同）、`stop` 和 `loadTurnRequest`。某一轮发给模型的请求也可以用 `sessionApi.getTurnRequest`。字段约定见 [W4 子计划](../../docs/plan/w4-ui-data.md#视图模型契约)。

会话页只渲染 `view`：状态条、时间线、计划条和上下文环都读这份投影。停止调用 `stop()`。运行中输入框仍可发送，内容作为补充要求；等待回复时占位符说明回复会继续当前任务。工作台默认跟随最新工具，点开某次调用后固定，直到「回到最新」。终端在该次 Shell 调用仍为运行中时，按约 1.5 秒调用 `sessionApi.viewShell`。开发者视图用 `loadTurnRequest` 显示某一轮重建出的请求。组件状态目录在接入后保留。

## 设计与主题

设计方案、颜色、字体、间距、圆角和组件状态清单见 [DESIGN.md](DESIGN.md)。取值以 [src/app/globals.css](src/app/globals.css) 为准。

主题由 `next-themes` 挂在根布局，`attribute="class"`，默认跟随系统，也可在侧栏切换浅色或深色。选择保存在浏览器本地。深色 token 写在 `.dark` 下，不要在组件里再写一套 `dark:` 颜色。

业务界面使用这些 token，例如 `bg-background`、`text-muted-foreground`、`text-state-running`、`bg-signal`。新界面不要写 `gray-*` 或十六进制颜色。计时、轮次、token 和字节数加 `tabular-nums`；命令、路径和代码用 `font-mono`。状态色成对使用文字类与浅底类（`text-state-*` 与 `bg-state-*-soft`）。

## 组件状态目录

开发模式下打开 [http://localhost:3000/dev/components](http://localhost:3000/dev/components)，路由在 [src/app/dev/components/page.tsx](src/app/dev/components/page.tsx)。页面用 [src/fixtures/](src/fixtures/) 里的视图模型夹具，逐个列出运行视图和设置列表的状态，供修改组件时回归。生产构建中该路由返回 404，不带会话侧栏。

夹具里按 W3 契约补写的字段写在 [w1-sessions.ts](src/fixtures/w1-sessions.ts) 文件头；合成终态如何补写 `summary` 与轮次结束时间写在 [states.ts](src/fixtures/states.ts) 文件头。目录页在会话页接入这些组件后保留，供以后改组件时回归。

## 检查与构建

```bash
npm run lint
npm run build
npm run start
```

`start` 需要已有构建产物。当前没有覆盖完整交互的自动化测试套件；lint 和构建不验证完整交互。本地事件观察见下节。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

容器使用多阶段构建并输出 standalone 应用。整体启动见 [运行指南](../README.md)，启停与日志见 [Docker 操作说明](../DOCKER.md)。


## 事件观察

安装锁定依赖后，可直接运行本地观察脚本，无需启动 Next.js：

```bash
node scripts/check-event-observability.cjs
```

脚本用项目 TypeScript 转译器加载实际的 SSE 解析与 `projectSession`，不复制实现，也不连接产品服务。它检查 LF 逐字节分块（含中文 UTF-8）、非法 JSON 回调、SSE `id` 保留、重连等待上限、按 seq 去重与补齐、calling/called 合并、一轮多个调用成组、失败轮次保留、activity、轮次用时与用量、计划的 `changed`，以及停止、重启中断和请求上限的可读原因。另将两个当前限制明确打印为 `LIMITATION`：EOF 分派未以空行结束的完整 JSON 尾段，以及 CRLF 恰在 CR/LF 之间分块时丢失事件类型。脚本退出成功表示上述行为与限制得到复现，不表示 SSE 标准符合性、hook 挂载或浏览器断线恢复已通过。

类型检查没有单独的 npm script，在本目录执行 `npx tsc --noEmit`。lint 与生产构建见上一节。
