"""E1–E6 基线评测任务（定义见 docs/plan/w0-baseline-eval.md）、W2 的 E7（见 docs/plan/w2-context.md）
与 W7.2 的 E6-deny（见 docs/plan/w7-control-safety.md）。"""
import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from .client import ApiError
from .fixtures import MCPFixtureProcess, StaticPageServer
from .spec import CheckResult, DecideOnApproval, ReplyOnWait, RunContext, SkipTask, StopAfter, TaskSpec, register

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
    stopped_id = next((i.get("run_id") for i in ctx.interactions if i["kind"] == "stop_returned"), None)
    stopped = next((r for r in ctx.runs if r.get("run_id") == stopped_id), {})
    after_stop = [i for i in ctx.interactions if i["kind"] == "sse_end" and i.get("after_stop")]
    cleanup = [t for e in ctx.events if e["event"] == "cleanup" and e["data"].get("run_id") == stopped_id
               for t in e["data"].get("targets") or []]
    return [
        CheckResult("已在命令运行中请求停止", True, f"停止请求时刻：开始后 {ctx.stop_requested_at:.1f}s"),
        CheckResult("停止前标记已开始写入", start > 0, f"停止时标记数 {start}"),
        CheckResult(
            f"停止后 {E4_GROWTH_WINDOW} 秒内标记不再增长", start >= 0 and window == start,
            f"增长 {window - start if start >= 0 and window >= 0 else '未知'} 行；采样（停止后秒数:行数）{series}",
        ),
        CheckResult(
            "运行终态为 cancelled（user_stop）",
            stopped.get("status") == "cancelled" and stopped.get("reason") == "user_stop"
            and ctx.session.get("status") == "cancelled",
            f"被停止的运行 {(stopped_id or '未知')[:8]}：{stopped.get('status')}（{stopped.get('reason')}）；"
            f"会话状态 {ctx.session.get('status')}；"
            f"停止后事件流 {'已结束：' + after_stop[0].get('terminal', '') if after_stop else '未在停止后结束'}",
        ),
        CheckResult(
            "Shell 终止请求（只记录）", True,
            "；".join(f"{t.get('kind')} {t.get('id')} success={t.get('success')} {t.get('message', '')[:80]}"
                     for t in cleanup) or "无 cleanup 事件",
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
E6_APPROVAL_RULE = f"mcp:{E6_SERVER}:*"


@asynccontextmanager
async def _e6_approval_policy(ctx: RunContext) -> AsyncIterator[None]:
    """夹具服务的调用一律需要审批（清掉该服务更具体的规则）；结束后恢复原策略表。"""
    client = ctx.client
    original = (await client.get_tool_policy())["rules"]
    rules = {k: v for k, v in original.items() if not k.startswith(f"mcp:{E6_SERVER}:")}
    rules[E6_APPROVAL_RULE] = "ask"
    await client.update_tool_policy(rules)
    ctx.observations["tool_policy"] = rules
    try:
        yield
    finally:
        try:
            await client.update_tool_policy(original)
        except ApiError as e:
            ctx.observations["tool_policy_restore_error"] = str(e)


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
        async with _e6_approval_policy(ctx):
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
        _check_e6_approval(ctx, "approved"),
    ]


def _e6_add_approvals(ctx: RunContext) -> Dict[str, List[str]]:
    """夹具 add 调用的审批状态序列，按 tool_call_id 分组。"""
    by_call: Dict[str, List[str]] = {}
    for data in ctx.approval_events():
        if data.get("service") == E6_SERVER and data.get("service_tool") == "add":
            by_call.setdefault(data.get("tool_call_id"), []).append(data.get("status"))
    return by_call


def _check_e6_approval(ctx: RunContext, decided: str) -> CheckResult:
    by_call = _e6_add_approvals(ctx)
    return CheckResult(
        f"add 调用先请求审批、再按答复{'执行' if decided == 'approved' else '拒绝'}",
        bool(by_call) and all(statuses[:2] == ["pending", decided] for statuses in by_call.values()),
        f"审批状态 {by_call}；规则 {E6_APPROVAL_RULE}=ask",
    )


E6_TURN = f"请使用 MCP 工具中的 add 工具计算 {E6_A} 与 {E6_B} 的和，并告诉我结果。"


@register("E6")
def e6() -> TaskSpec:
    return TaskSpec(
        id="E6",
        title="MCP 调用（审批通过）",
        environment=_e6_environment,
        turns=[E6_TURN],
        on_approval=DecideOnApproval(["approve", "approve", "approve"]),
        check=_check_e6,
        timeout=600,
    )


async def _check_e6_deny(ctx: RunContext) -> List[CheckResult]:
    reply = ctx.final_reply()
    add_calls = [e for e in ctx.tool_events() if e.get("name") == "mcp" and "add" in e.get("function", "")]
    rejected = [e for e in add_calls if e.get("denied_by") == "user"]
    executed = [e for e in add_calls if not e.get("denied_by")]
    fixture_calls = [c for c in ctx.env["mcp_fixture"].calls() if c.get("method") == "add"]
    last_run = ctx.runs[-1] if ctx.runs else {}
    return [
        _check_e6_approval(ctx, "rejected"),
        CheckResult("被拒绝的 add 调用记为用户拒绝、没有执行", bool(rejected) and not executed,
                    f"add 结束事件 {len(add_calls)} 条，用户拒绝 {len(rejected)} 条，实际执行 {len(executed)} 条"),
        CheckResult("夹具没有收到 add 调用", not fixture_calls, f"{fixture_calls}"),
        CheckResult("运行在拒绝后继续并正常结束", last_run.get("status") == "completed",
                    f"最后一个运行 {last_run.get('status')}/{last_run.get('reason')}"),
        CheckResult("最终回复向用户说明（只记录）", bool(reply.strip()), f"{reply[:200]!r}", required=False),
    ]


@register("E6-deny")
def e6_deny() -> TaskSpec:
    return TaskSpec(
        id="E6-deny",
        title="MCP 调用（审批拒绝）",
        environment=_e6_environment,
        turns=[E6_TURN],
        on_approval=DecideOnApproval(["deny", "deny"]),
        check=_check_e6_deny,
        timeout=600,
    )


# ---------------- E7 长上下文压缩（改编自 V05） ----------------

E7_MATERIALS = 12
E7_CODES = [f"K7-{(i * 7919 + 1301) % 9000 + 1000}" for i in range(1, E7_MATERIALS + 1)]
E7_CONTEXT_WINDOW = 24576  # 调低窗口使压缩稳定发生；只在本任务期间生效，结束后恢复
E7_MAX_TOKENS = 4096
E7_SENTENCE = "这是评测材料的正文段落，内容本身不需要记住，只用于占用上下文空间。"


def _e7_material(index: int) -> bytes:
    """约 1,800 个中文字符；校验码放在中段，必须读到正文才能取得。"""
    lines = [f"材料 m{index:02d}"]
    for line in range(60):
        if line == 30:
            lines.append(f"本份材料的校验码：{E7_CODES[index - 1]}")
        lines.append(f"{line + 1:02d}. {E7_SENTENCE}")
    return ("\n".join(lines) + "\n").encode("utf-8")


@asynccontextmanager
async def _e7_environment(ctx: RunContext) -> AsyncIterator[None]:
    original = await ctx.client.get_llm_config()
    override = {**{k: original[k] for k in ("base_url", "model_name", "temperature")},
                "max_tokens": E7_MAX_TOKENS, "context_window": E7_CONTEXT_WINDOW}
    await ctx.client.update_llm_config(override)
    ctx.observations["llm_config_override"] = {"context_window": E7_CONTEXT_WINDOW, "max_tokens": E7_MAX_TOKENS,
                                               "restored_to": {k: original[k] for k in ("context_window", "max_tokens")}}
    try:
        yield
    finally:
        restore = {k: original[k] for k in ("base_url", "model_name", "temperature", "max_tokens", "context_window")}
        await ctx.client.update_llm_config(restore)


async def _check_e7(ctx: RunContext) -> List[CheckResult]:
    compacts = [e["data"] for e in ctx.events if e["event"] == "compact"]
    override = ctx.observations.get("llm_config_override", {})
    results = [
        CheckResult("发生过压缩", bool(compacts),
                    f"compact 事件 {len(compacts)} 条："
                    + "；".join(f"{c.get('trigger')} 摘要 {c.get('summarized_turns')} 轮/保留 {c.get('kept_turns')} 轮，"
                               f"估算 {(c.get('before_estimate') or {}).get('total')}→{(c.get('after_estimate') or {}).get('total')}，"
                               f"重新注入 {len(c.get('reinjected_event_seqs') or [])} 条"
                               for c in compacts)),
        CheckResult("评测配置（只记录）", True,
                    f"本任务期间 context_window={override.get('context_window')}、max_tokens={override.get('max_tokens')}，"
                    f"结束后恢复为 {override.get('restored_to')}", required=False),
    ]
    results.append(await _check_source_unchanged(ctx))
    info, data, note = await _download_delivered(ctx, "summary.json")
    results.append(CheckResult("交付 summary.json 并可下载", data is not None, note))
    parsed, error = _parse_json(data)
    total = parsed.get("source_total") if isinstance(parsed, dict) else None
    codes = parsed.get("codes") if isinstance(parsed, dict) else None
    results.append(CheckResult("source_total 为整数 60", isinstance(total, int) and not isinstance(total, bool)
                               and total == 60, error or f"source_total={total!r}"))
    results.append(CheckResult("codes 与 12 份材料的校验码按顺序一致", codes == E7_CODES,
                               error or f"期望 {E7_CODES}；实际 {codes}"))
    reads_after = []
    if compacts:
        first_compact = next(i for i, e in enumerate(ctx.events) if e["event"] == "compact")
        reads_after = [e["data"].get("args", {}).get("filepath", "") for e in ctx.events[first_compact:]
                       if e["event"] == "tool" and e["data"].get("status") == "called"
                       and e["data"].get("function") == "read_file"]
    results.append(CheckResult("首次压缩后的 read_file（只记录）", True, f"{len(reads_after)} 次：{reads_after}",
                               required=False))
    return results


@register("E7")
def e7() -> TaskSpec:
    materials = {"source.csv": SOURCE_CSV}
    materials.update({f"m{i:02d}.txt": _e7_material(i) for i in range(1, E7_MATERIALS + 1)})
    first_half = "、".join(f"m{i:02d}.txt" for i in range(1, 7))
    second_half = "、".join(f"m{i:02d}.txt" for i in range(7, 13))
    return TaskSpec(
        id="E7",
        title="长上下文压缩（V05）",
        materials=materials,
        environment=_e7_environment,
        turns=[
            "本会话的约束：不得覆盖或修改附件 source.csv。附件里还有 12 份材料 m01.txt 到 m12.txt，"
            "稍后我会让你逐份阅读。现在只需确认收到约束，不要做其他事情。",
            f"请在这一轮里用 read_file 依次完整读取 {first_half} 这 6 份材料（每次调用读一份，"
            "不要用 shell、grep 等方式只提取片段），6 份全部读完后再逐条报告每份的校验码。",
            f"继续用同样的方式在这一轮里依次完整读取 {second_half} 这 6 份，全部读完后逐条报告校验码。",
            "最后，请生成 summary.json（JSON 对象）：source_total 为 source.csv 中 amount 列之和（整数），"
            "codes 为 m01 到 m12 的校验码字符串数组（按文件顺序）。把 summary.json 作为附件交付给我。",
        ],
        check=_check_e7,
        timeout=1500,
    )
