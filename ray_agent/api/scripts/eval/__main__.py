"""命令行入口：在 ray_agent/api/ 执行 ``uv run --locked python -m scripts.eval --help``。"""
import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

from . import tasks  # noqa: F401  注册 E1–E7
from .client import RayAgentClient
from .report import EVIDENCE_DIR, OUTCOME_TEXT, git_info, load_baseline, write_report
from .runner import EvalRunner
from .spec import build, registered_ids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m scripts.eval", description="RayAgent 端到端评测")
    parser.add_argument("--base-url", default="http://localhost:8088/api", help="API 地址（默认经 Compose 网关）")
    parser.add_argument("--tasks", default="all", help="逗号分隔的任务 ID，如 E1,E3；默认全部")
    parser.add_argument("--repeat", type=int, default=1, help="每条任务运行次数")
    parser.add_argument("--label", default="eval", help="报告文件名前缀，文件名为 <label>-<日期>-<提交短哈希>")
    parser.add_argument("--host-address", default="host.docker.internal",
                        help="API 与沙箱容器访问宿主机评测服务的地址（Docker Desktop 默认值）")
    parser.add_argument("--output-dir", type=Path, default=EVIDENCE_DIR, help="报告目录，默认 docs/plan/evidence/")
    parser.add_argument("--baseline", type=Path, help="作对比的另一份评测 JSON，报告按任务与运行序号列出指标差异")
    parser.add_argument("--list", action="store_true", help="只列出已注册任务")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    ids = registered_ids()
    if args.list:
        for task_id in ids:
            print(f"{task_id}\t{build(task_id).title}")
        return 0
    selected = ids if args.tasks == "all" else [t.strip() for t in args.tasks.split(",") if t.strip()]
    unknown = [t for t in selected if t not in ids]
    if unknown:
        print(f"未注册的任务：{unknown}；可选 {ids}", file=sys.stderr)
        return 2

    async with RayAgentClient(args.base_url) as client:
        await client.status()
        meta = {
            "label": args.label,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "git": git_info(),
            "base_url": args.base_url,
            "host_address": args.host_address,
            "llm_config": await client.get_llm_config(),
            "agent_config": await client.get_agent_config(),
            "mcp_servers_before": [s["server_name"] for s in await client.list_mcp_servers()],
            "repeat": args.repeat,
            "tasks": selected,
            "started_at": datetime.now().isoformat(timespec="seconds"),
        }
        runner = EvalRunner(client, args.host_address)
        runs = []
        for task_id in selected:
            for index in range(1, args.repeat + 1):
                print(f"[{datetime.now():%H:%M:%S}] 运行 {task_id} 第 {index} 次 ...", flush=True)
                run = await runner.run(build(task_id), index)
                runs.append(run)
                reason = run.get("skip_reason") or run.get("error") or ""
                print(f"    {OUTCOME_TEXT.get(run['outcome'], run['outcome'])}  会话 {run['session_id']}  "
                      f"{run['wall_seconds']}s  模型调用 {run['model_calls']}  工具调用 {run['tool_calls']}  {reason}",
                      flush=True)
        meta["finished_at"] = datetime.now().isoformat(timespec="seconds")

    report = {"meta": meta, "runs": runs}
    if args.baseline:
        report["baseline"] = load_baseline(args.baseline)
    paths = write_report(report, args.output_dir)
    print(f"报告：{paths['md']}\n原始数据：{paths['json']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
