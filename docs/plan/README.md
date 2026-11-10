# 桌面升级计划

首个交付（M0—P9）处于**实施中**，目标仍是 Apple Silicon 内部包在没有开发环境的 Mac 上完成工作区闭环。现有实现覆盖主要模块，但尚未满足原计划的全部完成条件；具体出入、问题位置与关闭条件见[首个交付收尾与接手清单](first-delivery-remaining.md)。

## 授权与状态

首个交付原实施范围不变，P4 已实施，P5 服务层已收尾，现行机制合入正文；P5 界面与 P6—P9 保留各自未闭环项。后续阶段尚未开始，开始前再确认范围与顺序。各包状态和首个交付完成门槛见[实施与交付](implementation.md)。

已确认的产品边界与技术基线仍以[决策清单](decisions.md)为准。Mac 优先、正式签名与 Windows／移动端后移是原计划已确认的范围选择，不是本次发现的漏项。机制正文已部分合并，但不能据此判定实现或验收完成。

## 当前收尾

先处理隔离、检索正确性与中断恢复，再补齐来源与索引控制等用户界面，最后完成 P9 整包验收。新 agent 从[接手顺序](first-delivery-remaining.md#新-agent-接手顺序)进入，不依赖历史对话或测试数量推断完成状态。

## 后续阶段

| 阶段 | 工作包 | 结果 |
|---|---|---|
| Mac 正式发布 | [P10](implementation.md#后续阶段) | Developer ID 签名、公证、自动更新、离线组件包、备份恢复界面 |
| Windows | [P11](implementation.md#后续阶段) | Windows x64 达到与 Mac 相同行为并签名发布 |
| 辅助移动端 | [P12](implementation.md#后续阶段) | Android、iOS 依次连接桌面 |

专题入口：

| 阅读问题 | 入口 |
|---|---|
| 首个交付有哪些偏差，接手先做什么 | [收尾与接手清单](first-delivery-remaining.md) |
| 检索、记忆与 Skill 的收尾边界 | [文档知识与检索](knowledge-and-retrieval.md)、[工作区与记忆](workspaces-and-memory.md)、[Skill](skills.md) |
| 签名、更新、离线包与移动分发 | [客户端与分发（后续）](clients-and-distribution.md) |
| 完整备份恢复与正式更新流程 | [本机核心（后续）](local-runtime-and-storage.md) |
| Windows 文件／进程与移动配对边界 | [P11 实施范围](implementation.md#后续阶段)、[共享契约（后续）](shared-contracts.md) |
| 工作包状态、依赖与交付门槛 | [实施与交付](implementation.md) |

## 计划维护

工作包组织尚在实施或未开始的工作；完成后将有效设计合入正文并收缩本目录。收尾清单是当前实施入口，条目关闭后移除已解决内容，首个交付完成后清理清单及入口。安装与日常操作命令只放服务指南，不在计划里维护两套。不追加日期台账或验收目录。
