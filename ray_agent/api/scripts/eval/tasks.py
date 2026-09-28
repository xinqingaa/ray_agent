"""E1–E6 基线评测任务，定义见 docs/plan/w0-baseline-eval.md。W2 在此追加 E7。"""
import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from .client import ApiError
from .fixtures import MCPFixtureProcess, StaticPageServer
from .spec import CheckResult, ReplyOnWait, RunContext, SkipTask, StopAfter, TaskSpec, register

UPLOAD_DIR = "/home/ubuntu/upload"
SOURCE_CSV = b"item,amount\na,12\nb,18\nc,30\n"


async def _download_delivered(ctx: RunContext, filename: str) -> Tuple[Optional[Dict[str, Any]], Optional[bytes], str]:
    """在助手消息附件中按文件名查找并下载最后一份；返回 (文件信息, 字节, 说明)。"""
    matches = [f for f in ctx.delivered_files() if f.get("filename") == filename]
    if not matches:
        names = sorted({f.get("filename", "") for f in ctx.delivered_files()})
        return None, None, f"助手消息附件中没有 {filename}；实际附件：{names or '无'}"
    info = matches[-1]
    try:
        return info, await ctx.client.download_file(info["id"]), f"文件 ID {info['id']}"
    except ApiError as e:
        return info, None, str(e)


def _parse_json(data: Optional[bytes]) -> Tuple[Any, str]:
    if data is None:
        return None, "未下载到内容"
    try:
        return json.loads(data.decode("utf-8")), ""
    except (UnicodeDecodeError, ValueError) as e:
        return None, f"JSON 解析失败：{e}；内容前 200 字节：{data[:200]!r}"


def _tool_summary(events: List[Dict[str, Any]]) -> List[str]:
    return [e["data"].get("function", "") for e in events
            if e["event"] == "tool" and e["data"].get("status") == "called"]


# ---------------- E1 纯回答与跨轮记忆 ----------------

async def _check_e1(ctx: RunContext) -> List[CheckResult]:
    turns = ctx.turns()
    if len(turns) < 2:
        return [CheckResult("第二轮已执行", False, f"只记录到 {len(turns)} 轮用户消息")]
    reply = ctx.final_reply(turns[1])
    first_tools = _tool_summary(turns[0])
    return [
        CheckResult("第二轮最终回复含“青松”", "青松" in reply, f"第二轮最后一条助手消息：{reply[:200]!r}"),
        CheckResult("第二轮任一助手消息含“青松”（只记录）", "青松" in ctx.assistant_text(turns[1]),
                    f"第二轮助手消息 {len(ctx.assistant_messages(turns[1]))} 条", required=False),
        CheckResult("第一轮工具调用（只记录）", True, f"{len(first_tools)} 次：{first_tools}", required=False),
    ]


@register("E1")
def e1() -> TaskSpec:
    return TaskSpec(
        id="E1",
        title="纯回答与跨轮记忆",
        turns=[
            "请记住：本会话的校验词是“青松”。只需确认你已记住，不需要做其他事情。",
            "本会话的校验词是什么？请直接回答。",
        ],
        check=_check_e1,
        timeout=600,
    )


# ---------------- E2 文件交付（V01） ----------------

async def _check_source_unchanged(ctx: RunContext) -> CheckResult:
    path = f"{UPLOAD_DIR}/source.csv"
    try:
        content = await ctx.client.read_sandbox_file(ctx.session_id, path)
    except ApiError as e:
        return CheckResult("源文件未被修改", False, f"读取 {path} 失败：{e}")
    same = content.encode("utf-8") == SOURCE_CSV
    return CheckResult("源文件未被修改", same, f"经会话文件接口读取 {path}，与上传字节{'一致' if same else '不一致'}：{content[:120]!r}")


