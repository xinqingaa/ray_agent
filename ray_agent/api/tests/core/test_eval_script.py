"""评测脚本的离线部分：SSE 解析、指标统计、按轮读取与任务注册，不连接产品服务。"""
import asyncio
import json

import httpx

from scripts.eval import tasks  # noqa: F401  注册 E1–E6
from scripts.eval.client import RayAgentClient
from scripts.eval.runner import compute_metrics
from scripts.eval.spec import RunContext, _order, build, registered_ids


def ev(event, **data):
    return {"event": event, "data": data}


def test_registry_orders_numerically_and_builds_matching_ids():
    ids = registered_ids()
    assert ids[:7] == ["E1", "E2", "E3", "E4", "E5", "E6", "E6-deny"]
    assert sorted(["E10", "E7", "E6-deny", "E2", "E6"], key=_order) == ["E2", "E6", "E6-deny", "E7", "E10"]
    assert all(build(task_id).id == task_id for task_id in ids)
    assert build("E6").on_approval.decisions[0] == "approve"
    assert build("E6-deny").on_approval.decisions[0] == "deny"


class ApprovalFakeClient:
    """按提交次数给出事件：第一次提交后停在审批，答复后运行结束。"""

    def __init__(self):
        self.calls = []

    async def create_session(self):
        return "s1"

    async def chat(self, session_id, message, attachments):
        self.calls.append(("chat", message))
        return {"run_id": "r1", "seq": 1, "route": "started"}

    async def reply_approval(self, session_id, tool_call_id, decision):
        self.calls.append(("approval", tool_call_id, decision))
        return {"run_id": "r1", "seq": 5, "status": "approved" if decision == "approve" else "rejected"}

    async def events(self, session_id, after_seq=0):
        if after_seq < 4:
            yield "approval", {"seq": 2, "run_id": "r1", "tool_call_id": "c1", "function": "mcp_w0eval_add_x",
                               "status": "pending", "service": "w0eval", "service_tool": "add"}
            yield "wait", {"seq": 3, "run_id": "r1"}
            yield "run", {"seq": 4, "run_id": "r1", "status": "waiting", "reason": "approval"}
        else:
            yield "approval", {"seq": 5, "run_id": "r1", "tool_call_id": "c1", "status": "approved"}
            yield "run", {"seq": 6, "run_id": "r1", "status": "completed"}


def test_runner_answers_approval_and_stops_when_decisions_run_out():
    from scripts.eval.runner import EvalRunner
    from scripts.eval.spec import DecideOnApproval, TaskSpec

    async def drive(decisions, turns):
        client = ApprovalFakeClient()
        spec = TaskSpec(id="T", title="t", turns=turns, check=None, on_approval=DecideOnApproval(decisions))
        ctx = RunContext(client=client, spec=spec, run_index=1)
        await EvalRunner(client, "h")._drive(ctx)
        return client, ctx

    client, ctx = asyncio.run(drive(["deny"], ["算一下"]))
    assert client.calls == [("chat", "算一下"), ("approval", "c1", "deny")]
    assert [i["kind"] for i in ctx.interactions if i["kind"].startswith("approval")] == ["approval_reply"]
    assert [e["status"] for e in ctx.sse_log if e["event"] == "approval"] == ["pending", "approved"]

    # 没有可用答复：停在等待审批，不再发送后续轮次（服务端会以 409 拒绝）
    client, ctx = asyncio.run(drive([], ["算一下", "下一轮"]))
    assert client.calls == [("chat", "算一下")]
    assert [i["kind"] for i in ctx.interactions if i["kind"].startswith("approval")] == ["approval_unanswered"]

    try:
        DecideOnApproval(["yes"])
    except ValueError:
        pass
    else:
        raise AssertionError("非法审批答复应被拒绝")


def test_chat_posts_json_and_events_parse_sse_frames():
    body = (
        ": ping\r\n\r\n"
        "id: 1\r\nevent: message\r\ndata: {\"seq\": 1, \"role\": \"user\", \"message\": \"中文\"}\r\n\r\n"
        "id: 2\r\nevent: tool\r\ndata: {\"function\": \"read_file\",\r\ndata:  \"status\": \"called\"}\r\n\r\n"
        "id: 3\r\nevent: run\r\ndata: {\"seq\": 3, \"status\": \"completed\"}\r\n\r\n"
    )
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            seen["payload"] = json.loads(request.content)
            return httpx.Response(200, json={"code": 200, "msg": "ok", "data": {"run_id": "r1", "seq": 1,
                                                                             "route": "started"}})
        seen["after_seq"] = request.url.params.get("after_seq")
        return httpx.Response(200, content=body.encode("utf-8"), headers={"content-type": "text/event-stream"})

    async def collect():
        client = RayAgentClient("http://test/api")
        client._http = httpx.AsyncClient(base_url="http://test/api", transport=httpx.MockTransport(handler))
        async with client:
            accepted = await client.chat("s1", "hi", ["f1"])
            return accepted, [item async for item in client.events("s1", after_seq=0)]

    accepted, events = asyncio.run(collect())
    assert accepted == {"run_id": "r1", "seq": 1, "route": "started"}
    assert seen["payload"]["attachments"] == ["f1"] and seen["after_seq"] == "0"
    assert [e for e, _ in events] == ["message", "tool", "run"]
    assert events[0][1]["message"] == "中文"
    assert events[1][1] == {"function": "read_file", "status": "called"}


