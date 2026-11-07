"""按 component_files.json 下载或从包内复制组件文件并校验哈希。"""
from __future__ import annotations

import hashlib
import importlib.util
import logging
import shutil
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def resolve_package_path(url: str) -> Path:
    """package://module/rel/path → 已安装包内文件。"""
    parsed = urlparse(url)
    if parsed.scheme != "package":
        raise ValueError(f"不是 package URL: {url}")
    module_name = parsed.netloc or parsed.path.lstrip("/").split("/")[0]
    rest = parsed.path.lstrip("/")
    if parsed.netloc:
        rest = parsed.path.lstrip("/")
    else:
        parts = parsed.path.lstrip("/").split("/", 1)
        module_name = parts[0]
        rest = parts[1] if len(parts) > 1 else ""
    spec = importlib.util.find_spec(module_name)
    if spec is None or not spec.origin:
        raise FileNotFoundError(f"未安装包: {module_name}")
    root = Path(spec.origin).parent
    target = root / rest
    if not target.is_file():
        raise FileNotFoundError(f"包内文件不存在: {module_name}/{rest}")
    return target


async def fetch_file(
        url: str, dest: Path, *, expected_sha256: str, cancel: Optional[Callable[[], bool]] = None,
        timeout: float = 600.0,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    if tmp.exists():
        tmp.unlink()
    if url.startswith("package://"):
        src = resolve_package_path(url)
        shutil.copyfile(src, tmp)
    else:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                with open(tmp, "wb") as handle:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        if cancel and cancel():
                            tmp.unlink(missing_ok=True)
                            raise RuntimeError("安装已取消")
                        handle.write(chunk)
    digest = sha256_file(tmp)
    if digest.lower() != expected_sha256.lower():
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"哈希不匹配 {dest.name}: 期望 {expected_sha256} 得到 {digest}")
    tmp.replace(dest)


async def install_component_files(
        files: list[dict], target_dir: Path, *, cancel: Optional[Callable[[], bool]] = None,
) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for item in files:
        if cancel and cancel():
            raise RuntimeError("安装已取消")
        dest = target_dir / item["path"]
        if dest.is_file() and sha256_file(dest).lower() == item["sha256"].lower():
            continue
        logger.info("安装组件文件 %s", item["path"])
        await fetch_file(item["url"], dest, expected_sha256=item["sha256"], cancel=cancel)
