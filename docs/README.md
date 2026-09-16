# 文档地图

本目录按"回答什么问题"分层。每份文档只维护一件事，其他文档遇到同一话题只保留一句概述并链接过来。

## 分层

| 层 | 文档 | 唯一维护的内容 | 什么时候更新 |
|---|---|---|---|
| 概念 | [Harness 工程](harness.md) | 职责如何分层、每层解决什么问题、为此付出什么代价 | 职责划分或设计取舍发生变化 |
| 系统 | [架构说明](architecture.md) | 模块边界、执行路径、状态归属、控制参数 | 模块职责、主要路径、状态所有权或跨服务通信方式变化 |
| 产品 | [产品说明](product.md) | 用户可见的交互、能力和使用建议 | 界面行为或用户可感知的能力变化 |
| 评估 | [能力与边界](capabilities.md) | 每项能力的实现程度、证据类型与未验证范围 | 能力发生增减，或核对出新的不一致 |
| 评估 | [设计取舍记录](decisions.md) | 影响面较大的选择及其代价 | 做出新的结构性选择，或推翻旧选择 |
| 材料 | [调研索引](research/README.md) | 带日期和代码基线的研究快照 | 新增一次调研，快照本身不回溯修改 |

概念、系统、产品三层描述"现在是什么样"；评估层描述"到了什么程度、为什么这样选"；材料层是阶段性的分析记录，不是规范。

## 按问题查

| 想知道 | 看 |
|---|---|
| 这个项目在解决什么工程问题 | [项目首页](../README.md) → [Harness 工程](harness.md) |
| 某个机制为什么这样实现 | [Harness 工程](harness.md) → [设计取舍记录](decisions.md) |
| 某段代码在系统里的位置 | [架构说明](architecture.md) |
| 某项能力现在能不能用 | [能力与边界](capabilities.md) |
| 用户在界面上能做什么 | [产品说明](product.md) |
| 怎么部署和运行 | [运行指南](../ray_agent/README.md) |
| 系统学习 Harness 工程 | [课程](../lessons/README.md) |
| 隔离验证某个机制 | [实验入口](../labs/README.md) |
| 项目现在处于哪个阶段 | [执行计划](../PLAN.md) |

## 配图

图片放在 [`assets/`](assets/)，只存放跨章节的项目级配图；各章课程配图归 `lessons/assets/`。作图规范见[根工作指南](../AGENTS.md#配图规范)。

| 图 | 回答的问题 | 出现在 |
|---|---|---|
| `product-overview.svg` | 产品提供哪些能力 | [项目首页](../README.md) |
| `harness-layers.svg` | 职责被分成了哪几层 | [Harness 工程](harness.md) |
| `architecture-overview.svg` | 有哪些组件，它们怎么通信 | [架构说明](architecture.md) |
| `state-ownership.svg` | 执行中的信息归谁、能活多久 | [架构说明](architecture.md) |
| `task-lifecycle.svg` | 一次任务怎样持续推进 | [架构说明](architecture.md) |
| `task-exits.svg` | 任务有哪几种结束方式 | [架构说明](architecture.md) |
| `course-stages.svg` | 课程分成哪几个阶段 | [课程目录](../lessons/README.md) |
