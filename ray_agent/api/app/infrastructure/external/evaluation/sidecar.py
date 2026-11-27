"""对一份独立本机核心使用正常任务接口，进程寿命受评测批次控制。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Any

import httpx

from core.paths import RESOURCE_ROOT
from app.domain.models.evaluation import EvaluationMetrics

MAX_ARTIFACT_BYTES = 24 * 1024 * 1024
MAX_ARTIFACTS = 6
CASE_TIMEOUT = 420
STARTUP_TIMEOUT = 25
ACTIVE = {"running", "waiting"}


class EvaluationExecutionError(Exception):
    """评测页可以直接显示的执行失败。"""


@dataclass(frozen=True)
class CoreVersion:
    label: str
    command: tuple[str, ...]


@dataclass
class CaseRun:
    run: dict
    events: list[dict]
    files: dict[str, bytes]
    elapsed_ms: int
    timeout: bool = False

    def metrics(self) -> EvaluationMetrics:
        completed = [e["data"] for e in self.events if e["event"] == "turn" and e["data"].get("phase") == "completed"]
        usage = [turn.get("usage") or {} for turn in completed]
        usage.extend(e["data"].get("usage") or {} for e in self.events if e["event"] == "compact")
        measured = any(item.get("prompt_tokens") is not None for item in usage)
        terminal = next((e["data"].get("summary") or {} for e in reversed(self.events) if e["event"] == "run"), {})

        def total(key, items):
            values = [row[key] for row in items if isinstance(row.get(key), int)]
            return sum(values) if values else None

        return EvaluationMetrics(
            elapsed_ms=self.elapsed_ms,
            first_model_ms=next((t["ttft_ms"] for t in completed if t.get("ttft_ms") is not None), None),
            model_ms=total("model_ms", completed),
            tool_ms=total("tools_ms", completed),
            model_requests=terminal.get("model_requests", self.run.get("model_requests", 0)),
            tool_calls=terminal.get("tool_calls", self.run.get("tool_calls", 0)),
            input_tokens=self.run.get("prompt_tokens") if measured else None,
            output_tokens=self.run.get("completion_tokens") if measured else None,
            cost_nano_usd=total("cost_nano_usd", usage),
            cost_nano_cny=total("cost_nano_cny", usage),
        )


def available_versions() -> tuple[CoreVersion, CoreVersion | None]:
    from build_identity import read_manifest

    exe = sys.executable
    frozen = getattr(sys, "frozen", False)
    root = RESOURCE_ROOT
    manifest = read_manifest()
    revision = manifest.get("revision")
    current_name = revision[:7] if revision else "当前构建"
    if manifest.get("dirty"):
        current_name += " · 含本地改动"
    fingerprint = manifest.get("fingerprint")
    if fingerprint:
        current_name += f" · {fingerprint[:8]}"
    command = (exe,) if frozen else (exe, str(root / "sidecar.py"))
    candidate = CoreVersion(current_name, command)
    baseline_dir = os.environ.get("RAYAGENT_EVAL_BASELINE_API")
    if not baseline_dir or frozen:
        return candidate, None
    baseline = Path(baseline_dir).resolve()
    python = baseline / ".venv/bin/python"
    entry = baseline / "sidecar.py"
    if not python.is_file() or not entry.is_file() or baseline == root.resolve():
        return candidate, None
    label = os.environ.get("RAYAGENT_EVAL_BASELINE_LABEL") or "独立基准构建"
    return candidate, CoreVersion(label, (str(python), str(entry)))


class EvaluationCore:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.reasoning: str | None = None

    async def request(self, method, path, **kwargs) -> Any:
        response = await self.client.request(method, path, **kwargs)
        if response.is_success:
            return response.json()["data"]
        try:
            detail = response.json().get("error", {}).get("message")
        except ValueError:
            detail = None
        raise EvaluationExecutionError(f"核心接口 {path} 返回 {response.status_code}" + (f"（{detail}）" if detail else ""))

    async def model(self, model: str) -> dict:
        catalog = await self.request("GET", "/app-config/models")
        spec = next((item for item in catalog["models"] if item["id"] == model), None)
        if not spec or spec.get("connection_issue"):
            raise EvaluationExecutionError("评测核心没有可用的所选模型连接")
        return spec

    async def setup(self, model: str, sampling: dict) -> str:
        spec = await self.model(model)
        config = await self.request("GET", "/app-config/agent")
        config["standalone_execution_enabled"] = True
        await self.request("POST", "/app-config/agent", json=config)
        await self.request("PUT", "/skills/config", json={
            "discover_user": False,
            "discover_workspace": False,
            "disabled_groups": ["rayagent"],
        })
        await self.request("POST", "/app-config/llm", json={"model_profiles": {model: sampling}})
        self.reasoning = spec["default_choice"]
        llm = await self.request("GET", "/app-config/llm")
        actual = (llm.get("model_profiles") or {}).get(model) or {}
        conditions = {
            "model": model,
            "provider": spec.get("vendor"),
            "reasoning": self.reasoning,
            "temperature": actual.get("temperature"),
            "max_tokens": actual.get("max_tokens"),
            "context_window": actual.get("context_window"),
        }
        return hashlib.sha256(json.dumps(conditions, sort_keys=True).encode()).hexdigest()

    async def run(self, prompt: str, materials: dict[str, str], model: str) -> CaseRun:
        session = (await self.request("POST", "/sessions", json={}))["session_id"]
        attachments = []
        for name, content in materials.items():
            uploaded = await self.request("POST", "/files", files={"file": (name, content.encode(), "text/plain")})
            attachments.append(uploaded["id"])
        start = monotonic()
        accepted = await self.request("POST", f"/sessions/{session}/chat", json={
            "message": prompt, "attachments": attachments, "model": model, "reasoning": self.reasoning,
        })
        run_id = accepted["run_id"]
        expired = False
        while True:
            detail = await self.request("GET", f"/sessions/{session}")
            run = next((record for record in detail["runs"] if record["run_id"] == run_id), None)
            if run and (run["status"] not in ACTIVE or run["status"] == "waiting"):
                break
            if monotonic() - start >= CASE_TIMEOUT:
                expired = True
                break
            await asyncio.sleep(1.5)
        elapsed = int((monotonic() - start) * 1000)
        if expired or (run and run["status"] == "waiting"):
            await self.request("POST", f"/sessions/{session}/stop", json={})
        events = [event for event in detail["events"] if event["data"].get("run_id") == run_id]
        outputs = {}
        seen = set()
        total_bytes = 0
        for event in events:
            data = event["data"]
            if event["event"] != "message" or data.get("role") != "assistant":
                continue
            for item in data.get("attachments") or []:
                item_id = item["id"]
                size = item.get("size") or 0
                if item_id in seen or size + total_bytes > MAX_ARTIFACT_BYTES or len(seen) >= MAX_ARTIFACTS:
                    continue
                seen.add(item_id)
                response = await self.client.get(f"/files/{item_id}/download")
                if response.is_success and len(response.content) + total_bytes <= MAX_ARTIFACT_BYTES:
                    outputs[item["filename"]] = response.content
                    total_bytes += len(response.content)
        return CaseRun(run or {"run_id": run_id}, events, outputs, elapsed, expired)


@asynccontextmanager
async def open_core(version: CoreVersion, root: Path):
    process = await asyncio.create_subprocess_exec(
        *version.command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env={**os.environ, "PYINSTALLER_RESET_ENVIRONMENT": "1"} if getattr(sys, "frozen", False) else None,
    )
    try:
        launch = {"data_dir": str(root), "host_secret": secrets.token_urlsafe(32)}
        process.stdin.write(json.dumps(launch).encode() + b"\n")
        await process.stdin.drain()
        line = await asyncio.wait_for(process.stdout.readline(), STARTUP_TIMEOUT)
        handshake = json.loads(line)
        if not handshake.get("instance_token"):
            raise EvaluationExecutionError(f"{version.label} 核心启动失败")
        endpoint = f"http://127.0.0.1:{int(handshake['port'])}/api"
        async with httpx.AsyncClient(
            base_url=endpoint, headers={"Authorization": "Bearer " + handshake["instance_token"]}, timeout=20,
            trust_env=False,
        ) as client:
            yield EvaluationCore(client)
    except (asyncio.TimeoutError, BrokenPipeError, ValueError) as error:
        raise EvaluationExecutionError(f"{version.label} 的评测核心启动或连接失败") from error
    finally:
        process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), 8)
        except asyncio.TimeoutError:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 4)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
