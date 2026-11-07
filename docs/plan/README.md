# 后续阶段计划

首个交付（M0—P9）已完成：Apple Silicon 内部包可在本机运行工作区闭环，不依赖开发环境与原服务栈。已落地机制合入[产品说明](../product.md)、[架构说明](../architecture.md)、[Harness](../harness.md)、[Skill](../skills.md)与各服务指南；本目录只保留尚未开始的后续阶段。

## 授权与状态

用户已授权并完成首个交付。后续阶段开始前再确认范围与顺序。各包状态见[实施状态](implementation.md#实施状态)。

已确认的产品边界与技术基线仍以[决策清单](decisions.md)为准；不在此重复已落地设计。

## 后续阶段

| 阶段 | 工作包 | 结果 |
|---|---|---|
| Mac 正式发布 | [P10](implementation.md#后续阶段) | Developer ID 签名、公证、自动更新、离线组件包、备份恢复界面 |
| Windows | [P11](implementation.md#后续阶段) | Windows x64 达到与 Mac 相同行为并签名发布 |
| 辅助移动端 | [P12](implementation.md#后续阶段) | Android、iOS 依次连接桌面 |

专题里仅余下阶段相关的接口与未决事项：

| 阅读问题 | 入口 |
|---|---|
| 签名、更新、离线包与移动分发 | [客户端与分发（后续）](clients-and-distribution.md) |
| 完整备份恢复与正式更新流程 | [本机核心（后续）](local-runtime-and-storage.md) |
| Windows 文件／进程与移动配对边界 | [文件与执行（后续）](files-and-execution.md)、[共享契约（后续）](shared-contracts.md) |
| 实施顺序、完成条件与待用户处理 | [实施与交付](implementation.md) |

## 计划维护

工作包只组织尚未实施的工作；完成后将有效设计合入正文并收缩本目录。安装与日常操作命令只放服务指南，不在计划里维护两套。不追加日期台账或验收目录。
