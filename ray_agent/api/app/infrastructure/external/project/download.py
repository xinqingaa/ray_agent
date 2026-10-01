"""无沙箱下载：目录描述符读取，ZIP 无 seek 流式输出，不追随链接。"""
import io
import zipfile
from collections import deque
from app.infrastructure.external.project.file_io import CHUNK_BYTES


class ZipOutput(io.RawIOBase):
    def __init__(self):
        self.chunks, self.position = deque(), 0

    def writable(self):
        return True

    def seekable(self):
        return False

    def tell(self):
        return self.position

    def write(self, data):
        if data:
            self.chunks.append(bytes(data))
            self.position += len(data)
        return len(data)

    def drain(self):
        while self.chunks:
            yield self.chunks.popleft()


def stream_file(store, path):
    with store.open_regular(path) as source:
        while chunk := source.read(CHUNK_BYTES):
            yield chunk


def stream_zip(store, entries, max_bytes):
    output, total = ZipOutput(), 0
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for entry in entries:
            if entry.type != 'file':
                continue
            # open_regular 重新检查父目录与最终项，拒绝扫描后的链接替换。
            with store.open_regular(entry.path) as source, archive.open(entry.path, 'w', force_zip64=True) as target:
                yield from output.drain()
                while chunk := source.read(CHUNK_BYTES):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError('生成期间项目超过打包下载上限，请分文件下载')
                    target.write(chunk)
                    yield from output.drain()
            yield from output.drain()
    yield from output.drain()
