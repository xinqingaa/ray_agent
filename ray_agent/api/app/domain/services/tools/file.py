#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""文件工具箱：在 FileScope 划定的范围内读写文本文件、列目录与按名称查找。

路径参数是真实的绝对路径，或相对工作目录的路径；越界、链接、特殊文件与保留目录由范围和文件 IO 拒绝。
写入先核对版本再发布，外部同时修改时返回冲突，由模型读回后再决定。
"""
import asyncio
import codecs
import re
from typing import BinaryIO, Optional

from app.domain.external.workspace_files import FileKind, FileVersion, WorkspaceFileError
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath, relative_parts
from app.domain.models.tool_result import ToolResult
from app.domain.services.file_scope import FileScope
from .base import BaseTool, tool

DEFAULT_READ_CHARS = 10000
PROBE_BYTES = 8192
SCAN_FACTOR = 8  # 按行读取时最多扫描 read_bytes 的倍数，避免为取几行读完超大文件
MAX_LINE_CHARS = 20000  # 搜索时单行参与匹配的字符上限


def failure(error: WorkspaceFileError) -> ToolResult:
    data = {"code": error.code.value}
    if error.current is not None:
        data["current_size"] = error.current.size
    if error.details:
        data["details"] = error.details
    return ToolResult(success=False, message=str(error), data=data)


class _Concat:
    """把已有内容与追加内容接成一个只读流，用于不整体载入内存的追加写入。"""

    def __init__(self, first: BinaryIO, tail: bytes) -> None:
        self._first, self._tail, self._done = first, tail, False

    def read(self, size: int = -1) -> bytes:
        if not self._done:
            chunk = self._first.read(size)
            if chunk:
                return chunk
            self._done = True
            tail, self._tail = self._tail, b""
            return tail
        return b""

    def close(self) -> None:
        self._first.close()


def _glob_regex(pattern: str) -> re.Pattern:
    """glob 转正则：`**` 跨目录，`*` 与 `?` 不跨目录。"""
    out, index = [], 0
    while index < len(pattern):
        char = pattern[index]
        if pattern.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
            continue
        if char == "*":
            if pattern.startswith("**", index):
                out.append(".*")
                index += 2
                continue
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        elif char == "[":
            end = pattern.find("]", index + 2)
            if end == -1:
                out.append(re.escape(char))
            else:
                body = pattern[index + 1:end]
                out.append("[" + ("^" if body.startswith("!") else "") + body.lstrip("!").replace("\\", "\\\\") + "]")
                index = end
        else:
            out.append(re.escape(char))
        index += 1
    return re.compile("^" + "".join(out) + "$", re.IGNORECASE)


class FileTool(BaseTool):
    """文件工具箱"""
    name: str = "file"

    def __init__(self, scope: Optional[FileScope]) -> None:
        super().__init__()
        self.scope = scope

    async def invoke_for_call(self, tool_name: str, call_id: str, **kwargs) -> ToolResult:
        """把调用身份交给文件范围，工作区文件夹的变更记录据此归属到这次工具调用。"""
        if self.scope is None:
            return await self.invoke(tool_name, **kwargs)
        token = self.scope.bind_call(call_id)
        try:
            return await self.invoke(tool_name, **kwargs)
        finally:
            self.scope.reset_call(token)

    async def _target(self, raw: str) -> RootedPath:
        return self.scope.resolve(raw)

    async def _file_entry(self, path: RootedPath):
        entry = await self.scope.files.stat(path)
        if entry.kind is not FileKind.FILE:
            what = {FileKind.DIRECTORY: "是目录", FileKind.SYMLINK: "是符号链接，不读写链接"}.get(
                entry.kind, "是特殊文件，拒绝读写")
            raise WorkspaceFileError(ErrorCode.INVALID_REQUEST, f"{self.scope.display(path)} {what}")
        return entry

    @tool(
        name="read_file",
        description="读取文本文件内容，不读二进制。用于检查文件内容、分析日志或读取配置文件。路径是绝对路径或相对工作目录的路径。",
        parameters={
            "filepath": {"type": "string", "description": "要读取文件的路径"},
            "start_line": {"type": "integer", "description": "(可选)读取的起始行, 索引从 0 开始"},
            "end_line": {"type": "integer", "description": "(可选)结束行号, 不包含该行"},
            "max_length": {"type": "integer", "description": "(可选)读取文件内容的最大字符数, 默认为10000"},
        },
        required=["filepath"],
    )
    async def read_file(self, filepath: str, start_line: Optional[int] = None, end_line: Optional[int] = None,
                        max_length: int = DEFAULT_READ_CHARS) -> ToolResult:
        try:
            path = await self._target(filepath)
            entry = await self._file_entry(path)
            if (start_line is not None and start_line < 0) or (end_line is not None and end_line < 0) \
                    or max_length < 1:
                return ToolResult(success=False, message="start_line、end_line 与 max_length 必须是合法的非负范围")
            reader = await self.scope.files.open_reader(path, entry.version)
            text, last_line, truncated = await asyncio.to_thread(
                self._read_lines, reader, start_line or 0, end_line, max_length, self.scope.limits.read_bytes)
        except WorkspaceFileError as error:
            return failure(error)
        except UnicodeDecodeError:
            return ToolResult(success=False, message="文件不是 UTF-8 文本，read_file 不读取二进制；需要处理时用命令或代码")
        except ValueError as error:
            return ToolResult(success=False, message=str(error))
        return ToolResult(message="读取成功", data={
            "filepath": self.scope.display(path), "start_line": start_line or 0, "end_line": last_line,
            "size": entry.version.size, "truncated": truncated, "content": text})  # 内容在最后：预览的尾段是文件尾

    @staticmethod
    def _read_lines(reader: BinaryIO, start: int, end: Optional[int], max_chars: int, read_bytes: int):
        """返回 (文本, 结束行号, 是否截断)；逐块解码，遇到二进制或非 UTF-8 内容即失败。"""
        with reader:
            if b"\x00" in reader.read(PROBE_BYTES):
                raise ValueError("文件含有 NUL 字节，是二进制文件；read_file 不读取二进制")
            reader.seek(0)
            decoder = codecs.getincrementaldecoder("utf-8")("strict")
            lines, chars, scanned, index, open_line, truncated = [], 0, 0, 0, False, False
            limit = read_bytes * SCAN_FACTOR
            while True:
                raw = reader.readline(1024 * 1024)
                if not raw:
                    break
                if end is not None and index >= end:
                    break
                scanned += len(raw)
                if b"\x00" in raw:
                    raise ValueError("文件含有 NUL 字节，是二进制文件；read_file 不读取二进制")
                piece = decoder.decode(raw, final=False)
                if index >= start:
                    room = max_chars - chars
                    if len(piece) > room:
                        lines.append(piece[:room])
                        truncated = True
                        break
                    lines.append(piece)
                    chars += len(piece)
                open_line = not raw.endswith(b"\n")
                if not open_line:
                    index += 1
                if scanned >= limit:
                    truncated = True
                    break
            if not truncated:
                decoder.decode(b"", final=True)
            return "".join(lines), index + (1 if open_line and not truncated else 0), truncated

    @tool(
        name="write_file",
        description="对文件进行覆盖或追加写入。用于创建新文件、追加内容或修改现有文件；父目录不存在时自动创建。",
        parameters={
            "filepath": {"type": "string", "description": "要写入文件的路径（绝对路径或相对工作目录）"},
            "content": {"type": "string", "description": "要写入的文本内容"},
            "append": {"type": "boolean", "description": "(可选)是否使用追加模式"},
            "leading_newline": {"type": "boolean", "description": "(可选)是否添加前置换行符, 在内容开头"},
            "trailing_newline": {"type": "boolean", "description": "(可选)是否添加后置换行符, 在内容结尾"},
        },
        required=["filepath", "content"]
    )
    async def write_file(self, filepath: str, content: str, append: Optional[bool] = False,
                         leading_newline: Optional[bool] = False,
                         trailing_newline: Optional[bool] = False) -> ToolResult:
        text = ("\n" if leading_newline else "") + content + ("\n" if trailing_newline else "")
        data = text.encode("utf-8")
        try:
            path = await self._target(filepath)
            await self.scope.ensure_parent(path)
            try:
                existing = await self.scope.files.stat(path)
            except WorkspaceFileError as error:
                if error.code is not ErrorCode.NOT_FOUND:
                    raise
                existing = None
            if existing is not None and existing.kind is not FileKind.FILE:
                return await self._file_entry_failure(path)
            expected = existing.version if existing is not None else None
            if append and existing is not None:
                reader = await self.scope.files.open_reader(path, expected)
                version = await self.scope.write_stream(path, _Concat(reader, data), expected)
                reader.close()
            else:
                version = await self.scope.write_bytes(path, data, expected)
        except WorkspaceFileError as error:
            return failure(error)
        return ToolResult(message="写入成功", data={
            "filepath": self.scope.display(path), "bytes_written": len(data), "size": version.size,
            "created": existing is None, "append": bool(append) and existing is not None})

    async def _file_entry_failure(self, path: RootedPath) -> ToolResult:
        try:
            await self._file_entry(path)
        except WorkspaceFileError as error:
            return failure(error)
        return ToolResult(success=False, message="目标不是普通文件")

    @tool(
        name="replace_in_file",
        description="在文本文件中替换指定的字符串（全部出现处）。用于更新文件中的特定内容或修复代码中的错误。",
        parameters={
            "filepath": {"type": "string", "description": "要执行替换操作的文件的路径"},
            "old_str": {"type": "string", "description": "要被替换的原始字符串"},
            "new_str": {"type": "string", "description": "用于替换的新字符串"},
        },
        required=["filepath", "old_str", "new_str"]
    )
    async def replace_in_file(self, filepath: str, old_str: str, new_str: str) -> ToolResult:
        if not old_str:
            return ToolResult(success=False, message="old_str 不能为空")
        try:
            path = await self._target(filepath)
            entry = await self._file_entry(path)
            if entry.version.size > self.scope.limits.read_bytes:
                return ToolResult(success=False, message=f"文件超过 {self.scope.limits.read_bytes} 字节，"
                                                         "不能整体替换；请用命令或代码处理")
            raw = await self.scope.files.read_bytes(path, expected=entry.version)
            if b"\x00" in raw:
                return ToolResult(success=False, message="文件含有 NUL 字节，是二进制文件，不做文本替换")
            text = raw.decode("utf-8")
            count = text.count(old_str)
            if count == 0:
                return ToolResult(success=False, message="未找到要替换的字符串", data={"replaced": 0})
            version = await self.scope.write_bytes(path, text.replace(old_str, new_str).encode("utf-8"),
                                                   entry.version)
        except WorkspaceFileError as error:
            return failure(error)
        except UnicodeDecodeError:
            return ToolResult(success=False, message="文件不是 UTF-8 文本，不做文本替换")
        return ToolResult(message=f"已替换 {count} 处", data={
            "filepath": self.scope.display(path), "replaced": count, "size": version.size})

    @tool(
        name="search_in_file",
        description="在文本文件中按正则表达式搜索匹配的行。用于查找文件中的特定内容或模式；行号从 0 开始，与 read_file 一致。",
        parameters={
            "filepath": {"type": "string", "description": "要进行搜索的文件的路径"},
            "regex": {"type": "string", "description": "用于匹配的正则表达式模式"},
        },
        required=["filepath", "regex"]
    )
    async def search_in_file(self, filepath: str, regex: str) -> ToolResult:
        try:
            pattern = re.compile(regex)
        except re.error as error:
            return ToolResult(success=False, message=f"正则表达式无效：{error}")
        try:
            path = await self._target(filepath)
            entry = await self._file_entry(path)
            reader = await self.scope.files.open_reader(path, entry.version)
            matches, truncated = await asyncio.to_thread(
                self._search, reader, pattern, self.scope.limits.search_matches,
                self.scope.limits.read_bytes * SCAN_FACTOR)
        except WorkspaceFileError as error:
            return failure(error)
        except UnicodeDecodeError:
            return ToolResult(success=False, message="文件不是 UTF-8 文本，不做文本搜索")
        except ValueError as error:
            return ToolResult(success=False, message=str(error))
        return ToolResult(message=f"找到 {len(matches)} 处匹配" + ("，结果已截断" if truncated else ""), data={
            "filepath": self.scope.display(path), "matches": matches, "truncated": truncated})

    @staticmethod
    def _search(reader: BinaryIO, pattern: re.Pattern, cap: int, scan_limit: int):
        matches, scanned, truncated = [], 0, False
        with reader:
            if b"\x00" in reader.read(PROBE_BYTES):
                raise ValueError("文件含有 NUL 字节，是二进制文件，不做文本搜索")
            reader.seek(0)
            for index, raw in enumerate(reader):
                scanned += len(raw)
                if scanned > scan_limit:
                    truncated = True
                    break
                line = raw.decode("utf-8").rstrip("\r\n")
                if pattern.search(line[:MAX_LINE_CHARS]):
                    if len(matches) >= cap:
                        truncated = True
                        break
                    matches.append({"line": index, "text": line[:500]})
        return matches, truncated

    @tool(
        name="list_dir",
        description="列出目录下的直接子项（名称、类型、大小）。符号链接只标出类型与指向文本，不展开；已排除版本库内部目录、依赖缓存与凭据类文件。",
        parameters={
            "dir_path": {"type": "string", "description": "要列出的目录的路径；省略为工作目录"},
        },
        required=[]
    )
    async def list_dir(self, dir_path: Optional[str] = None) -> ToolResult:
        try:
            path = await self._target(dir_path or self.scope.working.path)
            listing = await self.scope.files.list_dir(path)
        except WorkspaceFileError as error:
            return failure(error)
        entries = [{"name": entry.name, "kind": entry.kind.value,
                    **({"size": entry.version.size} if entry.version else {}),
                    **({"link_target": entry.link_target} if entry.link_target else {})}
                   for entry in listing.entries]
        return ToolResult(message=f"{len(entries)} 项" + ("，结果已截断" if listing.truncated else ""), data={
            "dir_path": self.scope.display(path), "entries": entries, "truncated": listing.truncated})

    @tool(
        name="find_files",
        description="在指定目录树中根据名称模式查找文件。模式用 glob 语法：不含 / 时匹配任意深度的文件名，含 / 时匹配相对目录的路径，`**` 可跨目录。",
        parameters={
            "dir_path": {"type": "string", "description": "要搜索的目录的路径"},
            "glob_pattern": {"type": "string", "description": "使用 glob 语法通配符的文件名模式"},
        },
        required=["dir_path", "glob_pattern"]
    )
    async def find_files(self, dir_path: str, glob_pattern: str) -> ToolResult:
        if not glob_pattern:
            return ToolResult(success=False, message="glob_pattern 不能为空")
        matcher = _glob_regex(glob_pattern)
        by_name = "/" not in glob_pattern
        limits = self.scope.limits
        try:
            start = await self._target(dir_path)
            base = relative_parts(start.relative_path)
            found, visited, truncated, pending = [], 0, False, [start]
            while pending and not truncated:
                current = pending.pop()
                listing = await self.scope.files.list_dir(current)
                truncated = truncated or listing.truncated
                for entry in listing.entries:
                    visited += 1
                    if visited > limits.find_entries:
                        truncated = True
                        break
                    if entry.kind is FileKind.DIRECTORY:
                        pending.append(entry.path)
                    elif entry.kind is FileKind.FILE:
                        relative = "/".join(relative_parts(entry.path.relative_path)[len(base):])
                        if matcher.match(entry.name if by_name else relative):
                            if len(found) >= limits.find_results:
                                truncated = True
                                break
                            found.append(self.scope.display(entry.path))
                if len(found) >= limits.find_results and truncated:
                    break
        except WorkspaceFileError as error:
            return failure(error)
        found.sort()
        return ToolResult(message=f"找到 {len(found)} 个文件" + ("，结果已截断" if truncated else ""), data={
            "dir_path": self.scope.display(start), "files": found, "truncated": truncated})
