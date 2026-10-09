"""有界进程解析、分段文本与有限缓存。缓存只存派生内容，不保存文件副本。"""
import asyncio
import codecs
import json
import os
import sys
import tempfile
import time
from collections import OrderedDict
from pathlib import Path

from app.domain.models.file_preview import PREVIEW_INPUT_BYTES, TEXT_PAGE_BYTES, preview_kind
from app.domain.services.project_file_coordinator import run_file_io

_slots = asyncio.Semaphore(3)
_cache = OrderedDict()
_cache_bytes = 0


def read_text(handle, offset):
    handle.seek(offset)
    data = handle.read(TEXT_PAGE_BYTES + 4)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')
    page = data[:TEXT_PAGE_BYTES]
    text = decoder.decode(page, final=len(data) <= TEXT_PAGE_BYTES)
    buffered = len(decoder.getstate()[0])
    consumed = len(page)-buffered
    return dict(content=text.lstrip('\ufeff') if offset == 0 else text, offset=offset,
                next_offset=offset+consumed if len(data)>consumed else None,
                partial=bool(offset or len(data)>consumed))


async def parse_preview(handle, filename, revision, query):
    global _cache_bytes
    kind = preview_kind(filename)
    base = dict(kind=kind, filename=filename, revision=revision)
    if kind == 'unavailable':
        return {**base, 'reason':'暂不支持预览'}
    if kind == 'pdf' or (kind == 'image' and Path(filename).suffix.lower() == '.svg'):
        return base
    key = (revision, filename, query.model_dump_json())
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and cached[0] > now:
        _cache.move_to_end(key)
        return cached[1]
    async with _slots:
        if kind in ('text', 'markdown'):
            page, cancelled = await run_file_io(read_text, handle, query.offset)
            if cancelled:
                raise asyncio.CancelledError
            result = {**base, **page}
        else:
            with tempfile.TemporaryDirectory(prefix='rayagent-preview-') as directory:
                path = os.path.join(directory, 'source'+Path(filename).suffix.lower())
                def copy():
                    total = 0
                    with open(path, 'wb') as output:
                        while chunk := handle.read(1024*1024):
                            total += len(chunk)
                            if total > PREVIEW_INPUT_BYTES:
                                return False
                            output.write(chunk)
                    return True
                complete, cancelled = await run_file_io(copy)
                if cancelled:
                    raise asyncio.CancelledError
                if not complete and Path(filename).suffix.lower() not in ('.csv', '.tsv'):
                    return {**base, 'kind':'unavailable', 'reason':'文件数据量过大'}
                options = query.model_dump()
                options['input_limited'] = not complete
                process = await asyncio.create_subprocess_exec(sys.executable, '-m',
                    'app.infrastructure.external.file_preview.worker', path,
                    json.dumps(options), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                try:
                    output, _ = await asyncio.wait_for(process.communicate(), timeout=12)
                    parsed = json.loads(output) if process.returncode == 0 else {'kind':'unavailable','reason':'预览处理超时'}
                    result = {**base, **parsed}
                except asyncio.TimeoutError:
                    result = {**base, 'kind':'unavailable','reason':'预览处理超时'}
                finally:
                    if process.returncode is None:
                        process.kill()
                    await process.wait()
    size = len(json.dumps(result))
    if size < 8*1024*1024:
        old = _cache.pop(key, None)
        if old:
            _cache_bytes -= old[2]
        _cache[key] = (now+60, result, size)
        _cache_bytes += size
        while _cache and (_cache_bytes > 32*1024*1024 or len(_cache)>64):
            _, removed = _cache.popitem(last=False)
            _cache_bytes -= removed[2]
    return result
