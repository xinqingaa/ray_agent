"""运行单条评测任务：准备环境 → 创建会话 → 上传材料 → 逐轮对话（回复提问、答复审批、定时停止）→ 读回会话 → 检查。"""
import asyncio
import logging
import time
import traceback
from collections import Counter
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .client import RayAgentClient
from .spec import CheckResult, RunContext, SkipTask, TaskSpec

logger = logging.getLogger("eval")

TERMINAL_EVENTS = ("done", "error", "wait")
SETTLED_RUN_STATUSES = ("waiting", "completed", "failed", "cancelled", "interrupted")
SSE_GRACE_AFTER_STOP = 60.0  # 停止请求后仍未看到运行终态时，客户端主动断开的等待秒数
SETTLE_TIMEOUT = 120.0  # 事件流结束后等待会话离开 running 的最长秒数


def _compact_event(event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    item: Dict[str, Any] = {"event": event_type}
    if event_type == "tool":
        item.update(function=data.get("function"), status=data.get("status"), name=data.get("name"))
        if data.get("denied_by"):
            item["denied_by"] = data["denied_by"]
        if data.get("duration_ms") is not None:
            item["duration_ms"] = data["duration_ms"]
        if data.get("shaping"):
            item.update(original_chars=data["shaping"].get("original_chars"),
                        full_output_path=data["shaping"].get("full_output_path"))
    elif event_type == "message":
        item.update(role=data.get("role"), message=(data.get("message") or "")[:120],
                    attachments=[a.get("filename") for a in data.get("attachments") or []])
    elif event_type == "turn":
        item.update(phase=data.get("phase"), index=data.get("index"))
        if data.get("phase") == "started" and data.get("context_estimate"):
            item["estimate"] = data["context_estimate"].get("total")
        if data.get("phase") == "completed":
            usage = data.get("usage") or {}
            item.update(attempts=data.get("attempts"), prompt_tokens=usage.get("prompt_tokens"),
                        completion_tokens=usage.get("completion_tokens"), model_ms=data.get("model_ms"),
                        ttft_ms=data.get("ttft_ms"), error=data.get("error"))
    elif event_type == "attempt":
        item.update(turn=data.get("turn"), attempt=data.get("attempt"), reason=data.get("reason"),
                    chars=data.get("chars"), retried=data.get("retried"))
    elif event_type == "run":
        item.update(run_id=(data.get("run_id") or "")[:8], status=data.get("status"), reason=data.get("reason"))
        if data.get("mode") and data["mode"] != "normal":
            item["mode"] = data["mode"]
    elif event_type == "approval":
        item.update(tool_call_id=data.get("tool_call_id"), function=data.get("function"), status=data.get("status"),
                    rule=data.get("rule"), service=data.get("service"), service_tool=data.get("service_tool"))
    elif event_type == "compact":
        usage = data.get("usage") or {}
        item.update(trigger=data.get("trigger"), run_id=(data.get("run_id") or "")[:8] or None,
                    summarized_turns=data.get("summarized_turns"),
                    kept_turns=data.get("kept_turns"),
                    before=(data.get("before_estimate") or {}).get("total"),
                    after=(data.get("after_estimate") or {}).get("total"),
                    attempts=usage.get("attempts"), prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"))
    elif event_type == "cleanup":
        item.update(targets=[f"{t.get('kind')}:{t.get('id')}:{t.get('success')}" for t in data.get("targets") or []])
    elif event_type == "error":
        item.update(error=(data.get("error") or "")[:300])
    elif event_type == "step":
        item.update(status=data.get("status"), description=(data.get("description") or "")[:80])
    elif event_type == "plan":
        item.update(status=data.get("status"),
                    steps=[f"{s.get('status')}:{(s.get('description') or '')[:40]}" for s in data.get("steps") or []])
    return item


def _run_totals(session: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """每个运行的汇总：终态 run 事件带的 summary；仍活动（例如停在 waiting）的运行取运行行上的实时计数。"""
    totals: Dict[str, Dict[str, Any]] = {}
    for run in session.get("runs") or []:
        totals[run["run_id"]] = {"status": run.get("status"), "reason": run.get("reason"), "source": "runs",
                                 **{k: run.get(k) for k in ("turns", "model_requests", "tool_calls",
                                                            "prompt_tokens", "completion_tokens", "cached_tokens")}}
    for event in session.get("events") or []:
        data = event["data"]
        if event["event"] == "run" and data.get("summary") and data.get("run_id") in totals:
            totals[data["run_id"]].update(source="summary", **data["summary"])
    return totals


def compute_metrics(session: Dict[str, Any]) -> Dict[str, Any]:
    """模型调用次数与 tokens 取自运行汇总，并与 turn(completed) 及带 run_id 的 compact（摘要请求）逐条累加核对；
    不带 run_id 的 compact 是手动压缩，不属于任何运行，另计次数、请求数与 tokens，不参与核对。
    工具调用按非 batch 跳过的 called 事件计数。"""
    events = session.get("events") or []
    totals = _run_totals(session)
    completed = [e["data"] for e in events if e["event"] == "turn" and e["data"].get("phase") == "completed"]
    started = [e["data"] for e in events if e["event"] == "turn" and e["data"].get("phase") == "started"]
    all_compacts = [e["data"] for e in events if e["event"] == "compact"]
    compacts = [c for c in all_compacts if c.get("run_id")]
    manual = [c for c in all_compacts if not c.get("run_id")]
    compact_usage = [c.get("usage") or {} for c in compacts]
    manual_usage = [c.get("usage") or {} for c in manual]
    called = [e["data"] for e in events if e["event"] == "tool" and e["data"].get("status") == "called"]
    calling_ids = {e["data"].get("tool_call_id") for e in events
                   if e["event"] == "tool" and e["data"].get("status") == "calling"}
    called_ids = {d.get("tool_call_id") for d in called}

    def run_sum(key: str) -> int:
        return sum(t.get(key) or 0 for t in totals.values())

    turn_sums = {
        "turns": len(started),
        "model_requests": sum(t.get("attempts") or 0 for t in completed) + sum(u.get("attempts") or 0
                                                                                for u in compact_usage),
        "prompt_tokens": sum((t.get("usage") or {}).get("prompt_tokens") or 0 for t in completed)
        + sum(u.get("prompt_tokens") or 0 for u in compact_usage),
        "completion_tokens": sum((t.get("usage") or {}).get("completion_tokens") or 0 for t in completed)
        + sum(u.get("completion_tokens") or 0 for u in compact_usage),
        "tool_calls": sum(d.get("denied_by") != "batch" for d in called),
    }
    shaped = [d for d in called if d.get("shaping")]
    mismatches = [f"{key}: 运行汇总 {run_sum(key)} ≠ 逐轮 {value}" for key, value in turn_sums.items()
                  if run_sum(key) != value]
    return {
        "model_calls": run_sum("model_requests"),
        "turns": run_sum("turns"),
        "usage_unavailable_calls": sum(1 for t in completed
                                       if t.get("attempts") and (t.get("usage") or {}).get("prompt_tokens") is None),
        "prompt_tokens": run_sum("prompt_tokens"),
        "completion_tokens": run_sum("completion_tokens"),
        "cached_tokens": run_sum("cached_tokens"),
        "tool_calls": sum(d.get("denied_by") != "batch" for d in called),
        "tool_calls_by_name": dict(Counter(d.get("function", "") for d in called if d.get("denied_by") != "batch").most_common()),
        "tool_calls_unfinished": len(calling_ids - called_ids),
        "unpaired_turns": len(started) - len(completed),
        "compactions": len(compacts),
        "compaction_requests": sum(u.get("attempts") or 0 for u in compact_usage),
        "compactions_by_trigger": dict(Counter(c.get("trigger") or "" for c in all_compacts)),
        "manual_compactions": len(manual),
        "manual_compaction_requests": sum(u.get("attempts") or 0 for u in manual_usage),
        "manual_compaction_prompt_tokens": sum(u.get("prompt_tokens") or 0 for u in manual_usage),
        "manual_compaction_completion_tokens": sum(u.get("completion_tokens") or 0 for u in manual_usage),
        "shaped_results": len(shaped),
        "max_context_estimate": max(((t.get("context_estimate") or {}).get("total") or 0 for t in started),
                                    default=0),
        "metrics_consistent": not mismatches,
        "metric_mismatches": mismatches,
        "runs": [{"run_id": run_id, "status": t["status"], "reason": t["reason"], "source": t["source"]}
                 for run_id, t in totals.items()],
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

        metrics = compute_metrics(ctx.session or {})
        last_terminal = next((e["event"] for e in reversed(ctx.events) if e["event"] in TERMINAL_EVENTS), None)
        last_run = ctx.runs[-1] if ctx.runs else {}
        result.update(
            session_id=ctx.session_id,
            session_status=ctx.session.get("status") if ctx.session else None,
            last_terminal_event=last_terminal,
            last_run_status=last_run.get("status"),
            last_run_reason=last_run.get("reason"),
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
        decisions = list(spec.on_approval.decisions) if spec.on_approval else []
        stop_task: Optional[asyncio.Task] = None
        if spec.stop and spec.stop.trigger is None:
            stop_task = asyncio.create_task(self._stop_later(ctx))

        awaiting_approval = False
        for turn_index, turn in enumerate(spec.turns):
            message = turn(ctx) if callable(turn) else turn
            attachments = [info["id"] for info in ctx.uploads.values()] if turn_index == 0 else []
            while message is not None:
                ctx.log("send", turn=turn_index, message=message[:200], attachments=len(attachments))
                submit = self._chat_submitter(ctx, message, attachments)
                terminal, stop_task, approval = await self._stream(ctx, submit, deadline, stop_task)
                message, attachments = None, []
                # 等待审批时只能答复审批；答复后同一运行续接，可能再次停在审批或提问
                while (terminal == "waiting" and approval and decisions
                       and ctx.stop_requested_at is None and not ctx.observations.get("timed_out")):
                    decision = decisions.pop(0)
                    ctx.log("approval_reply", tool_call_id=approval.get("tool_call_id"),
                            function=approval.get("function"), service=approval.get("service"), decision=decision)
                    submit = self._approval_submitter(ctx, approval["tool_call_id"], decision)
                    terminal, stop_task, approval = await self._stream(ctx, submit, deadline, stop_task)
                if terminal == "waiting" and approval:
                    # 审批答复已用完：后续消息会被拒绝（409），任务停在等待审批
                    ctx.log("approval_unanswered", tool_call_id=approval.get("tool_call_id"))
                    awaiting_approval = True
                    break
                if terminal == "waiting" and replies:
                    message = replies.pop(0)
                    ctx.log("reply", message=message)
                if terminal in ("timeout",) or ctx.stop_requested_at is not None:
                    break
            if awaiting_approval or ctx.observations.get("timed_out") or ctx.stop_requested_at is not None:
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

    def _chat_submitter(self, ctx: RunContext, message: str,
                        attachments: List[str]) -> Callable[[], Awaitable[Dict[str, Any]]]:
        return lambda: self.client.chat(ctx.session_id, message, attachments)

    def _approval_submitter(self, ctx: RunContext, tool_call_id: str,
                            decision: str) -> Callable[[], Awaitable[Dict[str, Any]]]:
        return lambda: self.client.reply_approval(ctx.session_id, tool_call_id, decision)

    async def _stream(self, ctx: RunContext, submit: Callable[[], Awaitable[Dict[str, Any]]],
                      deadline: float, stop_task: Optional[asyncio.Task]):
        """提交消息或审批答复后订阅事件流，直到受理它的运行进入 waiting 或终态。

        返回 (终态, 停止任务, 待审批请求)；只有运行因审批进入 waiting 时第三项非空。
        """
        spec = ctx.spec
        state: Dict[str, Any] = {"terminal": None, "stop_task": stop_task, "approval": None, "reason": None}
        accepted = await submit()
        run_id = accepted["run_id"]
        ctx.log("accepted", run_id=run_id, seq=accepted.get("seq"), route=accepted.get("route"),
                approval=accepted.get("status"))

        async def consume() -> None:
            async for event_type, data in self.client.events(ctx.session_id, after_seq=ctx.last_seq):
                if event_type == "delta":
                    continue
                ctx.last_seq = max(ctx.last_seq, data.get("seq") or 0)
                ctx.sse_log.append({"t": ctx.elapsed(), **_compact_event(event_type, data)})
                if (spec.stop and spec.stop.trigger and state["stop_task"] is None
                        and spec.stop.trigger(event_type, data)):
                    ctx.log("stop_trigger", event=_compact_event(event_type, data))
                    state["stop_task"] = asyncio.create_task(self._stop_later(ctx))
                if event_type == "approval" and data.get("run_id") == run_id:
                    state["approval"] = data if data.get("status") == "pending" else None
                if (event_type == "run" and data.get("run_id") == run_id
                        and data.get("status") in SETTLED_RUN_STATUSES):
                    state["terminal"], state["reason"] = data["status"], data.get("reason")
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
                state["terminal"] = "no_terminal_after_stop"
                break
            if now > deadline:
                sse_task.cancel()
                state["terminal"] = "timeout"
                ctx.observations["timed_out"] = True
                await self._safe_stop(ctx, "timeout")
                break
        ctx.log("sse_end", terminal=state["terminal"], reason=state["reason"],
                after_stop=ctx.stop_requested_at is not None)
        approval = state["approval"] if state["terminal"] == "waiting" and state["reason"] == "approval" else None
        return state["terminal"], state["stop_task"], approval

    async def _stop_later(self, ctx: RunContext) -> None:
        await asyncio.sleep(ctx.spec.stop.seconds)
        ctx.stop_requested_at = ctx.elapsed()
        ctx.log("stop_request")
        stopped = await self.client.stop_session(ctx.session_id)
        ctx.log("stop_returned", run_id=(stopped or {}).get("run_id"))
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
        """等会话离开 running 后读回完整详情（运行与全部事件）。"""
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