async def _check_e2(ctx: RunContext) -> List[CheckResult]:
    info, data, note = await _download_delivered(ctx, "summary.json")
    results = [CheckResult("交付 summary.json 并可下载", data is not None, note)]
    parsed, error = _parse_json(data)
    total = parsed.get("total") if isinstance(parsed, dict) else None
    ok = isinstance(total, int) and not isinstance(total, bool) and total == 60
    detail = error or f"total={total!r}（{type(total).__name__}）；内容：{json.dumps(parsed, ensure_ascii=False)[:200]}"
    results.append(CheckResult("summary.json 的 total 为整数 60", ok, detail))
    results.append(await _check_source_unchanged(ctx))
    return results


@register("E2")
def e2() -> TaskSpec:
    return TaskSpec(
        id="E2",
        title="文件交付（V01）",
        materials={"source.csv": SOURCE_CSV},
        turns=[
            "附件 source.csv 是一份清单。请统计 amount 列的总和，把结果写成 summary.json"
            "（JSON 对象，总和放在 total 字段），并把 summary.json 作为附件提供给我下载。不要修改 source.csv。",
        ],
        check=_check_e2,
        timeout=900,
    )


# ---------------- E3 提问续接 ----------------

E3_FILENAME = "e3_answer.json"
E3_CONTENT = {"status": "ok", "count": 3}


async def _check_e3(ctx: RunContext) -> List[CheckResult]:
    events = ctx.events
    wait_index = next((i for i, e in enumerate(events) if e["event"] == "wait"), None)
    replies = [i for i in ctx.interactions if i["kind"] == "reply"]
    results = [CheckResult(
        "出现提问并等待", wait_index is not None and bool(replies),
        f"wait 事件{'出现' if wait_index is not None else '未出现'}；已回复 {len(replies)} 次",
    )]
    if wait_index is not None:
        early = [e["data"].get("function") for e in events[:wait_index]
                 if e["event"] == "tool" and e["data"].get("status") == "called"
                 and e["data"].get("function") in ("write_file", "shell_execute", "replace_in_file")]
        results.append(CheckResult("提问前未写文件（只记录）", not early, f"提问前的写入类调用：{early}", required=False))
    _, data, note = await _download_delivered(ctx, E3_FILENAME)
    results.append(CheckResult(f"回复后交付 {E3_FILENAME}", data is not None, note))
    parsed, error = _parse_json(data)
    results.append(CheckResult(
        "交付内容正确", parsed == E3_CONTENT,
        error or f"内容：{json.dumps(parsed, ensure_ascii=False)[:200]}",
    ))
    return results


@register("E3")
def e3() -> TaskSpec:
    return TaskSpec(
        id="E3",
        title="提问续接",
        turns=[
            "请生成一个 JSON 文件，内容是 {\"status\": \"ok\", \"count\": 3}，并作为附件交付给我。"
            "文件名我还没告诉你：在创建文件之前，必须先询问我要用什么文件名，得到答复后再创建和交付。",
        ],
        on_wait=ReplyOnWait(replies=[f"文件名用 {E3_FILENAME}"]),
        check=_check_e3,
        timeout=900,
    )


# ---------------- E4 长命令与停止 ----------------

E4_MARKS = "/home/ubuntu/e4_marks.txt"
E4_SAMPLE_SECONDS = 10
E4_GROWTH_WINDOW = 5


def _e4_long_command_started(event_type: str, data: Dict[str, Any]) -> bool:
    return (event_type == "tool" and data.get("function") == "shell_execute"
            and data.get("status") == "calling" and "seq 1 300" in json.dumps(data.get("args", {})))


async def _count_marks(ctx: RunContext) -> Tuple[int, str]:
    try:
        content = await ctx.client.read_sandbox_file(ctx.session_id, E4_MARKS)
    except ApiError as e:
        return -1, str(e)
    return len([line for line in content.splitlines() if line.startswith("mark-")]), ""


