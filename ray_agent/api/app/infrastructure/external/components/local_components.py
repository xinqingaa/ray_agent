"""受管组件：浏览器 Chromium、Embedding E5、OCR；按清单下载／复制、哈希与可启动检查。"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Callable, Optional

from app.domain.external.runtime_components import (
    ComponentId, ComponentManifestEntry, ComponentState, ComponentStatus, RuntimeComponents,
)
from app.domain.models.error import ErrorCode, ErrorInfo
from app.domain.models.identity import OperationId, RequestId
from app.domain.models.semantic_index import EMBEDDING_COMPONENT_ID, OCR_COMPONENT_ID
from app.infrastructure.external.components.install_files import install_component_files
from core.paths import RESOURCE_ROOT

logger = logging.getLogger(__name__)

BROWSER_ID = "browser-chromium"
INSTALLABLE = frozenset({BROWSER_ID, EMBEDDING_COMPONENT_ID, OCR_COMPONENT_ID})


class ComponentError(Exception):
    def __init__(self, message: str, *, code: ErrorCode = ErrorCode.UNAVAILABLE) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _resource_path(*parts: str) -> Path:
    path = RESOURCE_ROOT.joinpath(*parts)
    if path.is_file():
        return path
    return Path(__file__).resolve().parents[4].joinpath(*parts)


def load_manifest() -> list[ComponentManifestEntry]:
    path = _resource_path("resources", "component_manifest.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    return [ComponentManifestEntry.model_validate(item) for item in data.get("components") or []]


def load_component_files() -> dict:
    path = _resource_path("resources", "component_files.json")
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


class LocalRuntimeComponents:
    """实现 RuntimeComponents。install 在后台任务中拉取并校验。"""

    def __init__(
            self, components_root: Path, *, uow_factory: Callable | None = None,
            on_available: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.root = Path(components_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._uow_factory = uow_factory
        self._on_available = on_available
        self._manifest = {item.component_id: item for item in load_manifest()}
        self._file_specs = load_component_files()
        self._states: dict[str, ComponentStatus] = {}
        self._ops: dict[str, str] = {}  # request_id → operation_id
        self._cancel: set[str] = set()
        self._lock = asyncio.Lock()
        self._hydrate()

    def _dir(self, component_id: str) -> Path:
        return self.root / component_id

    def _hydrate(self) -> None:
        for component_id, entry in self._manifest.items():
            ready = self._is_ready(component_id)
            self._states[component_id] = ComponentStatus(
                component_id=component_id,
                state=ComponentState.AVAILABLE if ready else ComponentState.NOT_INSTALLED,
                version=entry.version if ready else None,
            )

    def _is_ready(self, component_id: str) -> bool:
        marker = self._dir(component_id) / ".ready"
        if not marker.is_file():
            return False
        if component_id == BROWSER_ID:
            return any(self._dir(component_id).rglob("Chromium"))
        if component_id == EMBEDDING_COMPONENT_ID:
            return (self._dir(component_id) / "model.onnx").is_file() \
                and (self._dir(component_id) / "tokenizer.json").is_file()
        if component_id == OCR_COMPONENT_ID:
            return (self._dir(component_id) / "det.onnx").is_file() \
                and (self._dir(component_id) / "rec.onnx").is_file()
        return False

    async def list_components(self) -> list[ComponentStatus]:
        return [await self.status(component_id) for component_id in self._manifest]

    async def status(self, component_id: ComponentId) -> ComponentStatus:
        if component_id not in self._manifest:
            raise ComponentError(f"未知组件: {component_id}", code=ErrorCode.NOT_FOUND)
        if self._is_ready(component_id):
            entry = self._manifest[component_id]
            current = self._states.get(component_id)
            if current is None or current.state is not ComponentState.AVAILABLE:
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.AVAILABLE, version=entry.version)
        return self._states[component_id]

    async def install(self, component_id: ComponentId, request_id: RequestId) -> OperationId:
        if component_id not in self._manifest:
            raise ComponentError(f"未知组件: {component_id}", code=ErrorCode.NOT_FOUND)
        if component_id not in INSTALLABLE:
            raise ComponentError(f"{component_id} 尚未开放安装", code=ErrorCode.UNAVAILABLE)
        async with self._lock:
            if request_id in self._ops:
                return self._ops[request_id]
            if self._is_ready(component_id):
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
            if component_id == BROWSER_ID:
                asyncio.create_task(self._install_browser(op, component_id))
            else:
                asyncio.create_task(self._install_file_component(op, component_id))
            return op

    async def cancel(self, operation_id: OperationId) -> None:
        self._cancel.add(operation_id)

    async def locate(self, component_id: ComponentId) -> Path:
        status = await self.status(component_id)
        if status.state is not ComponentState.AVAILABLE:
            message = status.error.message if status.error else f"组件不可用: {component_id}"
            raise ComponentError(message, code=ErrorCode.UNAVAILABLE)
        if not self._is_ready(component_id):
            raise ComponentError(f"组件不可用: {component_id}", code=ErrorCode.UNAVAILABLE)
        return self._dir(component_id)

    def _cancelled(self, operation_id: str) -> bool:
        return operation_id in self._cancel

    async def _install_browser(self, operation_id: str, component_id: str) -> None:
        target = self._dir(component_id)
        target.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(target)}
        try:
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FETCHING, operation_id=operation_id)
            if self._cancelled(operation_id):
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            proc = await asyncio.create_subprocess_exec(
                os.environ.get("RAYAGENT_PYTHON") or os.sys.executable, "-m", "playwright", "install", "chromium",
                env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            out, _ = await proc.communicate()
            if self._cancelled(operation_id):
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            if proc.returncode != 0:
                raise RuntimeError(out.decode(errors="replace")[-2000:] or "playwright install 失败")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.VERIFYING, operation_id=operation_id)
            await self._verify_chromium(target)
            (target / ".ready").write_text(self._manifest[component_id].version + "\n", encoding="utf-8")
            self._mark_available(component_id, operation_id)
        except Exception as error:
            logger.exception("安装浏览器组件失败")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FAILED, operation_id=operation_id,
                error=ErrorInfo(code=ErrorCode.INTERNAL_ERROR, message=str(error), retryable=True, details={}))

    async def _install_file_component(self, operation_id: str, component_id: str) -> None:
        target = self._dir(component_id)
        try:
            specs = (self._file_specs.get(component_id) or {}).get("files") or []
            if not specs:
                raise RuntimeError(f"缺少组件文件清单: {component_id}")
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FETCHING, operation_id=operation_id)
            await install_component_files(
                specs, target, cancel=lambda: self._cancelled(operation_id))
            if self._cancelled(operation_id):
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.VERIFYING, operation_id=operation_id)
            # 可启动检查：首次加载散装原生库可能较慢，放宽到数分钟
            await asyncio.wait_for(asyncio.to_thread(self._verify_file_component, component_id, target), 600)
            (target / ".ready").write_text(self._manifest[component_id].version + "\n", encoding="utf-8")
            self._mark_available(component_id, operation_id)
        except Exception as error:
            logger.exception("安装组件失败 component=%s", component_id)
            if self._cancelled(operation_id):
                self._states[component_id] = ComponentStatus(
                    component_id=component_id, state=ComponentState.CANCELLED, operation_id=operation_id)
                return
            self._states[component_id] = ComponentStatus(
                component_id=component_id, state=ComponentState.FAILED, operation_id=operation_id,
                error=ErrorInfo(code=ErrorCode.INTERNAL_ERROR, message=str(error), retryable=True, details={}))

    def _verify_file_component(self, component_id: str, target: Path) -> None:
        if component_id == EMBEDDING_COMPONENT_ID:
            from app.infrastructure.external.embedding.e5_onnx import verify_embedder
            verify_embedder(target)
        elif component_id == OCR_COMPONENT_ID:
            from app.infrastructure.external.ocr.rapid_ocr import verify_ocr
            verify_ocr(target)
        else:
            raise RuntimeError(f"无验证器: {component_id}")

    def _mark_available(self, component_id: str, operation_id: str) -> None:
        self._states[component_id] = ComponentStatus(
            component_id=component_id, state=ComponentState.AVAILABLE,
            version=self._manifest[component_id].version, operation_id=operation_id)
        if self._on_available is not None:
            try:
                self._on_available(component_id)
            except Exception:  # noqa: BLE001
                logger.exception("组件可用回调失败 component=%s", component_id)

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
