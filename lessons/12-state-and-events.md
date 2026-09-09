# State and events

[05](05-async-http.md) 只建立了异步 HTTP。产品里还要分清：会话落在 Postgres、任务消息走 Redis、页面靠 SSE 和历史接口。

入口：`domain/models/event.py`、`interfaces/schemas/event.py`、`redis_stream_task.py`；前端 `session-events.ts`、`use-session-detail.ts`。会话状态：`pending` / `running` / `waiting` / `completed` / `failed`。

刷新 [09](09-run-the-application.md) 的会话，看历史是否还在。Redis 里有消息不等于进程重启后还能接着跑。

不讲沙箱文件落盘（[13](13-sandbox-and-storage.md)）和协议 `outcome` 展示细节（[14](14-mcp-and-a2a-in-the-product.md)）。
