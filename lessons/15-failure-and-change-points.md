# Failure and change points

把取消、迭代上限、断连、资源释放和「以后改哪里」放在一起。没有独立的失败 lab。

入口：`step_guard.py`、`task_error.py`、`agent_task_runner.py`、协议取消、沙箱 TTL。界面完成、流程终态、后台 Task 结束、容器删除是不同环节。

观察（`unverified`）：成功基线仍用写文件任务；协议固定失败用夹具且放在任务最后；进行中取消时看动态沙箱该不该删、已有沙箱不该删。

改工具或策略时的阅读顺序：`domain/services/tools/` → Flow / Agent / `service_dependencies.py` → 沙箱或协议适配 → 领域事件 / SSE / 前端 `session-events.ts` 与展示组件。
