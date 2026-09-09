# Plan and ReAct

[04](04-context-and-react.md) 里的循环是内层。产品多一层外层：拆步、更新计划、总结。labs 没有 Planner，必须在产品里看。

入口：`flows/planner_react.py`、`agents/planner.py`、`agents/react.py`、`agents/base.py`、`step_guard.py`；页面 `plan-panel.tsx`。

观察仍用 [09](09-run-the-application.md) 那条写文件任务，看计划步数和实际工具调用是否对得上。未复跑标 `unverified`。

主循环是自研 Plan + ReAct；MCP/A2A 只进工具层，不替换它。
