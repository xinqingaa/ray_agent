"""一次运行可访问的文件范围：当前工作区文件夹与本会话的工作目录。

模型传入真实的绝对路径，或相对工作目录的路径（工作区会话是工作区文件夹，独立对话是会话工作目录）；范围把它们
解析成 root_id 加相对路径，越界即拒绝，之后一律经 WorkspaceFiles 访问。工作区文件夹的写入经 FileWriteGate，
由应用层在其中检查工作区状态、取得写租约、保存写前备份并记录变更。
"""
import asyncio
import hashlib
import os
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import BinaryIO, Optional, Protocol

from app.domain.external.workspace_files import FileEntry, FileKind, FileLimits, FileVersion, WorkspaceFileError, \
    WorkspaceFiles
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath, RootKind, relative_parts
from app.domain.services.file_rules import denied_reason

_current_call: ContextVar[Optional[str]] = ContextVar("file_scope_tool_call", default=None)

ALIAS_PREFIX_LIMIT = 64
UNIQUE_NAME_ATTEMPTS = 500


@dataclass(frozen=True)
class AccessibleRoot:
    root_id: str
    path: str  # 规范绝对路径
    kind: RootKind


@dataclass(frozen=True)
class WriteOwner:
    """写入的归属：写租约与写前备份按它记录是哪个会话、运行与工具调用造成的变化。

    租约按 (session_id, run_id, operation) 判定同一持有者：同一运行的多次工具写入重入同一租约，一次撤销用自己的
    operation，与同会话的其他写入互不重入。"""
    session_id: str
    run_id: Optional[str] = None
    tool_call_id: Optional[str] = None
    source: str = "tool"  # tool / upload / undo
    operation: Optional[str] = None
    reason: str = ""  # 占用租约时给其他写入者看的原因；为空则按来源生成
    undo_of_run_id: Optional[str] = None  # 撤销产生的变更记录指向被撤销的运行


class FileWriteGate(Protocol):
    """工作区文件夹的唯一写入入口：核对工作区状态，取得写租约，覆盖或删除前保存写前备份，发布后记录变更。"""

    async def write_stream(self, path: RootedPath, source: BinaryIO, expected: Optional[FileVersion],
                           owner: WriteOwner) -> FileVersion:
        ...

    async def write_bytes(self, path: RootedPath, data: bytes, expected: Optional[FileVersion],
                          owner: WriteOwner) -> FileVersion:
        ...

    async def mkdir(self, path: RootedPath, owner: WriteOwner) -> FileEntry:
        ...

    async def delete(self, path: RootedPath, expected: FileVersion, owner: WriteOwner) -> None:
        ...


def _forbidden(message: str) -> WorkspaceFileError:
    return WorkspaceFileError(ErrorCode.FORBIDDEN, message)


def _under(path: str, root: str) -> Optional[str]:
    """path 在 root 之内时返回相对路径（根本身为空串），否则为空。"""
    if path == root:
        return ""
    prefix = root if root.endswith(os.sep) else root + os.sep
    return path[len(prefix):] if path.startswith(prefix) else None


