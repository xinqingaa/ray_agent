"""在独立子进程中跑完整解析；可取消时杀掉进程，不把半份结果交给调用方。"""
from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from pathlib import Path
from typing import Optional

from core.workers import worker_command

logger = logging.getLogger(__name__)

# 解析墙钟与并发：默认值同步参数页
DOCUMENT_PARSE_TIMEOUT_SECONDS = 120.0
DOCUMENT_PARSE_SLOTS = asyncio.Semaphore(2)


async def run_document_parse(source_path: Path, fmt: str, *, timeout: float = DOCUMENT_PARSE_TIMEOUT_SECONDS,
                             cancel_event: Optional[asyncio.Event] = None) -> dict:
    """将源文件路径交给 worker；返回解析 JSON。取消或超时不返回半份成功。"""
    async with DOCUMENT_PARSE_SLOTS:
        with tempfile.TemporaryDirectory(prefix="rayagent-doc-parse-") as tmp:
            out = Path(tmp) / "result.json"
            command = worker_command("document-parse", str(source_path), fmt, str(out))
            process = await asyncio.create_subprocess_exec(
                *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

            async def communicate() -> tuple[bytes, bytes]:
                return await process.communicate()

            comm = asyncio.create_task(communicate())
            try:
                while not comm.done():
                    if cancel_event is not None and cancel_event.is_set():
                        process.kill()
                        await comm
                        raise asyncio.CancelledError()
                    done, _ = await asyncio.wait({comm}, timeout=0.5)
                    if done:
                        break
                    timeout -= 0.5
                    if timeout <= 0:
                        process.kill()
                        await comm
                        return {"status": "failed", "reason": "解析超时"}
                stdout, stderr = comm.result()
                if out.is_file():
                    return json.loads(out.read_text(encoding="utf-8"))
                line = stdout.decode("utf-8", errors="replace").strip().splitlines()
                if line:
                    return json.loads(line[-1])
                return {"status": "failed",
                        "reason": (stderr.decode("utf-8", errors="replace") or "解析进程无输出").strip()[:500]}
            except asyncio.CancelledError:
                if process.returncode is None:
                    process.kill()
                await asyncio.gather(comm, return_exceptions=True)
                raise
            except json.JSONDecodeError as error:
                return {"status": "failed", "reason": f"解析输出无法解读：{error}"}
