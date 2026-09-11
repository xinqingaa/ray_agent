# 规划与内外层循环

外层计划与内层工具反馈如何协作？

## 叙述方向

沿共同任务解释计划如何产生、步骤如何交给执行器、工具反馈如何驱动决策，以及计划何时更新和结束。展开第一章仅概述的设计选择：一个步骤可以包含多次调用，Planner 与执行器可以复用模型服务，独立规划带来组织收益与额外调用成本。核对步骤成功后的计划更新，以及步骤失败时本轮如何终止。

## 材料与范围

主要载体：RayAgent：Planner、Executor 与流程。材料与实现入口见 [本章核对入口](map.md#chapter-07-evidence)。

区分两层继续与结束条件，不把当前组织方式当作唯一 Agent 架构。

[上一章：从 Agent Loop 到完整 Harness](06-run-rayagent-one-complete-task.md) · [课程目录](README.md) · [下一章：任务执行与控制](08-task-execution-and-control.md)
