# ReAct loop

Status: stub
Area: Models and tools
Prerequisites: [02](02-models-and-tool-calling.md)

## 1. Learning objectives and prerequisites

- 能用「思考 / 行动 / 观察」描述一轮 ReAct，并指出工具结果如何回到上下文。
- 能区分 lab 里的单 Agent 循环与产品里「外层 Plan、内层 ReAct」。
- 前置：Recommended 脚本需要模型 Key。`6_7_ReAct-Agent-with-mcp.py` 还依赖 MCP 2.2 环境，见 [基础实验](../labs/foundations/README.md)。

## 2. Essential concepts and a runnable example

| 档位 | 脚本（`labs/foundations/`） |
|---|---|
| Recommended | `4_2_计算消息上下文长度.py`、`4_3_ReAct Agent为LLM添加CoT.py`、`4_4_ReAct+CoT实现企业业务表单填写.py` |
| Recommended（跨课） | `6_7_ReAct-Agent-with-mcp.py`（有 Key 时；协议细节归 [07](07-mcp.md)） |

教学简化：`4_3` / `4_4` 没有产品 Planner，也没有沙箱或 SSE。

TODO：记录脚本实际轮次与工具名。未跑标 `unverified`。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 模型调用与工具循环 | `ray_agent/api/app/domain/services/agents/base.py` |
| ReAct Agent | `domain/services/agents/react.py` |
| 迭代与步数约束 | `domain/services/agents/step_guard.py` |
| ReAct 提示 | `domain/services/prompts/react.py`、`prompts/en/react.py` |

内层循环由外层 [PlannerReActFlow](04-planning.md) 在「执行某一步」时驱动。

## 4. Design rationale, limitations, and relevant failure behavior

- 推断：把规划放在外层，是为了让界面上的步骤与单次工具往返分开。（待对照 `planner_react.py` 再写实）
- `max_iterations` 等限制见 `config.yaml` 的 `agent_config`；失败行为展开在 [09](09-failure-behavior.md)。
- 上下文过长时，先看 `4_2` 的现象，再对照产品是否截断或摘要（TODO：读代码后填写）。

## 5. Understanding checks or a focused observation experiment

- 若模型只回复文字、没有 tool calls，产品这一步会怎样结束？
- `4_4` 填完表单，能否说明产品会更新计划面板？为什么能或不能？
- `step_guard` 拦住的是「模型轮次」还是「计划步骤」？
