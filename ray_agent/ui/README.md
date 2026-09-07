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
| 事件归一化、时间线和计划转换 | [session-events.ts](src/lib/session-events.ts) |
| 会话详情与实时订阅 | [use-session-detail.ts](src/hooks/use-session-detail.ts) |
| 共享会话状态 | [src/providers/](src/providers/) |
| 交互与结果展示 | [src/components/](src/components/) |

组件消费 hooks 和 providers 提供的状态。事件契约变化时，同时核对后端映射、前端类型和归一化逻辑，避免只调整展示组件。

## 检查与构建

```bash
npm run lint
npm run build
npm run start
```

`start` 需要已有构建产物。当前没有独立测试脚本；lint 和构建不验证完整交互。涉及事件的修改还需检查实时消息、历史详情、计划更新与工具结果展示。

容器使用多阶段构建并输出 standalone 应用。整体启动及日志检查统一见 [运行指南](../README.md)。
