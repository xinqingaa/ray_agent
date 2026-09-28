"""评测报告：JSON 原始数据与 Markdown 汇总。"""
import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from .fixtures import API_DIR

REPO_DIR = API_DIR.parents[1]
EVIDENCE_DIR = REPO_DIR / "docs" / "plan" / "evidence"

OUTCOME_TEXT = {"passed": "通过", "failed": "未通过", "skipped": "跳过", "error": "运行出错"}


def git_info() -> Dict[str, Any]:
    def run(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=REPO_DIR, capture_output=True, text=True, check=True).stdout.strip()

    dirty = [line for line in run("status", "--porcelain").splitlines() if line]
    return {"commit": run("rev-parse", "HEAD"), "short": run("rev-parse", "--short", "HEAD"), "dirty": dirty}


def report_paths(output_dir: Path, label: str, date: str, short_hash: str) -> Dict[str, Path]:
    stem = f"{label}-{date}-{short_hash}"
    return {"json": output_dir / f"{stem}.json", "md": output_dir / f"{stem}.md"}


def _cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _tools(counts: Dict[str, int]) -> str:
    return "、".join(f"{name}×{count}" for name, count in counts.items()) or "—"


def load_baseline(path: Path) -> Dict[str, Any]:
    """读取另一份评测 JSON，只保留对比所需的元数据与各次运行指标。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    keys = ("task_id", "title", "run_index", "outcome", "wall_seconds", "model_calls",
            "prompt_tokens", "completion_tokens", "tool_calls", "session_id")
    return {
        "path": str(path.resolve().relative_to(REPO_DIR)) if path.resolve().is_relative_to(REPO_DIR) else str(path),
        "label": data["meta"]["label"],
        "commit": data["meta"]["git"]["short"],
        "runs": [{k: run.get(k) for k in keys} for run in data["runs"]],
    }


def _delta(current: Any, base: Any) -> str:
    if not isinstance(current, (int, float)) or not isinstance(base, (int, float)):
        return f"{current}（基线 {base}）"
    diff = current - base
    diff_text = f"{diff:+.1f}" if isinstance(diff, float) else f"{diff:+d}"
    return f"{current}（基线 {base}，{diff_text}）"


def _render_baseline(runs: List[Dict[str, Any]], baseline: Dict[str, Any]) -> List[str]:
    """按任务与运行序号配对；本次或基线缺少的一方显示为「—」。"""
    base_runs = {(r["task_id"], r["run_index"]): r for r in baseline["runs"]}
    lines = [
        "",
        f"## 与基线对比（{baseline['label']}，`{baseline['commit']}`，{baseline['path']}）",
        "",
        "| 任务 | 次 | 结论（本次 / 基线） | 耗时 s | 模型调用 | prompt tokens | completion tokens | 工具调用 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for run in runs:
        base = base_runs.get((run["task_id"], run["run_index"]))
        if base is None:
            lines.append(f"| {run['task_id']} | {run['run_index']} | {OUTCOME_TEXT.get(run['outcome'], run['outcome'])} / — | — | — | — | — | — |")
            continue
        outcome = f"{OUTCOME_TEXT.get(run['outcome'], run['outcome'])} / {OUTCOME_TEXT.get(base['outcome'], base['outcome'])}"
        lines.append(
            f"| {run['task_id']} | {run['run_index']} | {outcome} "
            f"| {_delta(run.get('wall_seconds'), base.get('wall_seconds'))} "
            f"| {_delta(run.get('model_calls'), base.get('model_calls'))} "
            f"| {_delta(run.get('prompt_tokens'), base.get('prompt_tokens'))} "
            f"| {_delta(run.get('completion_tokens'), base.get('completion_tokens'))} "
            f"| {_delta(run.get('tool_calls'), base.get('tool_calls'))} |"
        )
    return lines


def render_markdown(report: Dict[str, Any]) -> str:
    meta = report["meta"]
    llm, agent = meta["llm_config"], meta["agent_config"]
    lines: List[str] = [
        f"# 评测报告：{meta['label']}（{meta['date']}，`{meta['git']['short']}`）",
        "",
        "由 `scripts/eval` 生成；原始数据见同名 JSON。评测通过公开 HTTP API 与 SSE 驱动完整产品，"
        "指标取自 `GET /sessions/{id}` 读回的持久化事件：模型调用次数按 usage 事件计数，"
        "工具调用次数按 `called` 工具事件计数。",
        "",
        "## 运行条件",
        "",
        "| 项 | 值 |",
        "|---|---|",
        f"| 代码提交 | `{meta['git']['commit']}` |",
        f"| 未提交变更 | {_cell('、'.join(meta['git']['dirty']) or '无')} |",
        f"| API 地址 | {meta['base_url']} |",
        f"| 沙箱访问宿主机地址 | {meta['host_address']} |",
        f"| 模型 | {llm.get('model_name')}（{llm.get('base_url')}） |",
        f"| temperature / max_tokens / context_window | {llm.get('temperature')} / {llm.get('max_tokens')} / {llm.get('context_window')} |",
        f"| Agent 配置 | max_iterations={agent.get('max_iterations')}，max_retries={agent.get('max_retries')}，max_search_results={agent.get('max_search_results')} |",
        f"| 开始前已配置的 MCP 服务 | {_cell(meta.get('mcp_servers_before') or '无')} |",
        f"| 每任务运行次数 | {meta['repeat']} |",
        f"| 开始 / 结束 | {meta['started_at']} / {meta['finished_at']} |",
        "",
        "## 汇总",
        "",
        "| 任务 | 次 | 结论 | 会话状态 / 最后终止事件 | 耗时 s | 模型调用 | prompt / completion tokens | 工具调用 | 工具分布 | 会话 ID |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for run in report["runs"]:
        lines.append(
            f"| {run['task_id']} {run['title']} | {run['run_index']} | {OUTCOME_TEXT.get(run['outcome'], run['outcome'])} "
            f"| {run.get('session_status')} / {run.get('last_terminal_event')} | {run.get('wall_seconds')} "
            f"| {run.get('model_calls')} | {run.get('prompt_tokens')} / {run.get('completion_tokens')} "
            f"| {run.get('tool_calls')} | {_cell(_tools(run.get('tool_calls_by_name', {})))} | `{run.get('session_id')}` |"
        )
    baseline = report.get("baseline")
    if baseline:
        lines += _render_baseline(report["runs"], baseline)
    lines += ["", "## 逐条结果", ""]
    for run in report["runs"]:
        lines.append(f"### {run['task_id']} {run['title']}（第 {run['run_index']} 次）：{OUTCOME_TEXT.get(run['outcome'], run['outcome'])}")
        lines.append("")
        if run.get("skip_reason"):
            lines.append(f"- 跳过：{run['skip_reason']}")
        if run.get("error"):
            lines.append(f"- 运行出错：{_cell(run['error'])}")
        for check in run.get("checks", []):
            mark = "✅" if check["passed"] else "❌"
            suffix = "" if check["required"] else "（不计入结论）"
            lines.append(f"- {mark} {check['name']}{suffix}：{_cell(check['detail'])}")
        if run.get("usage_unavailable_calls"):
            lines.append(f"- usage 不可用的模型调用：{run['usage_unavailable_calls']} 次")
        if run.get("tool_calls_unfinished"):
            lines.append(f"- 只有 calling 没有 called 的工具调用：{run['tool_calls_unfinished']} 次")
        for error in run.get("error_events", []):
            lines.append(f"- 错误事件：{_cell(error)}")
        if run.get("final_reply"):
            lines.append(f"- 最后一轮最后一条助手消息（截断）：{_cell(run['final_reply'][:300])}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_report(report: Dict[str, Any], output_dir: Path = EVIDENCE_DIR) -> Dict[str, Path]:
    meta = report["meta"]
    paths = report_paths(output_dir, meta["label"], meta["date"], meta["git"]["short"])
    output_dir.mkdir(parents=True, exist_ok=True)
    paths["json"].write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    paths["md"].write_text(render_markdown(report), encoding="utf-8")
    return paths
