"""按 component_files.json 下载或从包内复制组件文件并校验哈希。"""
from __future__ import annotations

import hashlib
import importlib.util
import logging
import re
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


async def _download(client: httpx.AsyncClient, url: str, tmp: Path, *, expected_size: int | None,
                    cancel: Optional[Callable[[], bool]]) -> None:
    stalled = 0
    offset = tmp.stat().st_size if tmp.is_file() else 0
    if offset and offset == expected_size:
        return
    while True:
        headers = {"Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        before = offset
        try:
            async with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                if response.status_code == 206:
                    content_range = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not content_range or int(content_range[1]) != offset:
                        raise RuntimeError("下载服务返回了错误的分段位置")
                    total = int(content_range[3])
                else:
                    offset = 0  # 来源未支持 Range，重新读取完整文件。
                    total = expected_size
                if expected_size is not None and total != expected_size:
                    raise RuntimeError("下载文件大小与组件清单不符")
                with tmp.open("ab" if offset else "wb") as handle:
                    async for chunk in response.aiter_raw(1024 * 1024):
                        if cancel and cancel():
                            raise RuntimeError("安装已取消")
                        if total is not None and offset + len(chunk) > total:
                            raise RuntimeError("下载文件超出组件清单大小")
                        handle.write(chunk)
                        offset += len(chunk)
                if total is None or offset == total:
                    return
        except httpx.TransportError:
            if expected_size is None:
                raise
            if offset == expected_size:
                return  # 完整性仍由发布前的文件哈希检查。
            if offset > before:
                stalled = 0
                continue
            stalled += 1
            if stalled >= 3:
                raise
            continue
        if offset <= before:
            raise RuntimeError("分段下载没有继续写入")
        stalled = 0


async def fetch_file(
        url: str, dest: Path, *, expected_sha256: str, cancel: Optional[Callable[[], bool]] = None,
        timeout: float = 600.0, expected_size: int | None = None,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    resumable = expected_size is not None and not url.startswith("package://")
    if tmp.exists() and (not resumable or tmp.stat().st_size > expected_size):
        tmp.unlink()
    keep_partial = False
    try:
        if url.startswith("package://"):
            shutil.copyfile(resolve_package_path(url), tmp)
        else:
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                await _download(client, url, tmp, expected_size=expected_size, cancel=cancel)
        digest = sha256_file(tmp)
        if digest.lower() != expected_sha256.lower():
            raise RuntimeError(f"哈希不匹配 {dest.name}: 期望 {expected_sha256} 得到 {digest}")
        tmp.replace(dest)
    except httpx.TransportError:
        keep_partial = resumable and not (cancel and cancel())
        raise
    finally:
        if not keep_partial:
            tmp.unlink(missing_ok=True)


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
        await fetch_file(item["url"], dest, expected_sha256=item["sha256"], expected_size=item.get("size"), cancel=cancel)
