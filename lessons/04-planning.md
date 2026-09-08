# Planning

Status: stub
Area: Planning
Prerequisites: [01](01-application-flow.md)、[03](03-react-loop.md)

## 1. Learning objectives and prerequisites

- 能说明外层流程负责拆步、更新计划、总结，内层 Agent 负责单步内的模型与工具往返。
- 能在页面计划面板和代码状态机之间建立对应。
- 前置：无专用 lab。不要把 `4_3` / `4_4` 当成 Planner 练习。

## 2. Essential concepts and a runnable example

labs 没有独立的「任务分解」脚本。本课的可跑例子是产品观察（`unverified`）：[共用写文件任务](map.md#shared-product-observation)。

预期对照（阶段 1 曾观察到，本机新环境需复跑）：Planner 拆成多步，ReAct 实际发出 `write_file` / `read_file`，然后总结。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 外层状态转换 | `ray_agent/api/app/domain/services/flows/planner_react.py` |
| 流程基类 | `domain/services/flows/base.py` |
| Planner Agent | `domain/services/agents/planner.py` |
| Planner 提示 | `domain/services/prompts/planner.py`、`prompts/en/planner.py` |
| 计划展示 | `ray_agent/ui/src/components/plan-panel.tsx`；计划相关 SSE |

TODO：画出「规划 → 执行一步 → 更新计划 → 再规划或总结」的状态，只写代码里存在的分支。

## 4. Design rationale, limitations, and relevant failure behavior

- 代码事实：主执行流程是自研 Plan + ReAct，MCP/A2A 只进入工具层，不替换该循环。
- 会话失败后同一会话可再发消息重新规划，不要求新开任务（架构说明）。
- 计划存在于外层执行状态，经事件反映到 UI；不要假设数据库有一份独立「计划表」——待读持久化后再写实。

## 5. Understanding checks or a focused observation experiment

- 若规划出 2 步，但 ReAct 在一步里调用了两个工具，计划面板应怎样理解？
- 总结发生在全部步骤成功之后，还是每一步之后？依据哪个函数？
- 新增一种执行策略时，应该改 Flow、改 Agent，还是两者都要看？