class FileScope:
    def __init__(self, files: WorkspaceFiles, roots: list[AccessibleRoot], *, working: Optional[AccessibleRoot] = None,
                 limits: Optional[FileLimits] = None, gate: Optional[FileWriteGate] = None,
                 gated_root_id: Optional[str] = None, owner: Optional[WriteOwner] = None) -> None:
        self.files = files
        self.roots = roots
        self.working = working or (roots[0] if roots else None)
        self.limits = limits or FileLimits()
        self._gate = gate
        self._gated_root_id = gated_root_id
        self._owner = owner or WriteOwner(session_id="")

    def root(self, root_id: str) -> AccessibleRoot:
        return next(root for root in self.roots if root.root_id == root_id)

    def resolve(self, raw: str) -> RootedPath:
        text = (raw or "").strip()
        if not text or "\x00" in text:
            raise WorkspaceFileError(ErrorCode.INVALID_REQUEST, "路径不能为空")
        if not os.path.isabs(text):
            if self.working is None:
                raise _forbidden("当前没有可访问的工作目录")
            text = os.path.join(self.working.path, text)
        normalized = os.path.normpath(text)
        for candidate in self._candidates(normalized):
            for root in self.roots:
                relative = _under(candidate, root.path)
                if relative is not None:
                    try:
                        rooted = RootedPath(root_id=root.root_id, relative_path=relative.replace(os.sep, "/"))
                    except ValueError as error:
                        raise WorkspaceFileError(ErrorCode.INVALID_REQUEST, f"路径无效：{error}")
                    if root.kind is RootKind.WORKSPACE_FOLDER and (reason := denied_reason(relative_parts(
                            rooted.relative_path))):
                        raise _forbidden(f"{raw}：{reason}")
                    return rooted
        places = "、".join(root.path for root in self.roots) or "无"
        raise _forbidden(f"路径 {raw} 不在可访问范围内；可访问：{places}")

    def _candidates(self, normalized: str):
        """原路径优先；其后用祖先目录的规范路径重试，使 /var 与 /private/var 这类系统别名指向同一位置。
        按最短前缀逐级尝试，不会因根内部的链接把路径带到范围之外：根内部的链接留给逐级 openat 拒绝。"""
        yield normalized
        parts = normalized.split(os.sep)
        for count in range(2, min(len(parts), ALIAS_PREFIX_LIMIT) + 1):
            prefix = os.sep.join(parts[:count]) or os.sep
            real = os.path.realpath(prefix)
            if real != prefix:
                yield os.path.join(real, *parts[count:]) if parts[count:] else real
                return

    def display(self, path: RootedPath) -> str:
        root = self.root(path.root_id)
        return os.path.join(root.path, *relative_parts(path.relative_path))

    def is_gated(self, path: RootedPath) -> bool:
        return self._gate is not None and path.root_id == self._gated_root_id

    def bind_call(self, call_id: str):
        """在当前调用上下文里记下工具调用身份，之后经写入口的变更记录归属到这次调用；返回用于 reset 的令牌。"""
        return _current_call.set(call_id)

    @staticmethod
    def reset_call(token) -> None:
        _current_call.reset(token)

    def _owner_now(self) -> WriteOwner:
        call_id = _current_call.get()
        return replace(self._owner, tool_call_id=call_id) if call_id else self._owner

    async def write_stream(self, path: RootedPath, source: BinaryIO, expected: Optional[FileVersion]) -> FileVersion:
        if self.is_gated(path):
            return await self._gate.write_stream(path, source, expected, self._owner_now())
        return await self.files.write_stream(path, source, expected)

    async def write_bytes(self, path: RootedPath, data: bytes, expected: Optional[FileVersion]) -> FileVersion:
        if self.is_gated(path):
            return await self._gate.write_bytes(path, data, expected, self._owner_now())
        return await self.files.write_bytes(path, data, expected)

    async def mkdir(self, path: RootedPath) -> FileEntry:
        if self.is_gated(path):
            return await self._gate.mkdir(path, self._owner_now())
        return await self.files.mkdir(path, parents=True)

    async def delete(self, path: RootedPath, expected: FileVersion) -> None:
        if self.is_gated(path):
            return await self._gate.delete(path, expected, self._owner_now())
        return await self.files.delete(path, expected)

    async def ensure_parent(self, path: RootedPath) -> None:
        parts = relative_parts(path.relative_path)
        if len(parts) > 1:
            await self.mkdir(RootedPath(root_id=path.root_id, relative_path="/".join(parts[:-1])))

    async def write_unique(self, directory: RootedPath, name: str, source: BinaryIO) -> tuple[RootedPath, FileVersion]:
        """在目录里放入新文件，同名时加序号，绝不覆盖已有文件；source 需要可回到开头才能重试。"""
        await self.ensure_parent(RootedPath(root_id=directory.root_id,
                                            relative_path="/".join((*relative_parts(directory.relative_path), name))))
        stem, suffix = os.path.splitext(name)
        for attempt in range(1, UNIQUE_NAME_ATTEMPTS + 1):
            candidate = name if attempt == 1 else f"{stem} ({attempt}){suffix}"
            target = RootedPath(root_id=directory.root_id,
                                relative_path="/".join((*relative_parts(directory.relative_path), candidate)))
            try:
                if attempt > 1:
                    source.seek(0)
                return target, await self.write_stream(target, source, None)
            except WorkspaceFileError as error:
                if error.code is not ErrorCode.CONFLICT or "lease" in error.details:
                    raise  # 写入租约被占用不是重名，不换名重试
        raise WorkspaceFileError(ErrorCode.CONFLICT, f"同名文件过多，无法放入 {name}")

    async def exists(self, raw: str) -> bool:
        """路径是否存在；无法确认时抛出，由调用方保守处理。"""
        try:
            await self.files.stat(self.resolve(raw))
            return True
        except WorkspaceFileError as error:
            if error.code is ErrorCode.NOT_FOUND:
                return False
            raise

    async def fingerprint(self, raw: str) -> Optional[str]:
        """普通文件的 SHA-256；不存在、不可读或不是普通文件时为空。"""
        if not raw:
            return None
        try:
            reader = await self.files.open_reader(self.resolve(raw))
        except WorkspaceFileError:
            return None

        def digest() -> str:
            hasher = hashlib.sha256()
            with reader:
                while chunk := reader.read(1024 * 1024):
                    hasher.update(chunk)
            return hasher.hexdigest()
        try:
            return await asyncio.to_thread(digest)
        except OSError:
            return None

    async def write_text_new(self, raw: str, content: str) -> FileVersion:
        """只在目标不存在时创建文本文件，父目录按需创建。"""
        path = self.resolve(raw)
        await self.ensure_parent(path)
        return await self.write_bytes(path, content.encode("utf-8"), None)

    async def kind(self, path: RootedPath) -> Optional[FileKind]:
        try:
            return (await self.files.stat(path)).kind
        except WorkspaceFileError as error:
            if error.code is ErrorCode.NOT_FOUND:
                return None
            raise
