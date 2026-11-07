# 已确认的计划范围

本页保留已由用户确认、仍约束后续阶段的产品与交付选择。首个交付已完成，进度见[实施状态](implementation.md#实施状态)。

| 标识 | 范围 | 已确认方案 |
|---|---|---|
| D1 | 首个交付平台 | 已完成 macOS Apple Silicon 内部包闭环；Developer ID、公证与自动更新属 P10；Windows x64 属 P11 |
| D2 | 移动端 | 不含在首个交付；P10 后先 Android 再 iOS，共用共享前端 |
| D3 | 原 Web／服务端部署 | 已移除独立 Web 与 Compose 部署；不提供本机浏览器应用入口；不迁移旧部署数据 |
| D4 | 自动记忆强度 | 明确要求直接保存；自动提炼可直接替代未确认的自动条目；涉及用户条目时进候选 |
| D5 | 本机执行权限 | 文件工具随工作区；Shell／脚本按工作区启用；不宣称强隔离 |
| D6 | 安装与离线组件 | 基础包含核心与基础运行时；Chromium／Embedding／OCR 按需下载；离线包随 P10 |
| D7 | 工作区形态 | 一区一文件夹；工作方式＋记忆＋会话＋文件夹；不设笔记与独立说明页 |
| D8 | 文件夹标记 | `.rayagent/workspace.json` 只含安装身份与工作区 ID |
| D9 | 执行与存储边界 | 不提供 Docker／远程执行产品流程；COS 不进桌面运行时 |

技术基线：Tauri、React／Vite、Python sidecar、SQLite、LanceDB Embedded。细节见正文，不在计划重复。
