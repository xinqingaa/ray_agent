"""运行单条评测任务：准备环境 → 创建会话 → 上传材料 → 逐轮对话（回复提问、定时停止）→ 读回会话 → 检查。"""
import asyncio
import logging
import time
import traceback
from collections import Counter
from typing import Any, Dict, List, Optional

from .client import RayAgentClient
from .spec import CheckResult, RunContext, SkipTask, TaskSpec

logger = logging.getLogger("eval")

TERMINAL_EVENTS = ("done", "error", "wait")
SSE_GRACE_AFTER_STOP = 60.0  # 停止请求后仍未关闭 SSE 时，客户端主动断开的等待秒数
SETTLE_TIMEOUT = 120.0  # SSE 结束后等待会话离开 running 的最长秒数


def _compact_event(event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    item: Dict[str, Any] = {"event": event_type}
    if event_type == "tool":
        item.update(function=data.get("function"), status=data.get("status"), name=data.get("name"))
        if data.get("duration_ms") is not None:
            item["duration_ms"] = data["duration_ms"]
    elif event_type == "message":
        item.update(role=data.get("role"), message=(data.get("message") or "")[:120],
                    attachments=[a.get("filename") for a in data.get("attachments") or []])
    elif event_type == "usage":
        item.update(prompt_tokens=data.get("prompt_tokens"), completion_tokens=data.get("completion_tokens"),
                    available=data.get("available"))
    elif event_type == "error":
        item.update(error=(data.get("error") or "")[:300])
    elif event_type == "step":
        item.update(status=data.get("status"), description=(data.get("description") or "")[:80])
    elif event_type == "plan":
        item.update(status=data.get("status"),
                    steps=[f"{s.get('status')}:{(s.get('description') or '')[:40]}" for s in data.get("steps") or []])
    return item


def compute_metrics(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """从持久化事件统计指标；模型调用次数按 usage 事件计数。"""
    usage = [e["data"] for e in events if e["event"] == "usage"]
    called = [e["data"] for e in events if e["event"] == "tool" and e["data"].get("status") == "called"]
    calling_ids = {e["data"].get("tool_call_id") for e in events
                   if e["event"] == "tool" and e["data"].get("status") == "calling"}
    called_ids = {d.get("tool_call_id") for d in called}
    return {
        "model_calls": len(usage),
        "usage_unavailable_calls": sum(1 for u in usage if not u.get("available")),
        "prompt_tokens": sum(u.get("prompt_tokens") or 0 for u in usage),
        "completion_tokens": sum(u.get("completion_tokens") or 0 for u in usage),
        "tool_calls": len(called),
        "tool_calls_by_name": dict(Counter(d.get("function", "") for d in called).most_common()),
        "tool_calls_unfinished": len(calling_ids - called_ids),
        "error_events": [e["data"].get("error", "")[:300] for e in events if e["event"] == "error"],
    }


class EvalRunner:
    def __init__(self, client: RayAgentClient, host_address: str) -> None:
        self.client = client
        self.host_address = host_address

    async def run(self, spec: TaskSpec, run_index: int) -> Dict[str, Any]:
        ctx = RunContext(client=self.client, spec=spec, run_index=run_index)
        ctx.env["host_address"] = self.host_address
        result: Dict[str, Any] = {"task_id": spec.id, "title": spec.title, "run_index": run_index}
        checks: List[CheckResult] = []
        wall_start = time.time()
        try:
            async with spec.environment(ctx):
                await self._drive(ctx)
                await self._settle(ctx)
                checks = await spec.check(ctx)
            required = [c for c in checks if c.required]
            result["outcome"] = "passed" if required and all(c.passed for c in required) else "failed"
            if ctx.observations.get("timed_out"):
                result["outcome"] = "failed"
        except SkipTask as e:
            result["outcome"] = "skipped"
            result["skip_reason"] = str(e)
        except Exception as e:
            result["outcome"] = "error"
            result["error"] = f"{type(e).__name__}: {e}"
            result["traceback"] = traceback.format_exc(limit=5)
            await self._safe_stop(ctx, "runner_error")
            await self._settle(ctx, fetch_only=True)

        metrics = compute_metrics(ctx.events)
        last_terminal = next((e["event"] for e in reversed(ctx.events) if e["event"] in TERMINAL_EVENTS), None)
        result.update(
            session_id=ctx.session_id,
            session_status=ctx.session.get("status") if ctx.session else None,
            last_terminal_event=last_terminal,
            wall_seconds=round(ctx.observations.get("wall_seconds", time.time() - wall_start), 1),
            **metrics,
            checks=[c.__dict__ for c in checks],
            interactions=ctx.interactions,
            observations={k: v for k, v in ctx.observations.items() if k != "wall_seconds"},
            env={k: v for k, v in ctx.env.items() if isinstance(v, (str, int, float))},
            events=[_compact_event(e["event"], e["data"]) for e in ctx.events],
            final_reply=ctx.final_reply()[:1000],
        )
        return result

    async def _drive(self, ctx: RunContext) -> None:
        spec = ctx.spec
        ctx.session_id = await self.client.create_session()
        for filename, content in spec.materials.items():
            ctx.uploads[filename] = await self.client.upload_file(filename, content)
        ctx.started_at = time.monotonic()
        deadline = ctx.started_at + spec.timeout
        replies = list(spec.on_wait.replies) if spec.on_wait else []
        stop_task: Optional[asyncio.Task] = None
        if spec.stop and spec.stop.trigger is None:
            stop_task = asyncio.create_task(self._stop_later(ctx))

        for turn_index, turn in enumerate(spec.turns):
            message = turn(ctx) if callable(turn) else turn
            attachments = [info["id"] for info in ctx.uploads.values()] if turn_index == 0 else []
            while message is not None:
                ctx.log("send", turn=turn_index, message=message[:200], attachments=len(attachments))
                terminal, stop_task = await self._stream(ctx, message, attachments, deadline, stop_task)
                message, attachments = None, []
                if terminal == "wait" and replies:
                    message = replies.pop(0)
                    ctx.log("reply", message=message)
                if terminal in ("timeout",) or ctx.stop_requested_at is not None:
                    break
            if ctx.observations.get("timed_out") or ctx.stop_requested_at is not None:
                break

        if stop_task:
            if ctx.stop_requested_at is None:
                stop_task.cancel()
                ctx.log("stop_cancelled", reason="对话已结束，未到停止时刻")
            try:
                await stop_task
            except asyncio.CancelledError:
                pass
        ctx.observations["wall_seconds"] = round(time.monotonic() - ctx.started_at, 1)

    async def _stream(self, ctx: RunContext, message: str, attachments: List[str],
                      deadline: float, stop_task: Optional[asyncio.Task]):
        spec = ctx.spec
        state = {"terminal": None, "stop_task": stop_task}

        async def consume() -> None:
            async for event_type, data in self.client.chat(ctx.session_id, message, attachments):
                ctx.sse_log.append({"t": ctx.elapsed(), **_compact_event(event_type, data)})
                if (spec.stop and spec.stop.trigger and state["stop_task"] is None
                        and spec.stop.trigger(event_type, data)):
                    ctx.log("stop_trigger", event=_compact_event(event_type, data))
                    state["stop_task"] = asyncio.create_task(self._stop_later(ctx))
                if event_type in TERMINAL_EVENTS:
                    state["terminal"] = event_type
                    return
            state["terminal"] = "stream_closed"

        sse_task = asyncio.create_task(consume())
        while True:
            done, _ = await asyncio.wait({sse_task}, timeout=1.0)
            if done:
                sse_task.result()
                break
            now = time.monotonic()
            if ctx.stop_requested_at is not None and now - ctx.started_at - ctx.stop_requested_at > SSE_GRACE_AFTER_STOP:
                sse_task.cancel()
                state["terminal"] = "sse_not_closed_after_stop"
                break
            if now > deadline:
                sse_task.cancel()
                state["terminal"] = "timeout"
                ctx.observations["timed_out"] = True
                await self._safe_stop(ctx, "timeout")
                break
        ctx.log("sse_end", terminal=state["terminal"], after_stop=ctx.stop_requested_at is not None)
        return state["terminal"], state["stop_task"]

    async def _stop_later(self, ctx: RunContext) -> None:
        await asyncio.sleep(ctx.spec.stop.seconds)
        ctx.stop_requested_at = ctx.elapsed()
        ctx.log("stop_request")
        await self.client.stop_session(ctx.session_id)
        ctx.log("stop_returned")
        if ctx.spec.stop.observe:
            await ctx.spec.stop.observe(ctx)

    async def _safe_stop(self, ctx: RunContext, reason: str) -> None:
        if not ctx.session_id:
            return
        try:
            await self.client.stop_session(ctx.session_id)
            ctx.log("cleanup_stop", reason=reason)
        except Exception as e:
            ctx.log("cleanup_stop_failed", reason=reason, error=str(e))

    async def _settle(self, ctx: RunContext, fetch_only: bool = False) -> None:
        """SSE 在 error 事件处就会断开而任务可能仍在运行，等会话离开 running 后再读回。"""
        if not ctx.session_id:
            return
        loop = asyncio.get_running_loop()
        deadline = loop.time() + (0 if fetch_only else SETTLE_TIMEOUT)
        while True:
            try:
                ctx.session = await self.client.get_session(ctx.session_id)
            except Exception as e:
                ctx.log("get_session_failed", error=str(e))
                return
            if ctx.session.get("status") != "running" or loop.time() >= deadline:
                break
            await asyncio.sleep(2)
        if ctx.session.get("status") == "running":
            ctx.log("still_running_after_settle")
