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
    assert ids[:6] == ["E1", "E2", "E3", "E4", "E5", "E6"]
    assert sorted(["E10", "E7", "E2"], key=_order) == ["E2", "E7", "E10"]
    assert all(build(task_id).id == task_id for task_id in ids)


def test_chat_parses_sse_frames_with_crlf_comments_and_multiline_data():
    body = (
        ": ping\r\n\r\n"
        "event: message\r\ndata: {\"role\": \"user\", \"message\": \"中文\"}\r\n\r\n"
        "event: tool\r\ndata: {\"function\": \"read_file\",\r\ndata:  \"status\": \"called\"}\r\n\r\n"
        "event: done\r\ndata: {}\r\n\r\n"
    )
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, content=body.encode("utf-8"), headers={"content-type": "text/event-stream"})

    async def collect():
        client = RayAgentClient("http://test/api")
        client._http = httpx.AsyncClient(base_url="http://test/api", transport=httpx.MockTransport(handler))
        async with client:
            return [item async for item in client.chat("s1", "hi", ["f1"])]

    events = asyncio.run(collect())
    assert [e for e, _ in events] == ["message", "tool", "done"]
    assert events[0][1]["message"] == "中文"
    assert events[1][1] == {"function": "read_file", "status": "called"}
    assert seen["payload"]["attachments"] == ["f1"]


def test_metrics_count_usage_and_called_tools():
    events = [
        ev("message", role="user", message="q"),
        ev("usage", available=True, prompt_tokens=100, completion_tokens=10),
        ev("tool", tool_call_id="a", function="shell_execute", status="calling"),
        ev("tool", tool_call_id="a", function="shell_execute", status="called"),
        ev("usage", available=False),
        ev("tool", tool_call_id="b", function="shell_execute", status="calling"),
        ev("error", error="boom"),
    ]
    metrics = compute_metrics(events)
    assert metrics["model_calls"] == 2
    assert metrics["usage_unavailable_calls"] == 1
    assert (metrics["prompt_tokens"], metrics["completion_tokens"]) == (100, 10)
    assert metrics["tool_calls"] == 1
    assert metrics["tool_calls_by_name"] == {"shell_execute": 1}
    assert metrics["tool_calls_unfinished"] == 1
    assert metrics["error_events"] == ["boom"]


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
