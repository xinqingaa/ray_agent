# Reliability and Verification

失败发生后系统能保证什么，如何证明任务完成？

## Narrative

把工具失败、断连、超限和进程退出放回完整任务链，分析影响范围、重试与重复执行风险，再设计可观察的验证与恢复实验。

## Material and scope

主要载体：RayAgent：失败路径与验证实验。材料与实现入口见 [素材索引](map.md#chapter-materials)。

不预设持久化等于恢复、不预设重试安全；未运行的实验明确标记。

[上一章：Agent Collaboration with A2A](15-agent-collaboration-with-a2a.md) · [课程目录](README.md) · [下一章：From Sessions to Workspaces](17-from-sessions-to-workspaces.md)