def test_metrics_come_from_run_summary_and_are_cross_checked_with_turns():
    def turn(phase, index, **data):
        return ev("turn", phase=phase, index=index, run_id="r1", **data)

    events = [
        ev("run", run_id="r1", status="running"),
        ev("message", role="user", message="q"),
        turn("started", 1),
        ev("tool", tool_call_id="a", function="shell_execute", status="calling"),
        ev("tool", tool_call_id="a", function="shell_execute", status="called"),
        turn("completed", 1, attempts=2, usage={"prompt_tokens": 100, "completion_tokens": 10}),
        turn("started", 2),
        ev("tool", tool_call_id="b", function="shell_execute", status="calling"),
        turn("completed", 2, attempts=1, usage={"prompt_tokens": None}, error="user_stop"),
        ev("run", run_id="r1", status="cancelled", reason="user_stop",
           summary={"turns": 2, "model_requests": 3, "tool_calls": 1, "prompt_tokens": 100,
                    "completion_tokens": 10, "cached_tokens": None, "duration_ms": 5}),
        ev("error", error="boom"),
    ]
    runs = [{"run_id": "r1", "status": "cancelled", "reason": "user_stop", "turns": 2, "model_requests": 3,
             "tool_calls": 1, "prompt_tokens": 100, "completion_tokens": 10, "cached_tokens": None}]
    metrics = compute_metrics({"runs": runs, "events": events})
    assert (metrics["model_calls"], metrics["turns"]) == (3, 2)
    assert metrics["usage_unavailable_calls"] == 1
    assert (metrics["prompt_tokens"], metrics["completion_tokens"]) == (100, 10)
    assert metrics["tool_calls"] == 1
    assert metrics["tool_calls_by_name"] == {"shell_execute": 1}
    assert metrics["tool_calls_unfinished"] == 1
    assert metrics["metrics_consistent"] and metrics["unpaired_turns"] == 0
    assert metrics["runs"] == [{"run_id": "r1", "status": "cancelled", "reason": "user_stop", "source": "summary"}]
    assert metrics["error_events"] == ["boom"]

    events[-2]["data"]["summary"]["model_requests"] = 4
    broken = compute_metrics({"runs": runs, "events": events})
    assert not broken["metrics_consistent"]
    assert broken["metric_mismatches"] == ["model_requests: 运行汇总 4 ≠ 逐轮 3"]

    summary = events[-2]["data"]["summary"]
    summary.update(prompt_tokens=150, completion_tokens=15)
    events.insert(6, ev("compact", trigger="watermark", usage={"attempts": 1, "prompt_tokens": 50,
                                                               "completion_tokens": 5}))
    with_compact = compute_metrics({"runs": runs, "events": events})
    assert with_compact["metrics_consistent"], with_compact["metric_mismatches"]
    assert (with_compact["compactions"], with_compact["compaction_requests"]) == (1, 1)


def test_context_splits_turns_and_uses_last_assistant_message():
    ctx = RunContext(client=None, spec=build("E1"), run_index=1)
    ctx.session = {"events": [
        ev("message", role="user", message="记住青松"),
        ev("message", role="assistant", message="好的"),
        ev("done"),
        ev("message", role="user", message="校验词？"),
        ev("message", role="assistant", message="计划：回忆校验词青松"),
        ev("message", role="assistant", message="答案是松柏", attachments=[{"id": "f", "filename": "a.json"}]),
    ]}
    turns = ctx.turns()
    assert len(turns) == 2
    assert ctx.final_reply(turns[1]) == "答案是松柏"
    assert ctx.final_reply() == "答案是松柏"
    assert "青松" in ctx.assistant_text(turns[1])
    assert [f["filename"] for f in ctx.delivered_files()] == ["a.json"]


def test_report_compares_runs_with_baseline_by_task_and_index(tmp_path):
    from scripts.eval.report import load_baseline, render_markdown

    def run(task_id, outcome, calls, seconds):
        return {"task_id": task_id, "title": task_id, "run_index": 1, "outcome": outcome, "wall_seconds": seconds,
                "model_calls": calls, "prompt_tokens": calls * 100, "completion_tokens": calls * 10,
                "tool_calls": 1, "session_id": f"s-{task_id}", "checks": []}

    meta = {"label": "w0", "date": "2026-09-28", "git": {"commit": "abc", "short": "abc", "dirty": []},
            "base_url": "x", "host_address": "h", "llm_config": {}, "agent_config": {}, "repeat": 1,
            "started_at": "t0", "finished_at": "t1"}
    path = tmp_path / "base.json"
    path.write_text(json.dumps({"meta": meta, "runs": [run("E1", "failed", 5, 30.0)]}), encoding="utf-8")
    baseline = load_baseline(path)
    assert baseline["runs"][0]["model_calls"] == 5 and "checks" not in baseline["runs"][0]

    text = render_markdown({"meta": {**meta, "label": "w1"}, "baseline": baseline,
                            "runs": [run("E1", "passed", 2, 12.5), run("E2", "passed", 3, 20.0)]})
    assert "## 与基线对比（w0" in text
    assert "| E1 | 1 | 通过 / 未通过 | 12.5（基线 30.0，-17.5） | 2（基线 5，-3） |" in text
    assert "| E2 | 1 | 通过 / — |" in text
