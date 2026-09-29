#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""项目目录的 Git 只读读取：参数列表调用 git 子进程，读的是 API 容器内的只读挂载。

沙箱对同一目录可写，Agent 能改 ``.git/config`` 与 ``.gitattributes``；API 以 root 运行并持有 docker.sock，
所以这里不能让仓库配置在 API 侧执行命令：关闭 fsmonitor 与钩子，列出仓库里定义的 filter 驱动并置空，
diff 不用外部 diff 与 textconv，不读系统与全局配置，工作区固定为项目目录，不向上查找父目录里的仓库，
禁止任何网络传输，并忽略子模块（子模块里的 git 会读它自己的配置）。
"""
import asyncio
import logging
import os
import re
import signal
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from app.domain.external.project import ProjectGit
from app.domain.models.project import (
    GIT_DIFF_MAX_BYTES,
    GIT_STATUS_ENTRY_LIMIT,
    GIT_TIMEOUT_SECONDS,
    GitChange,
    GitConflict,
    GitDiff,
    GitDiffFile,
    GitDiffScope,
    GitStatus,
    GitStatusEntry,
    ProjectPathError,
)
from app.domain.services.project_paths import check_project_path, resolve_in_project

logger = logging.getLogger(__name__)

STATUS_MAX_BYTES = 4 * 1024 * 1024
NUMSTAT_MAX_BYTES = 1024 * 1024
CONFIG_MAX_BYTES = 1024 * 1024
STDERR_MAX_BYTES = 64 * 1024

# 固定覆盖项，经 GIT_CONFIG_COUNT 以命令行级别注入，优先于仓库配置
HARDENING_CONFIG: Tuple[Tuple[str, str], ...] = (
    ("core.fsmonitor", "false"),
    ("core.hooksPath", "/dev/null"),
    ("core.pager", "cat"),
    ("diff.external", ""),
    ("diff.noprefix", "false"),
    ("diff.mnemonicPrefix", "false"),
    ("diff.relative", "false"),
    ("color.ui", "false"),
    ("protocol.allow", "never"),
    ("submodule.recurse", "false"),
    ("status.submoduleSummary", "false"),
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
)
_DRIVER_KEY = re.compile(r"^(filter|diff)\.(.+)\.([^.]+)$", re.S)
_FILTER_OVERRIDES = (("clean", ""), ("smudge", ""), ("process", ""), ("required", "false"))
_DIFF_DRIVER_OVERRIDES = (("command", ""), ("textconv", ""))

_CHANGE: Dict[str, GitChange] = {
    "M": "modified", "T": "type_changed", "A": "added", "D": "deleted",
    "R": "renamed", "C": "copied", "U": "unmerged",
}
_CONFLICT: Dict[str, GitConflict] = {
    "DD": "both_deleted", "AU": "added_by_us", "UD": "deleted_by_them", "UA": "added_by_them",
    "DU": "deleted_by_us", "AA": "both_added", "UU": "both_modified",
}


@dataclass
class GitRun:
    code: Optional[int]
    stdout: bytes
    stderr: str
    truncated: bool = False
    timed_out: bool = False


class _GitFailure(Exception):
    """一次 git 调用超时或失败，转成结果的 state。"""

    def __init__(self, state: str, error: str) -> None:
        self.state = state
        self.error = error
        super().__init__(error)


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def _change(code: str) -> Optional[GitChange]:
    return _CHANGE.get(code)


def _kill_group(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def _read_capped(stream: asyncio.StreamReader, limit: int) -> Tuple[bytes, bool]:
    """读到 EOF 或超过 limit 为止；超过时返回前 limit 字节与 True。"""
    chunks: List[bytes] = []
    size = 0
    while True:
        chunk = await stream.read(64 * 1024)
        if not chunk:
            return b"".join(chunks), False
        chunks.append(chunk)
        size += len(chunk)
        if size > limit:
            return b"".join(chunks)[:limit], True


async def _drain(stream: asyncio.StreamReader, limit: int) -> bytes:
    """读完整个流以免子进程阻塞在管道上，只保留前 limit 字节。"""
    kept = bytearray()
    while True:
        chunk = await stream.read(64 * 1024)
        if not chunk:
            return bytes(kept)
        if len(kept) < limit:
            kept.extend(chunk[:limit - len(kept)])


def parse_status_v2(data: bytes, limit: int) -> GitStatus:
    """解析 ``status --porcelain=v2 -z --branch`` 的输出。"""
    status = GitStatus(state="ok", limit=limit)
    tokens = data.split(b"\x00")
    if tokens and tokens[-1] == b"":
        tokens.pop()
    i = 0
    while i < len(tokens):
        record = _decode(tokens[i])
        i += 1
        if record.startswith("# "):
            key, _, value = record[2:].partition(" ")
            if key == "branch.oid":
                status.initial = value == "(initial)"
                status.oid = None if status.initial else value
            elif key == "branch.head":
                status.detached = value == "(detached)"
                status.branch = None if status.detached else value
            elif key == "branch.upstream":
                status.upstream = value
            elif key == "branch.ab":
                parts = value.split()
                if len(parts) == 2:
                    status.ahead = int(parts[0].lstrip("+"))
                    status.behind = int(parts[1].lstrip("-"))
            continue

        entry: Optional[GitStatusEntry] = None
        kind = record[:1]
        if kind == "1":
            fields = record.split(" ", 8)
            if len(fields) == 9:
                xy = fields[1]
                entry = GitStatusEntry(kind="ordinary", path=fields[8], xy=xy,
                                       index=_change(xy[0]), worktree=_change(xy[1]))
        elif kind == "2":
            fields = record.split(" ", 9)
            if len(fields) == 10 and i < len(tokens):
                orig = _decode(tokens[i])
                i += 1
                xy = fields[1]
                entry = GitStatusEntry(
                    kind="copied" if "C" in xy else "renamed", path=fields[9], orig_path=orig, xy=xy,
                    index=_change(xy[0]), worktree=_change(xy[1]),
                )
            else:
                # 截断在重命名条目的两段路径之间
                break
        elif kind == "u":
            fields = record.split(" ", 10)
            if len(fields) == 11:
                xy = fields[1]
                entry = GitStatusEntry(kind="unmerged", path=fields[10], xy=xy, conflict=_CONFLICT.get(xy))
        elif kind == "?":
            entry = GitStatusEntry(kind="untracked", path=record[2:], xy="??")
        if entry is None:
            continue
        if len(status.entries) >= limit:
            status.truncated = True
            break
        status.entries.append(entry)
    return status


def parse_numstat_z(data: bytes, limit: int) -> Tuple[List[GitDiffFile], bool]:
    """解析 ``diff --numstat -z``。重命名为 ``增\\t删\\t\\0原路径\\0新路径\\0``。"""
    tokens = data.split(b"\x00")
    if tokens and tokens[-1] == b"":
        tokens.pop()
    files: List[GitDiffFile] = []
    i = 0
    while i < len(tokens):
        head = _decode(tokens[i])
        i += 1
        parts = head.split("\t", 2)
        if len(parts) != 3:
            continue
        added, deleted, path = parts
        orig = None
        if path == "":
            if i + 1 >= len(tokens):
                break
            orig, path = _decode(tokens[i]), _decode(tokens[i + 1])
            i += 2
            if orig == "/dev/null":
                orig = None
        if len(files) >= limit:
            return files, True
        binary = added == "-" and deleted == "-"
        files.append(GitDiffFile(
            path=path, orig_path=orig, binary=binary,
            additions=None if binary else int(added), deletions=None if binary else int(deleted),
        ))
    return files, False


class _Deadline:
    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds

    def remaining(self) -> float:
        return self._end - time.monotonic()


class GitCliReader(ProjectGit):
    """``git -C <path> -c safe.directory=<path> -c core.quotepath=false --no-optional-locks …``。"""

    def __init__(
            self,
            roots: Sequence[str],
            git_binary: str = "git",
            timeout: float = GIT_TIMEOUT_SECONDS,
            status_limit: int = GIT_STATUS_ENTRY_LIMIT,
            diff_max_bytes: int = GIT_DIFF_MAX_BYTES,
            status_max_bytes: int = STATUS_MAX_BYTES,
    ) -> None:
        self._roots = list(roots)
        self._git = git_binary
        self._timeout = timeout
        self._status_limit = status_limit
        self._diff_max_bytes = diff_max_bytes
        self._status_max_bytes = status_max_bytes

    # ---- 公共接口 ----

    async def status(self, project_path: str) -> GitStatus:
        repo = self._check_project(project_path)
        deadline = _Deadline(self._timeout)
        try:
            overrides = await self._open_repo(repo, deadline)
            if overrides is None:
                return GitStatus(state="not_a_repository", limit=self._status_limit)
            run = await self._git_run(
                repo, overrides, deadline, self._status_max_bytes,
                "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all",
                "--ignore-submodules=all", "--renames", "--ahead-behind",
            )
            self._ensure_ok(run, "status")
        except _GitFailure as e:
            return GitStatus(state=e.state, error=e.error, limit=self._status_limit)

        data = run.stdout
        if run.truncated:
            data = data[:data.rfind(b"\x00") + 1]
        status = parse_status_v2(data, self._status_limit)
        status.truncated = status.truncated or run.truncated
        return status

    async def diff(self, project_path: str, scope: GitDiffScope = "worktree", path: Optional[str] = None) -> GitDiff:
        if scope not in ("worktree", "staged"):
            raise ValueError(f"不支持的 diff 范围: {scope}")
        repo = self._check_project(project_path)
        rel: Optional[str] = None
        if path is not None:
            check = resolve_in_project(repo, path, self._roots, must_exist=False)
            if not check.ok:
                raise ProjectPathError(check)
            rel = check.relative or None

        result = GitDiff(state="ok", scope=scope, path=rel, max_bytes=self._diff_max_bytes)
        deadline = _Deadline(self._timeout)
        try:
            overrides = await self._open_repo(repo, deadline)
            if overrides is None:
                return result.model_copy(update={"state": "not_a_repository"})

            if scope == "staged":
                base = await self._staged_base(repo, overrides, deadline)
                prefix = ["diff", "--cached", base]
                ok_codes = (0,)
            elif rel is not None and await self._is_untracked(repo, overrides, deadline, rel):
                # 未跟踪文件相对空文件比较，显示为全部新增；这里要求 realpath 仍在项目内
                file_check = resolve_in_project(repo, rel, self._roots, expect="file")
                if not file_check.ok:
                    raise ProjectPathError(file_check)
                result.untracked = True
                prefix = ["diff", "--no-index"]
                ok_codes = (0, 1)
            else:
                prefix = ["diff"]
                ok_codes = (0,)

            common = ["--no-ext-diff", "--no-textconv", "--no-color"]
            if result.untracked:
                tail = ["--", "/dev/null", rel]
            else:
                common += ["-M", "--ignore-submodules=all"]
                tail = ["--", rel] if rel else []

            numstat = await self._git_run(repo, overrides, deadline, NUMSTAT_MAX_BYTES,
                                          *prefix, *common, "--numstat", "-z", *tail)
            self._ensure_ok(numstat, "diff --numstat", ok_codes)
            patch = await self._git_run(repo, overrides, deadline, self._diff_max_bytes,
                                        *prefix, *common, *tail)
            self._ensure_ok(patch, "diff", ok_codes)
        except _GitFailure as e:
            return result.model_copy(update={"state": e.state, "error": e.error})

        numstat_data = numstat.stdout
        if numstat.truncated:
            numstat_data = numstat_data[:numstat_data.rfind(b"\x00") + 1]
        files, files_truncated = parse_numstat_z(numstat_data, self._status_limit)
        text = patch.stdout
        if patch.truncated:
            cut = text.rfind(b"\n")
            text = text[:cut + 1] if cut >= 0 else b""
        result.files = files
        result.diff = _decode(text)
        result.truncated = patch.truncated or numstat.truncated or files_truncated
        return result

    # ---- 仓库准备 ----

    def _check_project(self, project_path: str) -> str:
        check = check_project_path(project_path, self._roots)
        if not check.ok:
            raise ProjectPathError(check)
        return check.real_path

    async def _open_repo(self, repo: str, deadline: _Deadline) -> Optional[List[Tuple[str, str]]]:
        """确认项目目录本身是工作区根；不是仓库时返回 None。否则返回本仓库需要的全部配置覆盖。"""
        overrides = list(HARDENING_CONFIG)
        run = await self._git_run(repo, overrides, deadline, CONFIG_MAX_BYTES,
                                  "rev-parse", "--is-inside-work-tree", "--show-toplevel")
        if run.timed_out:
            raise _GitFailure("timeout", f"git 读取超过 {self._timeout:g} 秒")
        if run.code != 0:
            if "not a git repository" in run.stderr.lower():
                return None
            raise _GitFailure("error", self._error_text("rev-parse", run))
        lines = _decode(run.stdout).splitlines()
        if not lines or lines[0].strip() != "true":
            return None
        if len(lines) < 2 or os.path.realpath(lines[1].strip()) != repo:
            return None

        config = await self._git_run(repo, overrides, deadline, CONFIG_MAX_BYTES, "config", "--list", "-z")
        self._ensure_ok(config, "config --list")
        if config.truncated:
            # 读不全就无法确认 filter 驱动都已置空，不继续
            raise _GitFailure("error", "仓库配置超过读取上限，未读取 Git 状态")
        overrides.extend(self._driver_overrides(config.stdout))
        return overrides

    @staticmethod
    def _driver_overrides(config_data: bytes) -> List[Tuple[str, str]]:
        """仓库配置里出现的 filter 与 diff 驱动全部置空，驱动名来自配置本身。"""
        filters, drivers = set(), set()
        for record in config_data.split(b"\x00"):
            if not record:
                continue
            key = _decode(record.split(b"\n", 1)[0])
            match = _DRIVER_KEY.match(key)
            if not match:
                continue
            section, name = match.group(1).lower(), match.group(2)
            (filters if section == "filter" else drivers).add(name)
        overrides: List[Tuple[str, str]] = []
        for name in sorted(filters):
            overrides.extend((f"filter.{name}.{field}", value) for field, value in _FILTER_OVERRIDES)
        for name in sorted(drivers):
            overrides.extend((f"diff.{name}.{field}", value) for field, value in _DIFF_DRIVER_OVERRIDES)
        return overrides

    async def _staged_base(self, repo: str, overrides, deadline: _Deadline) -> str:
        head = await self._git_run(repo, overrides, deadline, CONFIG_MAX_BYTES,
                                   "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
        if head.timed_out:
            raise _GitFailure("timeout", f"git 读取超过 {self._timeout:g} 秒")
        if head.code == 0:
            return "HEAD"
        # 没有提交的新仓库：暂存区以空树为基准（按仓库的对象格式计算，不写入对象库）
        empty = await self._git_run(repo, overrides, deadline, CONFIG_MAX_BYTES,
                                    "hash-object", "-t", "tree", "--stdin")
        self._ensure_ok(empty, "hash-object")
        return _decode(empty.stdout).strip()

    async def _is_untracked(self, repo: str, overrides, deadline: _Deadline, rel: str) -> bool:
        run = await self._git_run(repo, overrides, deadline, CONFIG_MAX_BYTES,
                                  "ls-files", "-z", "--others", "--exclude-standard", "--", rel)
        self._ensure_ok(run, "ls-files")
        return rel in {_decode(item) for item in run.stdout.split(b"\x00") if item}

    # ---- 子进程 ----

    def _ensure_ok(self, run: GitRun, what: str, ok_codes: Sequence[int] = (0,)) -> None:
        if run.timed_out:
            raise _GitFailure("timeout", f"git 读取超过 {self._timeout:g} 秒")
        if run.truncated:
            return
        if run.code not in ok_codes:
            raise _GitFailure("error", self._error_text(what, run))

    @staticmethod
    def _error_text(what: str, run: GitRun) -> str:
        message = run.stderr.strip()[:500] or f"退出码 {run.code}"
        return f"git {what} 失败: {message}"

    def _command(self, repo: str, args: Sequence[str]) -> List[str]:
        return [
            self._git, "-C", repo,
            "-c", f"safe.directory={repo}",
            "-c", "core.quotepath=false",
            "--no-optional-locks",
            "--literal-pathspecs",
            "--no-pager",
            *args,
        ]

    @staticmethod
    def _env(repo: str, overrides: Sequence[Tuple[str, str]]) -> Dict[str, str]:
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", "/nonexistent"),
            "LC_ALL": "C",
            "LANG": "C",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_WORK_TREE": repo,
            "GIT_CEILING_DIRECTORIES": os.path.dirname(repo),
            "GIT_NO_LAZY_FETCH": "1",
            "GIT_PAGER": "cat",
            "PAGER": "cat",
            "GIT_CONFIG_COUNT": str(len(overrides)),
        }
        for index, (key, value) in enumerate(overrides):
            env[f"GIT_CONFIG_KEY_{index}"] = key
            env[f"GIT_CONFIG_VALUE_{index}"] = value
        return env

    async def _git_run(self, repo: str, overrides: Sequence[Tuple[str, str]], deadline: _Deadline,
                       max_bytes: int, *args: str) -> GitRun:
        remaining = deadline.remaining()
        if remaining <= 0:
            return GitRun(code=None, stdout=b"", stderr="", timed_out=True)
        return await self.run_git(self._command(repo, args), self._env(repo, overrides), remaining, max_bytes)

    @staticmethod
    async def run_git(command: Sequence[str], env: Dict[str, str], timeout: float, max_bytes: int) -> GitRun:
        """运行一次 git。超时、输出超过上限或调用被取消时杀掉整个进程组并等待其退出。"""
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            start_new_session=True,
        )
        stderr_task = asyncio.ensure_future(_drain(proc.stderr, STDERR_MAX_BYTES))

        async def collect() -> Tuple[bytes, bool]:
            data, cut = await _read_capped(proc.stdout, max_bytes)
            if cut:
                _kill_group(proc)
            await proc.wait()
            return data, cut

        stdout, truncated, timed_out = b"", False, False
        try:
            try:
                stdout, truncated = await asyncio.wait_for(collect(), timeout)
            except asyncio.TimeoutError:
                timed_out = True
        finally:
            _kill_group(proc)
            await proc.wait()
            try:
                stderr = await asyncio.wait_for(stderr_task, 1.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                stderr_task.cancel()
                stderr = b""
        if timed_out:
            logger.warning("git 调用超时，已终止: %s", " ".join(command[3:8]))
        return GitRun(code=proc.returncode, stdout=stdout, stderr=_decode(stderr),
                      truncated=truncated, timed_out=timed_out)
