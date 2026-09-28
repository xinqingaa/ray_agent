"""评测用本地服务：静态页面（E5）与协议测试的 MCP 夹具进程（E6）。"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional

API_DIR = Path(__file__).resolve().parents[2]
MCP_FIXTURE = API_DIR / "tests" / "protocols" / "fixture_server.py"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("0.0.0.0", 0))
        return sock.getsockname()[1]


class StaticPageServer:
    """在宿主机 0.0.0.0 上提供固定页面，并记录每次请求的路径与来源地址。"""

    def __init__(self, pages: Dict[str, str]) -> None:
        self.pages = pages
        self.requests: List[Dict[str, str]] = []
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    def start(self) -> None:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append({"path": self.path, "client": self.client_address[0]})
                body = owner.pages.get(self.path.split("?", 1)[0])
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                data = body.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self._server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()


class MCPFixtureProcess:
    """以子进程运行 tests/protocols/fixture_server.py 的 streamable HTTP MCP 服务。"""

    def __init__(self) -> None:
        self.port = free_port()
        self._log_dir = tempfile.TemporaryDirectory(prefix="rayagent-eval-mcp-")
        self.call_log = Path(self._log_dir.name) / "calls.jsonl"
        self._stdout = Path(self._log_dir.name) / "server.log"
        self._process: Optional[subprocess.Popen] = None

    async def start(self, ready_timeout: float = 15.0) -> None:
        env = {**os.environ, "RAY_PROTOCOL_LOG": str(self.call_log)}
        self._process = subprocess.Popen(
            [sys.executable, str(MCP_FIXTURE), "mcp", "--port", str(self.port)],
            cwd=API_DIR, env=env, stdout=self._stdout.open("w"), stderr=subprocess.STDOUT,
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + ready_timeout
        while loop.time() < deadline:
            if self._process.poll() is not None:
                raise RuntimeError(f"MCP 夹具进程退出：{self.server_output()[-500:]}")
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.5):
                    return
            except OSError:
                await asyncio.sleep(0.2)
        raise RuntimeError(f"MCP 夹具未在 {ready_timeout}s 内监听端口 {self.port}")

    def server_output(self) -> str:
        return self._stdout.read_text(errors="replace") if self._stdout.exists() else ""

    def calls(self) -> List[Dict]:
        if not self.call_log.exists():
            return []
        return [json.loads(line) for line in self.call_log.read_text().splitlines() if line.strip()]

    def stop(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
        self._log_dir.cleanup()
