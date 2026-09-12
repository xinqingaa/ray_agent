"""第八章本地进程观察；从沙箱目录运行，不启动 HTTP/容器/模型。"""
import asyncio
import contextlib
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.interfaces.errors.exceptions import BadRequestException
from app.services.shell import ShellService


async def check():
    service = ShellService()
    session_id = "lesson-08-control"
    started = time.monotonic()
    evidence = []

    def record(stage, **values):
        evidence.append({"stage": stage, "elapsed_seconds": round(time.monotonic() - started, 3), **values})

    async def until(predicate):
        async def poll():
            while not predicate():
                await asyncio.sleep(0.02)
        await asyncio.wait_for(poll(), 5)

    with tempfile.TemporaryDirectory(prefix="lesson-08-") as workdir:
        marker = Path(workdir) / "progress.txt"
        # exec 消除外层 shell 子进程；只核对一个可回收进程，不证明进程树清理。
        code = (
            "import time\n"
            "with open('progress.txt', 'a', buffering=1) as f:\n"
            " for i in range(400):\n"
            "  f.write(str(i) + '\\n')\n"
            "  time.sleep(0.05)\n"
        )
        command = "exec " + shlex.quote(sys.executable) + " -u -c " + shlex.quote(code)
        execution = asyncio.create_task(service.exec_command(session_id, workdir, command))
        process = None
        try:
            await until(lambda: marker.exists() and marker.stat().st_size > 0)
            process = service.active_shells[session_id].process
            record("started", pid=process.pid, bytes=marker.stat().st_size, exec_returned=execution.done())
            try:
                await service.wait_process(session_id, seconds=1)
            except BadRequestException:
                record("wait_timeout", process_alive=process.returncode is None)
            else:
                raise AssertionError("长操作意外提前结束")
            assert process.returncode is None
            execution.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await execution
            assert execution.cancelled()
            before = marker.stat().st_size
            await until(lambda: marker.stat().st_size > before)
            os.kill(process.pid, 0)
            record("caller_cancelled", process_alive=True, bytes_before=before, bytes_after=marker.stat().st_size)
            result = await service.kill_process(session_id)
            await asyncio.wait_for(process.wait(), 5)
            final_bytes = marker.stat().st_size
            await asyncio.sleep(0.15)
            assert marker.stat().st_size == final_bytes
            assert process.returncode is not None
            record("explicit_kill", status=result.status, returncode=process.returncode,
                   bytes=final_bytes, prior_writes_remain=marker.exists())
        finally:
            execution.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await execution
            if process is None and session_id in service.active_shells:
                process = service.active_shells[session_id].process
            if process is not None and process.returncode is None:
                process.kill()
                await asyncio.wait_for(process.wait(), 5)
    record("cleanup", temporary_directory_removed=not Path(workdir).exists())
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(check())
