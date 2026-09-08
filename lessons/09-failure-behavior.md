# Failure behavior

Status: stub
Area: Failure behavior
Prerequisites: [01](01-application-flow.md)～[08](08-a2a.md) 的入口已能对上号

## 1. Learning objectives and prerequisites

- 能分开描述：模型/工具错误、迭代上限、用户取消、SSE 断连、沙箱回收、协议调用失败。
- 能指出新增工具或改执行策略时要先读哪些模块（回应 PLAN 最后一项完成标准）。
- 前置：无独立失败 lab。协议固定失败可用产品夹具。多数观察需 Compose。

## 2. Essential concepts and a runnable example

建议观察（均 `unverified`，跑后再改）：

1. 共用写文件任务作为成功基线。
2. 发送会触发工具失败的协议夹具步骤（放在任务最后）。
3. 任务进行中取消（UI 或等价接口），看沙箱 / MCP 连接是否按文档回收。
4. 刷新或中止 SSE，对照日志里是否出现请求 Task 取消，而不是业务 `failed`。

labs 不提供统一的「取消/断连」脚本；不要把 lab 异常当成产品行为。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 步数 / 迭代 | `domain/services/agents/step_guard.py`；`agent_config.max_iterations` |
| 任务错误 | `domain/services/task_error.py` |
| 运行与清理 | `domain/services/agent_task_runner.py` |
| 协议取消 | `infrastructure/protocols/common.py`、`mcp.py`、`a2a.py` |
| SSE 与请求取消 | `infrastructure/repositories/db_uow.py` 中与 sse_starlette 相关的注释与处理 |
| 沙箱生命周期 | `docker_sandbox.py`；`SANDBOX_TTL_MINUTES` |
| 前端错误 / 等待 | `ErrorSSEEvent` / `WaitSSEEvent`；会话详情组件 |

改工具或策略时的阅读顺序（骨架，正文再按代码核实）：

1. 声明：`domain/services/tools/`
2. 组装：Flow / Agent / `service_dependencies.py`
3. 适配：沙箱、协议、存储
4. 事件：领域事件 → SSE schema → `session-events.ts` → 展示组件

## 4. Design rationale, limitations, and relevant failure behavior

- 界面完成 ≠ 流程终态 ≠ 后台 Task 结束 ≠ 容器已删。
- 失败会话可再发消息重新规划。
- A2A 需要人工输入时，不自动进入主流程 waiting 续接。
- 架构说明中的限制若尚未端到端复跑，保持 `unverified`，不要写成新环境已验收。

## 5. Understanding checks or a focused observation experiment

- 达到 `max_iterations` 时，会话状态应是 `failed` 还是 `completed`？依据哪段代码？
- 用户取消后，动态沙箱容器该不该删？已有沙箱呢？
- 若只改工具的 Python 实现、不改 schema 和前端 `tool-use` 组件，可能在哪一层先坏？
