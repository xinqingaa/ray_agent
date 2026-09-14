"""第十一章受控环境观察；仅访问临时目录与回环服务。"""
import asyncio
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.file import FileService
from app.services.shell import ShellService


async def check():
    shell = ShellService()
    evidence = []
    with tempfile.TemporaryDirectory(prefix="lesson-11-") as directory:
        root = Path(directory).resolve()
        work = root / "work"
        work.mkdir()
        outside = root / "outside.txt"
        await FileService.write_file(str(outside), "controlled-marker")
        link = work / "link.txt"
        link.symlink_to(outside)
        assert (await FileService.read_file(str(link))).content == "controlled-marker"
        assert (await FileService.read_file(str(work / ".." / "outside.txt"))).content == "controlled-marker"
        evidence.append({"check": "path", "parent_and_symlink_read": True,
                         "scope": "all files inside temporary fixture"})

        async def run(command):
            try:
                result = await asyncio.wait_for(shell.exec_command("lesson-11", str(work), command), 10)
            finally:
                for item in shell.active_shells.values():
                    if item.process.returncode is None:
                        item.process.kill()
                        await asyncio.wait_for(item.process.wait(), 5)
            assert result.returncode == 0, result
            return result.output.strip()

        await run("export LESSON_11_MARKER=first; cd ..; printf first")
        state = await run("printf '%s|%s' \"${LESSON_11_MARKER-unset}\" \"$PWD\"")
        assert state == "unset|" + str(work)
        evidence.append({"check": "shell", "same_id_new_process": True, "export_not_retained": True})

        async def receive(reader, writer):
            try:
                await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                await writer.drain()
            finally:
                writer.close()
                await writer.wait_closed()

        server = await asyncio.start_server(receive, "127.0.0.1", 0)
        async with server:
            port = server.sockets[0].getsockname()[1]
            code = ("import urllib.request; "
                    f"print(urllib.request.urlopen('http://127.0.0.1:{port}', timeout=3).read().decode())")
            output = await run(shlex.quote(sys.executable) + " -c " + shlex.quote(code))
            assert output == "ok"
        evidence.append({"check": "network", "loopback_http": True, "listener_closed": not server.is_serving()})
        uid = await run("id -u")
        assert int(uid) == os.geteuid()
        evidence.append({"check": "identity", "service_uid": os.geteuid(), "child_uid": int(uid)})
    assert not root.exists()
    assert all(item.process.returncode is not None for item in shell.active_shells.values())
    evidence.append({"check": "cleanup", "temporary_directory_removed": True, "child_exited": True})
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(check())
