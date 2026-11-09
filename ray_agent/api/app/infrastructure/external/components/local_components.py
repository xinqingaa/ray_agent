"""组件磁盘适配：隔离暂存、版本收据与原子发布；操作生命周期由应用服务协调。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.domain.external.runtime_components import ComponentManifestEntry, ComponentState, ComponentStatus
from app.domain.models.error import ErrorCode
from app.domain.models.error import ErrorInfo
from core.paths import RESOURCE_ROOT

BROWSER_ID = "browser-chromium"


class ComponentError(Exception):
    def __init__(self, message: str, *, code: ErrorCode = ErrorCode.UNAVAILABLE) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def load_manifest() -> list[ComponentManifestEntry]:
    data = json.loads((RESOURCE_ROOT / "resources/component_manifest.json").read_text())
    return [ComponentManifestEntry.model_validate(item) for item in data["components"]]


def load_component_files() -> dict:
    return json.loads((RESOURCE_ROOT / "resources/component_files.json").read_text())


class LocalRuntimeComponents:
    def __init__(self, components_root: Path) -> None:
        self.root = Path(components_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.manifest = {item.component_id: item for item in load_manifest()}

    def entry(self, component_id: str) -> ComponentManifestEntry:
        if component_id not in self.manifest:
            raise ComponentError(f"未知组件: {component_id}", code=ErrorCode.NOT_FOUND)
        return self.manifest[component_id]

    def current(self, component_id: str) -> tuple[Path, str] | None:
        entry = self.entry(component_id)
        base = self.root / component_id
        try:
            receipt = json.loads((base / "current.json").read_text())
            name = receipt["directory"]
            if not isinstance(name, str) or Path(name).name != name or name in (".", ".."):
                return None
            path = base / "versions" / name
            exact = receipt["version"] == entry.version and receipt["sha256"] == entry.sha256
            if not exact and (not entry.compatibility or receipt.get("compatibility") != entry.compatibility
                              or receipt.get("platform") != entry.platform):
                return None
            if (path / ".ready").read_text().strip() != receipt['version']:
                return None
            specs = receipt.get("files") or load_component_files()[component_id]
            # 兼容版本必须遵守当前文件布局契约，不能用新路径解释旧目录。
            current_specs = load_component_files()[component_id]
            if specs.get("executable") != current_specs.get("executable"):
                return None
            required = specs.get("required") or [item["path"] for item in specs.get("files", [])]
            if not required or not all((path / item).is_file() for item in required):
                return None
            return path, receipt["version"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    async def status(self, component_id: str) -> ComponentStatus:
        current = self.current(component_id)
        return ComponentStatus(component_id=component_id,
                               state=ComponentState.AVAILABLE if current else ComponentState.NOT_INSTALLED,
                               version=current[1] if current else None,
                               error=ErrorInfo(code=ErrorCode.UNAVAILABLE,
                                   message='已发布组件不完整或与当前运行适配契约不兼容，请重新安装或更新')
                               if current is None and (self.root / component_id / 'current.json').exists() else None)

    async def list_components(self) -> list[ComponentStatus]:
        return [await self.status(key) for key in self.manifest]

    async def locate(self, component_id: str) -> Path:
        current = self.current(component_id)
        if current is None:
            raise ComponentError(f"组件不可用，请在设置的运行组件中安装：{component_id}")
        return current[0]

    def staging(self, component_id: str, token: str) -> Path:
        self.entry(component_id)
        return self.root / component_id / "versions" / token

    def publish(self, component_id: str, token: str) -> None:
        """调用方持有写事务并核对代次后同步发布；迟到 worker 只能写自己的目录。"""
        entry = self.entry(component_id)
        path = self.staging(component_id, token)
        (path / ".ready").write_text(entry.version + "\n")
        receipt = path.parent.parent / (token + ".json.tmp")
        receipt.write_text(json.dumps(dict(directory=token, version=entry.version, sha256=entry.sha256,
                                          platform=entry.platform, compatibility=entry.compatibility,
                                          files=load_component_files()[component_id])))
        os.replace(receipt, path.parent.parent / "current.json")

    def target_is_current(self, component_id: str) -> bool:
        current = self.current(component_id)
        if current is None:
            return False
        receipt = json.loads((self.root / component_id / 'current.json').read_text())
        entry = self.entry(component_id)
        return receipt['version'] == entry.version and receipt['sha256'] == entry.sha256
