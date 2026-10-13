# 调研入口

本目录用于需要独立分析的问题。调研标明日期、代码基线，区分观察、源码事实、影响推断与建议；方案是否实施由授权和源码决定，不因出现在调研里就成为待办。

## 已完成调研的承接

2026-10-13 按问题合并 Git `b62fda5` 中的四份调研，分析依据与方案设计分别进入背景和专题计划。正文保留理解选择所需的深度，原件通过 `git show b62fda5:<原路径>` 追溯。

| 原调研 | 分析与背景 | 设计与实施方案 |
|---|---|---|
| 2026-10-08 执行效率 | [循环与上下文](../background/execution-and-context.md)、[工具观察](../background/tools-and-interface.md) | [执行与效率](../plan/execution-and-context.md)、[浏览器与视觉](../plan/browser-and-visual-resources.md) |
| 2026-10-08 截图策略 | [工具观察](../background/tools-and-interface.md) | [浏览器与视觉](../plan/browser-and-visual-resources.md) |
| 2026-10-10 请求预算与异常交付 | [长任务交付](../background/plans-and-delivery.md) | [计划、核验与成果收尾](../plan/long-task-trust-and-delivery.md) |
| 2026-10-11 项目收尾复审 | [运行事实](../background/runtime-and-progress.md)、[长任务](../background/plans-and-delivery.md) | [运行可靠性](../plan/runtime-and-control.md)、[成果收尾](../plan/long-task-trust-and-delivery.md) |

关键验证结果统一进入 [维护入口](../plan/README.md#关键验收)所指报告，不各建证据目录。未采纳的历史方向不列为当前待办。

当前没有另行授权的独立调研。实际能力与限制见 [能力与边界](../capabilities.md)，需要新分析时再建立材料。
