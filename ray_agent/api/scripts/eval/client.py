"""RayAgent 公开 HTTP 接口的最小异步客户端。"""
import json
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx


class ApiError(RuntimeError):
    pass


class RayAgentClient:
    def __init__(self, base_url: str, timeout: float = 60.0) -> None:
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    async def close(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "RayAgentClient":
        return self

    async def __aexit__(self, *args) -> None:
        await self.close()

    @staticmethod
    def _unwrap(response: httpx.Response) -> Any:
        try:
            body = response.json()
        except ValueError:
            raise ApiError(f"HTTP {response.status_code} {response.request.url}: {response.text[:300]}")
        if response.status_code != 200 or body.get("code") != 200:
            raise ApiError(
                f"HTTP {response.status_code} {response.request.url}: code={body.get('code')} msg={body.get('msg')}"
            )
        return body.get("data")

    async def _get(self, path: str) -> Any:
        return self._unwrap(await self._http.get(path))

    async def _post(self, path: str, payload: Any = None) -> Any:
        return self._unwrap(await self._http.post(path, json=payload))

    async def status(self) -> Any:
        return await self._get("/status")

    async def get_llm_config(self) -> Dict[str, Any]:
        return await self._get("/app-config/llm")

    async def get_agent_config(self) -> Dict[str, Any]:
        return await self._get("/app-config/agent")

    async def list_mcp_servers(self) -> List[Dict[str, Any]]:
        return (await self._get("/app-config/mcp-servers"))["mcp_servers"]

    async def add_mcp_servers(self, config: Dict[str, Any]) -> None:
        await self._post("/app-config/mcp-servers", config)

    async def delete_mcp_server(self, name: str) -> None:
        await self._post(f"/app-config/mcp-servers/{name}/delete")

    async def create_session(self) -> str:
        return (await self._post("/sessions"))["session_id"]

    async def get_session(self, session_id: str, after_seq: int = 0) -> Dict[str, Any]:
        suffix = f"?after_seq={after_seq}" if after_seq else ""
        return await self._get(f"/sessions/{session_id}{suffix}")

    async def get_turn_request(self, session_id: str, run_id: str, index: int) -> Dict[str, Any]:
        return await self._get(f"/sessions/{session_id}/runs/{run_id}/turns/{index}/request")

    async def get_session_files(self, session_id: str) -> List[Dict[str, Any]]:
        return (await self._get(f"/sessions/{session_id}/files"))["files"]

    async def stop_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        return await self._post(f"/sessions/{session_id}/stop")

    async def read_sandbox_file(self, session_id: str, filepath: str) -> str:
        return (await self._post(f"/sessions/{session_id}/file", {"filepath": filepath}))["content"]

    async def upload_file(self, filename: str, content: bytes) -> Dict[str, Any]:
        response = await self._http.post("/files", files={"file": (filename, content)})
        return self._unwrap(response)

    async def download_file(self, file_id: str) -> bytes:
        response = await self._http.get(f"/files/{file_id}/download")
        if response.status_code != 200:
            raise ApiError(f"下载文件 {file_id} 失败：HTTP {response.status_code} {response.text[:200]}")
        return response.content

    async def chat(
            self,
            session_id: str,
            message: str,
            attachments: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """发送消息，返回 {run_id, seq, route}；执行过程通过 events() 观察。"""
        payload = {
            "message": message,
            "attachments": attachments or [],
            "timestamp": int(time.time()),
        }
        return await self._post(f"/sessions/{session_id}/chat", payload)

    async def events(self, session_id: str, after_seq: int = 0) -> AsyncIterator[Tuple[str, Dict[str, Any]]]:
        """订阅 seq > after_seq 的会话事件，逐条产出 (event, data)；服务端不主动结束，由调用方停止迭代。"""
        timeout = httpx.Timeout(30.0, read=None)
        async with self._http.stream("GET", f"/sessions/{session_id}/events", params={"after_seq": after_seq},
                                     timeout=timeout) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise ApiError(f"events HTTP {response.status_code}: {body[:300]!r}")
            async for item in parse_sse(response.aiter_lines()):
                yield item


async def parse_sse(lines: AsyncIterator[str]) -> AsyncIterator[Tuple[str, Dict[str, Any]]]:
    event_type, data_lines = None, []
    async for line in lines:
        if line == "":
            if data_lines:
                raw = "\n".join(data_lines)
                try:
                    data = json.loads(raw)
                except ValueError:
                    data = {"raw": raw}
                yield event_type or "message", data
            event_type, data_lines = None, []
        elif line.startswith(":") or line.startswith("id:"):
            continue
        elif line.startswith("event:"):
            event_type = line[len("event:"):].strip()
        elif line.startswith("data:"):
            value = line[len("data:"):]
            data_lines.append(value[1:] if value.startswith(" ") else value)
