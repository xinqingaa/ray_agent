# 设计背景

本目录解释核心设计面对的问题、备选方向与取舍。产品行为和详细机制维护在正文，操作与检查方法维护在服务指南，新工作见 [PLAN.md](../../PLAN.md)。

| 阅读问题 | 背景分析 | 机制说明 |
|---|---|---|
| 为什么用单循环，上下文为什么分层治理 | [执行循环与上下文](execution-and-context.md) | [决策层](../harness.md#决策层)、[上下文治理](../harness.md#上下文与记忆治理) |
| 为什么要区分运行记录、执行进程和外部资源 | [运行记录与控制](runtime-and-progress.md) | [控制平面](../architecture.md#结束路径与控制平面)、[构建身份](../architecture.md#构建身份与运行快照) |
| 为什么清单完成不等于成果完整 | [计划与成果交付](plans-and-delivery.md) | [计划清单](../harness.md#计划清单)、[核验与交付](../harness.md#核验与成果交付) |
| 为什么直接读写本地文件夹还需要身份标记、写入租约与撤销 | [文件夹工作区与写入保护](workspace-folders.md) | [产品说明](../product.md#工作区)、[执行环境与限制](../architecture.md#执行环境与限制) |
| 托管项目为什么保存副本、快照与背景（已删除，供对照） | [托管项目与数据保护](projects-and-artifacts.md) | 已删除；由[文件夹工作区](workspace-folders.md)与后续[工作区与长期记忆](../plan/workspaces-and-memory.md)承接 |
| 为什么动作、观察和视觉输入要分别处理 | [工具观察与执行效率](tools-and-interface.md) | [浏览器与视觉资源](../harness.md#浏览器动作与视觉资源) |
| 为什么阅读、编辑、技术观察和模型连接各有入口 | [用户交互与模型接入](interaction-and-configuration.md) | [产品说明](../product.md)、[UI 设计](../../ray_agent/ui/DESIGN.md)、[模型请求分工](../harness.md#模型选择与请求分工) |
| 为什么 skill 需要完整包、固定版本和运行引用 | [skill 安装与运行](skills.md) | [skill 机制](../skills.md) |
