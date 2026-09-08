# Application flow

Status: stub
Area: Application flow
Prerequisites: 阅读 [学习地图](map.md)、[架构说明](../docs/architecture.md)

## 1. Learning objectives and prerequisites

- 能按调用顺序列出一次对话经过的模块。
- 能区分 UI、Nginx、API 分层、沙箱、Postgres、Redis、文件存储各自保存什么。
- 前置：不必先起 Docker；要把「完整链路」写成已观察，需产品 Compose。

## 2. Essential concepts and a runnable example

产品一次任务的主干（代码事实，摘自架构说明）：

```text
UI 发起聊天
  → 会话路由与 AgentService
  → 准备沙箱、浏览器和任务
  → AgentTaskRunner 消费输入
  → PlannerReActFlow 规划、执行、更新计划、总结
  → Agent 调用模型与工具
执行事件 → Redis 任务流 → API SSE → UI
```

本课不挂 lab。练习脚本里的单次工具调用不能代替这条链路。

观察实验（产品，`unverified` 于本机新环境）：见 [地图中的共用观察](map.md#shared-product-observation)。启动步骤链到 [运行指南](../ray_agent/README.md)，不要在本课重写 `.env` 说明。

## 3. Product code entry points and the execution path

| 步骤 | 入口 |
|---|---|
| 页面与会话 | `ray_agent/ui/src/app/sessions/[id]/page.tsx`、`use-session-detail.ts` |
| HTTP / SSE | Nginx；`ray_agent/api/app/interfaces/endpoints/session_routes.py` |
| 任务与资源准备 | `application/services/agent_service.py` |
| 运行与生命周期 | `domain/services/agent_task_runner.py` |
| 外层规划 | `domain/services/flows/planner_react.py` |
| 依赖组装 | `interfaces/service_dependencies.py` |

TODO：沿一次请求把上述文件串成短路径说明，不列类清单。

## 4. Design rationale, limitations, and relevant failure behavior

- 创建任务时就会准备沙箱和浏览器，即使用户只提文件问题。
- 界面显示完成、流程终态、后台任务结束、资源释放是不同环节。
- 详细失败放到 [09](09-failure-behavior.md)。

## 5. Understanding checks or a focused observation experiment

- 用户只打开页面、尚未发消息时，哪些服务必须已经健康？
- Redis 里有消息，是否等于进程重启后任务还能继续？依据写在哪？
- 为什么验收要用「写 hello 再读」，而不是只看 `/api/status`？