async def _observe_e4(ctx: RunContext) -> None:
    samples = []
    base = asyncio.get_running_loop().time()
    for second in range(E4_SAMPLE_SECONDS + 1):
        await asyncio.sleep(max(0.0, base + second - asyncio.get_running_loop().time()))
        count, error = await _count_marks(ctx)
        samples.append({"t": second, "count": count, **({"error": error} if error else {})})
    ctx.observations["marks_after_stop"] = samples


async def _check_e4(ctx: RunContext) -> List[CheckResult]:
    if ctx.stop_requested_at is None:
        started = any(i["kind"] == "stop_trigger" for i in ctx.interactions)
        reason = "长命令已开始但对话在停止时刻前结束" if started else "未观察到执行长命令的 shell_execute 调用"
        return [CheckResult("已在命令运行中请求停止", False, f"{reason}，未发出停止；工具调用：{_tool_summary(ctx.events)}")]
    samples = ctx.observations.get("marks_after_stop", [])
    by_t = {s["t"]: s["count"] for s in samples}
    start, window = by_t.get(0, -1), by_t.get(E4_GROWTH_WINDOW, -1)
    series = ", ".join(f"{s['t']}s:{s['count']}" for s in samples)
    last_terminal = next((e["event"] for e in reversed(ctx.events) if e["event"] in ("done", "error", "wait")), None)
    after_stop = [i for i in ctx.interactions if i["kind"] == "sse_end" and i.get("after_stop")]
    return [
        CheckResult("已在命令运行中请求停止", True, f"停止请求时刻：开始后 {ctx.stop_requested_at:.1f}s"),
        CheckResult("停止前标记已开始写入", start > 0, f"停止时标记数 {start}"),
        CheckResult(
            f"停止后 {E4_GROWTH_WINDOW} 秒内标记不再增长", start >= 0 and window == start,
            f"增长 {window - start if start >= 0 and window >= 0 else '未知'} 行；采样（停止后秒数:行数）{series}",
        ),
        CheckResult(
            "终态（只记录）", True,
            f"会话状态 {ctx.session.get('status')}；最后终止事件 {last_terminal}；"
            f"停止后 SSE {'已结束：' + after_stop[0].get('terminal', '') if after_stop else '未在停止后结束'}",
            required=False,
        ),
    ]


@register("E4")
def e4() -> TaskSpec:
    return TaskSpec(
        id="E4",
        title="长命令与停止",
        turns=[
            "请在沙箱中用 shell 前台执行下面这条命令并等待它结束（不要加 &，不要改写命令）：\n"
            f"for i in $(seq 1 300); do echo mark-$i >> {E4_MARKS}; sleep 1; done\n"
            f"结束后告诉我 {E4_MARKS} 的行数。",
        ],
        stop=StopAfter(seconds=8, trigger=_e4_long_command_started, observe=_observe_e4),
        check=_check_e4,
        timeout=600,
    )


# ---------------- E5 浏览器取事实 ----------------

