"""源码和冻结核心共用的组件下载／可启动检查入口，由 supervisor 回收整个进程树。"""
from __future__ import annotations

import asyncio
import os
import platform
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

from app.infrastructure.external.components.install_files import fetch_file, install_component_files, sha256_file
from app.infrastructure.external.components.local_components import BROWSER_ID, load_component_files, load_manifest


def unpack_zip(archive: Path, target: Path) -> None:
    links = []
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            path = PurePosixPath(info.filename)
            mode = info.external_attr >> 16
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('组件压缩包含非法路径或链接')
            dest = target.joinpath(*path.parts)
            if (mode & 0o170000) == 0o120000:
                links.append((dest, bundle.read(info).decode('utf-8')))
                continue
            if info.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, dest.open('wb') as output:
                    shutil.copyfileobj(source, output)
                dest.chmod(mode & 0o777 or 0o644)

    for dest, link in links:
        if Path(link).is_absolute() or not (dest.parent / link).resolve().is_relative_to(target.resolve()):
            raise ValueError('组件链接越出安装目录')
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.symlink_to(link)


async def fetch(component_id: str, target: Path) -> None:
    specs = load_component_files()[component_id]
    if component_id == BROWSER_ID:
        archive = target / 'chromium.zip'
        item = specs['archive']
        await fetch_file(item['url'], archive, expected_sha256=item['sha256'])
        unpack_zip(archive, target)
        archive.unlink()
    else:
        await install_component_files(specs['files'], target)


def verify(component_id: str, target: Path) -> None:
    specs = load_component_files()[component_id]
    if component_id == BROWSER_ID:
        os.environ.pop('PLAYWRIGHT_BROWSERS_PATH', None)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(target / specs['executable']), headless=True)
            try:
                page = browser.new_page()
                page.set_content('<title>component-check</title>')
                if page.title() != 'component-check':
                    raise RuntimeError('Chromium 页面检查失败')
            finally:
                browser.close()
    else:
        for item in specs['files']:
            if sha256_file(target / item['path']) != item['sha256']:
                raise RuntimeError(f"组件文件校验失败: {item['path']}")
        if component_id == 'embedding-e5':
            from app.infrastructure.external.embedding.e5_onnx import verify_embedder
            verify_embedder(target)
        elif component_id == 'ocr':
            from app.infrastructure.external.ocr.rapid_ocr import verify_ocr
            verify_ocr(target)


def main():
    action, component_id, target_text = sys.argv[1:]
    entries = {entry.component_id: entry for entry in load_manifest()}
    if f'{"macos" if sys.platform == "darwin" else sys.platform}-{platform.machine()}' != entries[component_id].platform:
        raise RuntimeError('组件与当前系统架构不兼容')
    target = Path(target_text)
    if action == 'fetch':
        target.mkdir(parents=True, exist_ok=True)
        asyncio.run(fetch(component_id, target))
    elif action == 'verify':
        verify(component_id, target)
    else:
        raise ValueError('未知组件动作')


if __name__ == '__main__':
    main()
