# 客户端与分发

本专题采用已确认的 Tauri 基线，按计划实施中，进度见[实施状态](implementation.md#实施状态)。首个交付平台、后续阶段、移动顺序、Web 移除及资源包范围见[决策 D1、D2、D3、D6](decisions.md)。

## 目标与当前基础

桌面安装后可直接打开本地文件夹作为工作区。首个交付是 macOS Apple Silicon 内部包；Mac 正式发布、Windows 与移动端是后续阶段。辅助移动端复用相同的会话、记忆、文件阅读和控制界面，在 Mac 正式发布后先交付 Android，再交付 iOS。

当前前端为 Next.js、React、TypeScript、Tailwind 和 Radix，业务经 HTTP／SSE 访问 Python API。已有宽窄屏布局可以复用设计与组件，不能据此断言软键盘、系统返回、文件选择、窗口关闭及后台恢复已经适配原生客户端。实现定位见[前端代码地图](../code-map.md#前端)。

## 客户端路线

采用 Tauri 桌面与移动客户端，复用现有 React 组件、样式、事件投影和业务逻辑，按平台处理系统 WebView、文件和生命周期差异。不建设独立 Web 产品，也不并行建设 RN／Flutter 客户端。

## 设计

- **共享界面**：保留 React、TypeScript、Tailwind、Radix 和现有 Markdown、预览与事件投影，调整为 Vite＋客户端路由，静态资源随应用发布。
- **平台适配**：统一封装文件夹与文件选择、保存、外部链接、窗口、通知、生命周期和核心连接，组件按能力调用，避免散落平台判断。
- **桌面外壳**：Tauri 管理窗口、托盘、凭据的系统级保存、更新及本机核心；核心进程职责见[本机核心](local-runtime-and-storage.md)。
- **移动外壳**：只连接已配对的桌面核心，处理文件导入、分享、返回、软键盘和恢复连接；不在手机运行 Python 或复制桌面数据库。
- **构建与更新**：同一代码库按系统与架构分别构建；首个交付只构建 macOS Apple Silicon 内部包，签名、公证与更新随 Mac 正式发布，Windows 与移动构建随各自阶段。保留 API／UI 构建身份和协议兼容判断。

采用 Vite 减少客户端运行依赖，不重写现有页面。迁移 Next 路由与 `standalone` 产物，不额外带一个 Next 服务进程。

桌面与移动共用界面不意味着功能完全相同。桌面文件夹、Shell、托盘和进程管理按能力开放；手机上的文件与桌面文件身份分别表达，远端目录选择不能冒充手机本地目录。

## 工程布局

保留 `ray_agent/ui` 作为共享 React 工程，保留 `ray_agent/api` 作为 Python 核心，`ray_agent/desktop` 管理 Tauri／Rust 原生宿主及移动目标，`ray_agent/contracts` 保存生成类型与协议校验输入。`ray_agent/desktop` 由 M0 宿主探针建立，其指南已登记到根工作指南的任务表，P2 接入共享界面时扩展为桌面开发指南；`ray_agent/contracts` 保存由核心 Pydantic 契约生成的 OpenAPI、JSON Schema、样例与 TypeScript 类型，[契约指南](../../ray_agent/contracts/README.md)同样已登记。

前端迁移只替换 Next 的路由、入口、环境和构建耦合。保留消息投影、草稿、Markdown、组件和样式；项目入口改为工作区入口，项目说明与笔记页面不再保留。所有 API、SSE、上传、预览和下载统一进入 CoreClient，移除散落的固定服务地址。开发服务器不能成为正式包的依赖。

平台层提供 `selectFolder`、`pickFiles`、`saveResource`、`openExternal`、`requestClose`、`connectCore` 等受限方法。可信主界面可以使用原生桥；生成 HTML 和外部网页在无桥接的隔离预览或系统浏览器中打开，不共享实例令牌或特权会话。接口身份与权限见[共享契约](shared-contracts.md)。

## 两个代表页面的迁移范围

| 页面 | 保留 | 需要适配 |
|---|---|---|
| 会话工作台 | 事件投影、流式消息、审批、计划、工具记录和预览 | SSE 生命周期、后台恢复、下载、外链、“本次参考”、窗口布局 |
| 工作区文件夹与记忆面板 | 现有文件列表、预览组件与版本冲突处理 | 原位文件树、索引状态、外部变更提示、撤销本次修改、记忆提示与面板 |

这两页用于明确迁移范围，不额外建立 demo。实施直接迁移真实页面并检查对应行为，不以另建工作区／RAG 样本为前置步骤。

## 用户流程与状态

首次打开先完成核心握手和存储检查，再配置模型连接：沿用代码中的模型目录，为端点填写地址与密钥，密钥写入钥匙串，规则见[本机核心](local-runtime-and-storage.md#核心启动与终止)。然后打开或新建工作区文件夹，也可以直接进入独立对话。缺失浏览器、Embedding 或 OCR 时只影响对应能力，显示安装、取消和重试，离线导入随 P10 提供；不以初始化转圈阻断全部客户端。

首页列出工作区与独立对话入口。工作区内提供会话、文件夹、记忆与设置入口，设置中编辑工作方式、自动记忆、本机执行与索引范围，界面组成见[工作区专题](workspaces-and-memory.md#界面与用户操作)。索引、组件和清理使用统一操作状态；模型回复、任务受理、工具执行和后台整理分别显示。沿用现有专业工具视觉与[UI 设计契约](../../ray_agent/ui/DESIGN.md)，不在本轮重做视觉系统。

CoreClient 根据平台选择桌面回环传输或移动原生传输，解析同一事件协议，不再提供独立 Web 同源传输。进入后台或失去连接时保留业务请求身份、草稿和最后序号，恢复后先读详情再补事件、清空临时文本增量；不自动重发发送、审批或恢复动作。

关闭窗口默认隐藏到托盘，真正退出在有活动任务或脏草稿时展示具体影响；核心停止新受理，取消或结束任务并确认写入者收尾，再退出。没有托盘的平台提供等价后台行为说明。系统休眠后恢复先核对核心与资源身份。

## 打包、组件与更新

采用 PyInstaller onedir 作为核心产物，Tauri 将入口和依赖目录按清单一同分发，不能只带入口文件。冻结进程的 worker 使用同一可执行文件的明确子命令，不沿用 `sys.executable -m` 假设系统 Python；启动早期处理冻结进程的多进程入口。外部 Node／Shell 运行时清理冻结环境的动态库变量，避免加载核心私有库。M0 宿主探针用现有依赖集检验了这些约束，实际结果与留给后续工作包的处理见[宿主探针结论](implementation.md#宿主探针结论)。

基础包提供冻结核心、正常 CPython 工具解释器和 Node 运行时；工具解释器与核心依赖隔离，解析 worker 使用核心的明确子命令。Node 支持内置 JS 脚本及依赖它的 MCP，不要求用户安装 Node。浏览器与本地模型按 D6 分发，由随包发布的资源清单锁定版本与哈希；组件安装状态必须经哈希和实际可启动检查确认。第三方 Skill 的任意 Python／npm 依赖不视为基础包已包含，安装是独立授权动作，不在主环境里自动执行包管理器。

首个交付在 Apple Silicon 上构建 Python 原生依赖与 Tauri 产物，生成只做本机 ad-hoc 签名的内部包：它未经 Developer ID 签名与公证，在其他 Mac 上首次打开需要用户在系统设置中手动允许，只用于内部使用，不报告为公开分发。构建产物包含 UI／核心身份、协议、schema 兼容范围、组件清单和许可证。

首个交付不提供自动更新，内部包由用户手动覆盖安装，升级保留数据的规则见[实施计划](implementation.md#备份与应用升级)。P10 改用直接下载的签名、公证 DMG 与已签名的应用更新源，不走 Mac App Store；P11 再分别构建 Windows 原生依赖与签名安装程序。证书与发布凭据在正式发布前提供，不写入仓库。

## 移动端与 Web 移除边界

移动端采用同一共享前端和 Tauri 工程的移动构建，不打包桌面 sidecar。首批辅助行为为配对、阅读、发送材料与消息、回复提问、审批、停止和查看交付；不开放手机端任意桌面路径输入、凭据管理或执行策略扩权。配对设备只操作被授权的工作区。

局域网连接、TLS 身份固定及设备令牌由[共享契约](shared-contracts.md#本机与移动访问)规定。手机进入后台不继续依赖 SSE 存活，也不默认引入云推送；恢复前台后补读。首批只持久化草稿与配对配置，不默认缓存完整私有文档；若需要离线资料库另作范围决定。

移除 Next 服务与 `standalone` 产物、UI／API 镜像及原 UI／API／Nginx Compose 服务交付，也不提供本机浏览器访问入口。核心只为桌面和已配对移动端提供业务接口，不托管可从浏览器打开使用的 RayAgent 应用。

保留 Vite 开发服务器和 Tauri 打包所需的静态界面构建，不将其作为单独网站发布；保留自动化浏览器、外链、成果 HTML 预览和 API／SSE。迁移旧前端时复用组件，不删除整个共享 UI 工程。

## 责任与依赖

UI 负责共享页面与平台适配接口；原生外壳负责窗口、系统权限和核心进程宿主；核心提供稳定的 HTTP／SSE 契约及能力声明。前端不直接写业务数据库，也不维护第二套运行状态。

依赖[工作区身份](workspaces-and-memory.md)、[本机通信与生命周期](local-runtime-and-storage.md)及[文件／执行能力](files-and-execution.md)。独立 Web 与原服务部署按 D3 移除，不再维护两套产品交付。

## 实施任务

M0 验证了 Tauri 宿主与冻结核心，P0 建立了生成类型链路与平台端口接口；P2 完成前端、Tauri 与 sidecar 的真实产品启动链路；P3、P5、P6 分别接入文件夹、记忆与检索界面；P9 产出 Mac 内部包并完成首个交付检查。后续 P10 完成 Mac 签名、公证与更新，P11 完成 Windows 构建与签名安装，P12 按 D2 交付移动端。具体依赖见[实施工作包](implementation.md#工作包与依赖)。

除原有完成条件外，还需检查未装开发环境的机器、不兼容核心、崩溃后重连、输入法组合输入、PDF 与 HTML 预览、长列表滚动、下载与分享、脏草稿和桌面退出。首个交付在 Mac 内部包上执行，后续平台各自重复，不从浏览器开发模式结果推断原生包通过。

## 完成条件

- Mac 内部包安装后可启动核心、打开工作区文件夹，并验证两个代表页面的完整行为。
- 核心不可用、协议不兼容、内部包升级和窗口退出有可理解的反馈，草稿与持久记录不丢失。
- Next 服务、独立 Web 发布目标、原部署编排及过时指南已清理，共享组件与 Tauri 静态资源构建正常。
- 页面中的生成 HTML 与外部内容与本机特权桥接保持隔离，不因桌面封装扩大其权限。
- 后续阶段：P10 的签名公证包与签名更新经真实发布检查；P12 的同一共享前端依次构建 Android、iOS 辅助端，真实检查键盘、返回、文件、预览和断线恢复。

## 选型依据

[Tauri 官方移动支持](https://v2.tauri.app/blog/tauri-20/#mobile-support)明确一套 UI 可覆盖桌面、Android 和 iOS；[sidecar 文档](https://v2.tauri.app/develop/sidecar/)支持随包发布 Python 程序。[Next.js 集成](https://v2.tauri.app/start/frontend/nextjs/)走静态导出，现有工程需要适配。

[AgentChat 的原生入口](https://github.com/Zorahm/AgentChat/blob/master/src-tauri/src/lib.rs)区分桌面 Python 核心与移动客户端，[Android 构建流程](https://github.com/Zorahm/AgentChat/blob/master/.github/workflows/build-android.yml)复用同一前端产物。[HuLa 原生入口](https://github.com/HuLaSpark/HuLa/blob/master/src-tauri/src/lib.rs)包含桌面／移动分支和 iOS 键盘处理。这些是源码与构建依据，未在本项目运行，不代表全部移动目标已有稳定发布。

[Shell 插件](https://v2.tauri.app/plugin/shell/#supported-platforms)在移动端不提供桌面式子进程能力；[文件对话框](https://v2.tauri.app/plugin/dialog/#supported-platforms)的移动端没有文件夹选择支持，相关需求需适配或扩展。

[PyInstaller 使用说明](https://pyinstaller.org/en/latest/usage.html)和[冻结进程注意事项](https://pyinstaller.org/en/stable/common-issues-and-pitfalls.html)说明依赖布局、多进程和外部进程环境需要专门处理；[Tauri Mac 签名说明](https://v2.tauri.app/distribute/sign/macos/)作为正式分发依据。依赖版本在实施时锁定，不将当前在线文档版本直接当成项目已验证版本。
