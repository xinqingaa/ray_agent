"""写入流的包装：边读边算内容哈希，或在读完时核对哈希。读取都发生在线程里，不做异步等待。"""
import hashlib
from typing import BinaryIO

from app.domain.external.workspace_files import WorkspaceFileError
from app.domain.models.error import ErrorCode


class HashingReader:
    """包装写入来源：发布读走的每个字节都计入摘要，得到的就是实际写入文件的内容哈希。"""

    def __init__(self, source: BinaryIO) -> None:
        self._source, self._digest = source, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        chunk = self._source.read(size)
        self._digest.update(chunk)
        return chunk

    def hexdigest(self) -> str:
        return self._digest.hexdigest()


class VerifyingReader:
    """读到末尾时核对内容哈希；不符时抛出，写入在发布前中止，不会把损坏的备份写回用户文件。"""

    def __init__(self, source: BinaryIO, sha256: str) -> None:
        self._source, self._expected, self._digest = source, sha256, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        chunk = self._source.read(size)
        if chunk:
            self._digest.update(chunk)
        elif self._digest.hexdigest() != self._expected:
            raise WorkspaceFileError(ErrorCode.INTERNAL_ERROR, "写前备份的内容与登记的哈希不符，已停止恢复")
        return chunk
