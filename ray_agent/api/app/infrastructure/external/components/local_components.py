"""受管组件：浏览器 Chromium 经 Playwright 下载到数据根；OCR／Embedding 预留。"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Callable

from app.domain.external.runtime_components import (
    ComponentId, ComponentManifestEntry, ComponentState, ComponentStatus, RuntimeComponents,
)
from app.domain.models.error import ErrorCode, ErrorInfo
from app.domain.models.identity import OperationId, RequestId
from core.paths import RESOURCE_ROOT

logger = logging.getLogger(__name__)

BROWSER_ID = "browser-chromium"


class ComponentError(Exception):
    def __init__(self, message: str, *, code: ErrorCode = ErrorCode.UNAVAILABLE) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_manifest() -> list[ComponentManifestEntry]:
    path = RESOURCE_ROOT / "resources" / "component_manifest.json"
    if not path.is_file():
        path = Path(__file__).resolve().parents[4] / "resources" / "component_manifest.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return [ComponentManifestEntry.model_validate(item) for item in data.get("components") or []]


class LocalRuntimeComponents:
    """实现 RuntimeComponents。install 在后台任务中拉取 Playwright Chromium。"""

    def __init__(self, components_root: Path, *, uow_factory: Callable | None = None) -> None:
        self.root = Path(components_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._uow_factory = uow_factory
        self._manifest = {item.component_id: item for item in load_manifest()}
        self._states: dict[str, ComponentStatus] = {}
        self._ops: dict[str, str] = {}  # request_id → operation_id
        self._cancel: set[str] = set()
        self._lock = asyncio.Lock()
        self._hydrate()

    def _browser_dir(self) -> Path:
        return self.root / BROWSER_ID

    def _hydrate(self) -> None:
        for component_id, entry in self._manifest.items():
            if component_id == BROWSER_ID and self._chromium_ready():
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.AVAILABLE, version=entry.version)
            elif component_id == BROWSER_ID:
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.NOT_INSTALLED, version=None)
            else:
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.NOT_INSTALLED, version=None)

    def _chromium_ready(self) -> bool:
        marker = self._browser_dir() / ".ready"
        return marker.is_file() and any(self._browser_dir().rglob("Chromium"))

    async def list_components(self) -> list[ComponentStatus]:
        return [await self.status(component_id) for component_id in self._manifest]

    async def status(self, component_id: ComponentId) -> ComponentStatus:
        if component_id not in self._manifest:
            raise ComponentError(f"未知组件: {component_id}", code=ErrorCode.NOT_FOUND)
        if component_id == BROWSER_ID and self._chromium_ready():
            entry = self._manifest[component_id]
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.AVAILABLE, version=entry.version)
        return self._states[component_id]

    async def install(self, component_id: ComponentId, request_id: RequestId) -> OperationId:
        if component_id not in self._manifest:
            raise ComponentError(f"未知组件: {component_id}", code=ErrorCode.NOT_FOUND)
        if component_id != BROWSER_ID:
            raise ComponentError(f"{component_id} 尚未开放安装", code=ErrorCode.UNAVAILABLE)
        async with self._lock:
            if request_id in self._ops:
                return self._ops[request_id]
            if self._chromium_ready():
                op = uuid.uuid4().hex
                self._ops[request_id] = op
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.AVAILABLE,
                    version=self._manifest[component_id].version, operation_id=op)
                return op
            op = uuid.uuid4().hex
            self._ops[request_id] = op
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FETCHING, operation_id=op)
            asyncio.create_task(self._install_browser(op, component_id))
            return op

    async def cancel(self, operation_id: OperationId) -> None:
        self._cancel.add(operation_id)

    async def locate(self, component_id: ComponentId) -> Path:
        status = await self.status(component_id)
        if status.state is not ComponentState.AVAILABLE:
            raise ComponentError(status.detail or f"组件不可用: {component_id}",
                                 code=ErrorCode.UNAVAILABLE)
        if component_id == BROWSER_ID:
            return self._browser_dir()
        raise ComponentError(f"组件不可用: {component_id}")

    async def _install_browser(self, operation_id: str, component_id: str) -> None:
        target = self._browser_dir()
        target.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(target)}
        try:
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FETCHING, operation_id=operation_id)
            if operation_id in self._cancel:
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            proc = await asyncio.create_subprocess_exec(
                os.environ.get("RAYAGENT_PYTHON") or os.sys.executable, "-m", "playwright", "install", "chromium",
                env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            out, _ = await proc.communicate()
            if operation_id in self._cancel:
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            if proc.returncode != 0:
                raise RuntimeError(out.decode(errors="replace")[-2000:] or "playwright install 失败")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.VERIFYING, operation_id=operation_id)
            # 可启动检查：短时 headless 启动
            await self._verify_chromium(target)
            (target / ".ready").write_text(self._manifest[component_id].version + "\n", encoding="utf-8")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.AVAILABLE,
                version=self._manifest[component_id].version, operation_id=operation_id)
        except Exception as error:
            logger.exception("安装浏览器组件失败")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FAILED, operation_id=operation_id,
                error=ErrorInfo(code=ErrorCode.INTERNAL_ERROR, message=str(error), retryable=True, details={}))

    async def _verify_chromium(self, browsers_path: Path) -> None:
        env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(browsers_path)}
        code = (
            "from playwright.sync_api import sync_playwright\n"
            "with sync_playwright() as p:\n"
            "    b = p.chromium.launch(headless=True)\n"
            "    b.close()\n"
        )
        proc = await asyncio.create_subprocess_exec(
            os.sys.executable, "-c", code, env=env,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _, err = await asyncio.wait_for(proc.communicate(), 120)
        if proc.returncode != 0:
            raise RuntimeError(err.decode(errors="replace")[-1000:] or "Chromium 可启动检查失败")