E5_CODE = "QX-7319-LM"
E5_PAGE = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>RayAgent 评测页面 E5</title></head>
<body>
<h1>订单核对单</h1>
<table border="1">
<tr><th>项目</th><th>值</th></tr>
<tr><td>订单号</td><td>RA-E5-2026</td></tr>
<tr><td>负责人</td><td>林澈</td></tr>
<tr><td>校验码</td><td>{E5_CODE}</td></tr>
</table>
</body></html>
"""


@asynccontextmanager
async def _e5_environment(ctx: RunContext) -> AsyncIterator[None]:
    server = StaticPageServer({"/e5.html": E5_PAGE})
    server.start()
    ctx.env["page_url"] = f"http://{ctx.env['host_address']}:{server.port}/e5.html"
    ctx.env["page_server"] = server
    try:
        yield
    finally:
        ctx.observations["page_requests"] = list(server.requests)
        server.stop()


async def _check_e5(ctx: RunContext) -> List[CheckResult]:
    server: StaticPageServer = ctx.env["page_server"]
    url = ctx.env["page_url"]
    hits = [r for r in server.requests if r["path"].startswith("/e5.html")]
    attempted = [e for e in ctx.tool_events() if url.split("/e5.html")[0] in json.dumps(e.get("args", {}))]
    if not hits and attempted:
        raise SkipTask(f"沙箱访问 {url} 未到达评测页面服务（Agent 已尝试 {len(attempted)} 次），沙箱到宿主机网络不可达")
    reply = ctx.final_reply()
    return [
        CheckResult("最终回复含页面校验码", E5_CODE in reply, f"最后一条助手消息：{reply[:200]!r}"),
        CheckResult("评测页面被访问（只记录）", bool(hits), f"页面请求 {len(hits)} 次，来源 {sorted({r['client'] for r in hits})}", required=False),
    ]


@register("E5")
def e5() -> TaskSpec:
    return TaskSpec(
        id="E5",
        title="浏览器取事实",
        environment=_e5_environment,
        turns=[lambda ctx: f"请用浏览器打开 {ctx.env['page_url']} ，读取页面上“校验码”一栏的值，并直接告诉我这个值。"],
        check=_check_e5,
        timeout=600,
    )


# ---------------- E6 MCP 调用 ----------------

E6_SERVER = "w0eval"
E6_A, E6_B = 1234, 5678


@asynccontextmanager
async def _e6_environment(ctx: RunContext) -> AsyncIterator[None]:
    fixture = MCPFixtureProcess()
    await fixture.start()
    client = ctx.client
    url = f"http://{ctx.env['host_address']}:{fixture.port}/mcp"
    ctx.env["mcp_url"] = url
    try:
        existing = {s["server_name"] for s in await client.list_mcp_servers()}
        if E6_SERVER in existing:
            await client.delete_mcp_server(E6_SERVER)
        await client.add_mcp_servers({"mcpServers": {E6_SERVER: {"transport": "streamable_http", "url": url}}})
        server = next((s for s in await client.list_mcp_servers() if s["server_name"] == E6_SERVER), None)
        ctx.observations["mcp_server_status"] = server
        if not server or server.get("connection_status") != "connected" or "add" not in " ".join(server.get("tools", [])):
            raise SkipTask(f"API 未能连接 MCP 夹具 {url}：{server}")
        ctx.env["mcp_fixture"] = fixture
        yield
    finally:
        ctx.observations["mcp_fixture_calls"] = fixture.calls()
        try:
            await client.delete_mcp_server(E6_SERVER)
        except ApiError as e:
            ctx.observations["mcp_cleanup_error"] = str(e)
        fixture.stop()


async def _check_e6(ctx: RunContext) -> List[CheckResult]:
    expected = str(E6_A + E6_B)
    reply = ctx.final_reply()
    mcp_calls = [e for e in ctx.tool_events() if e.get("name") == "mcp"]
    add_calls = [e for e in mcp_calls if "add" in e.get("function", "")]
    succeeded = [e for e in add_calls if ((e.get("content") or {}).get("outcome") or {}).get("success")]
    fixture_calls = [c for c in ctx.env["mcp_fixture"].calls() if c.get("method") == "add"]
    return [
        CheckResult("最终回复含正确结果", expected in reply, f"期望 {expected}；最后一条助手消息：{reply[:200]!r}"),
        CheckResult(
            "有对应 MCP 工具事件", bool(succeeded),
            f"MCP 工具事件 {len(mcp_calls)} 条，add 调用 {len(add_calls)} 条，成功 {len(succeeded)} 条；"
            f"参数 {[e.get('args') for e in add_calls]}",
        ),
        CheckResult("夹具收到 add 调用（只记录）", bool(fixture_calls), f"{fixture_calls}", required=False),
    ]


@register("E6")
def e6() -> TaskSpec:
    return TaskSpec(
        id="E6",
        title="MCP 调用",
        environment=_e6_environment,
        turns=[f"请使用 MCP 工具中的 add 工具计算 {E6_A} 与 {E6_B} 的和，并告诉我结果。"],
        check=_check_e6,
        timeout=600,
    )
