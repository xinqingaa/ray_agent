# 客户端与分发

本专题处于方案讨论，授权边界见[升级计划](README.md#授权与实施状态)。桌面为主、移动为辅、尽量共用前端是需求；Tauri 是当前首选建议，尚未实施迁移。

## 目标与当前基础

桌面安装后可直接进入本机工作区；移动端如实施，复用相同的会话、笔记、文件阅读和控制界面，按平台提供适合的入口。

当前前端为 Next.js、React、TypeScript、Tailwind 和 Radix，业务经 HTTP／SSE 访问 Python API。已有宽窄屏布局可以复用设计与组件，不能据此断言软键盘、系统返回、文件选择、窗口关闭及后台恢复已经适配原生客户端。实现定位见[前端代码地图](../code-map.md#前端)。

## 路线选择

| 路线 | 可复用内容 | 主要代价 |
|---|---|---|
| Tauri 桌面与移动 | 现有 Web 组件、样式、事件投影与业务逻辑 | 系统 WebView 差异、Rust 桥接和平台插件适配 |
| Electron＋React Native | 桌面保留现有界面；移动共享纯 TypeScript 逻辑与接口契约 | RN 重做 DOM、组件、样式和平台行为，维护两套界面 |

建议优先采用 Tauri；若移动端需求最终需要大量原生交互，再比较 RN 的独立实现成本。Flutter 已退出本轮选型，不恢复为待办。

## 建议设计

- **共享界面**：保留 React、TypeScript、Tailwind、Radix 和现有 Markdown、预览与事件投影，调整为 Vite＋客户端路由，静态资源随应用发布。
- **平台适配**：统一封装文件选择与保存、外部链接、窗口、通知、生命周期和核心连接，组件按能力调用，避免散落平台判断。
- **桌面外壳**：Tauri 管理窗口、托盘、凭据的系统级保存、更新及本机核心；核心进程职责见[本机核心](local-runtime-and-storage.md)。
- **移动外壳**：建议只连接已配对的桌面核心，处理文件导入、分享、返回、软键盘和恢复连接；不默认在手机运行 Python 或复制桌面数据库。
- **构建与更新**：同一代码库按系统与架构分别构建、签名和发布，区分桌面更新与移动平台分发；保留 API／UI 构建身份和协议兼容判断。

Vite 是减少客户端运行依赖的建议，不要求重写现有页面。现有 Next 路由与 `standalone` 产物需调整；若保留 Next，则另行解决静态动态路由或额外服务进程，不直接将服务端产物当作静态资源打包。

桌面与移动共用界面不意味着功能完全相同。桌面文件夹、Shell、托盘和进程管理按能力开放；手机上的文件与桌面文件身份分别表达，远端目录选择不能冒充手机本地目录。

## 两个代表页面的迁移范围

| 页面 | 保留 | 需要适配 |
|---|---|---|
| 项目说明／笔记 | Markdown、版本冲突、草稿、历史取回及保存语义 | 窗口关闭、导航返回、移动键盘与焦点 |
| 会话详情与工作台 | 事件投影、流式消息、审批、计划、工具记录和预览 | SSE 生命周期、后台恢复、下载、外链、文件能力与窗口布局 |

这两页用于明确迁移范围；用户尚未授权 demo。后续如需原型，单独明确目标，不以另建工作区／RAG 样本为前置步骤。

## 责任与依赖

UI 负责共享页面与平台适配接口；原生外壳负责窗口、系统权限和核心进程宿主；核心提供稳定的 HTTP／SSE 契约及能力声明。前端不直接写业务数据库，也不维护第二套运行状态。

依赖[工作区身份](workspaces-and-memory.md)、[本机通信与生命周期](local-runtime-and-storage.md)及[文件／执行能力](files-and-execution.md)。旧 Web 入口是否继续发布，需明确后再安排目录结构和构建目标。

## 完成条件

- 已约定桌面平台安装后可启动核心、进入工作区，并验证两个代表页面的完整行为。
- 核心不可用、协议不兼容、更新失败和窗口退出有可理解的反馈，草稿与持久记录不丢失。
- 移动端如获授权，同一共享前端可构建目标应用，真实检查键盘、返回、文件、预览和断线恢复。
- 页面中的生成 HTML／外部内容与本机特权桥接保持隔离，不因桌面封装扩大其权限。

## 待讨论

Tauri 定案、首批系统与架构、移动功能范围、旧 Web 支持、窗口与托盘退出语义、签名与更新渠道，以及是否需要离线阅读缓存。

## 选型依据

[Tauri 官方移动支持](https://v2.tauri.app/blog/tauri-20/#mobile-support)明确一套 UI 可覆盖桌面、Android 和 iOS；[sidecar 文档](https://v2.tauri.app/develop/sidecar/)支持随包发布 Python 程序。[Next.js 集成](https://v2.tauri.app/start/frontend/nextjs/)走静态导出，现有工程需要适配。

[AgentChat 的原生入口](https://github.com/Zorahm/AgentChat/blob/master/src-tauri/src/lib.rs)区分桌面 Python 核心与移动客户端，[Android 构建流程](https://github.com/Zorahm/AgentChat/blob/master/.github/workflows/build-android.yml)复用同一前端产物。[HuLa 原生入口](https://github.com/HuLaSpark/HuLa/blob/master/src-tauri/src/lib.rs)包含桌面／移动分支和 iOS 键盘处理。这些是源码与构建依据，未在本项目运行，不代表全部移动目标已有稳定发布。

[Shell 插件](https://v2.tauri.app/plugin/shell/#supported-platforms)在移动端不提供桌面式子进程能力；[文件对话框](https://v2.tauri.app/plugin/dialog/#supported-platforms)的移动端没有文件夹选择支持，相关需求需适配或扩展。
