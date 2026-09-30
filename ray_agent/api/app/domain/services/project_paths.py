#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""项目路径校验：绑定、浏览与读文件都经过这里。

项目路径依次检查：取 realpath（解析 ``..`` 与全部符号链接）→ 是否在某个允许根目录的 realpath 之内（按路径段比较）
→ 是否存在 → 是否为目录。项目内的相对路径先让项目本身通过上述检查，再取 realpath，结果必须仍在项目 realpath 之内。
根目录之外的路径不报告是否存在。
"""
import os
import posixpath
from typing import Iterable, List, Literal, Optional, Sequence

from app.domain.models.project import (
    PATH_CHECK_MESSAGES,
    PathCheck,
    PathCheckReason,
    ProjectRoot,
)

Expect = Literal["any", "directory", "file"]


def is_within(path: str, base: str) -> bool:
    """``path`` 等于 ``base`` 或在其下。按路径段比较，两者都应已是 realpath。"""
    try:
        return os.path.commonpath([path, base]) == base
    except ValueError:
        return False


def _invalid(value: object) -> bool:
    return not isinstance(value, str) or "\x00" in value


def _fail(path: str, reason: PathCheckReason, real_path: Optional[str] = None,
          root: Optional[str] = None, relative: Optional[str] = None) -> PathCheck:
    return PathCheck(
        ok=False, path=path, real_path=real_path, root=root, relative=relative,
        reason=reason, message=PATH_CHECK_MESSAGES[reason],
    )


def resolve_roots(roots: Iterable[str]) -> List[ProjectRoot]:
    """把配置的根目录取 realpath，并标出不存在或不是目录的根。解析到文件系统根的项不可用。"""
    resolved: List[ProjectRoot] = []
    for configured in roots:
        if _invalid(configured) or not configured or not os.path.isabs(configured):
            continue
        real = os.path.realpath(configured)
        reason = None
        if real == "/":
            reason = PathCheckReason.INVALID_PATH
        elif not os.path.exists(real):
            reason = PathCheckReason.NOT_FOUND
        elif not os.path.isdir(real):
            reason = PathCheckReason.NOT_DIRECTORY
        resolved.append(ProjectRoot(configured=configured, path=real, available=reason is None, reason=reason))
    return resolved


def real_roots(roots: Sequence[str]) -> List[str]:
    """允许根目录的 realpath；解析到文件系统根的项丢弃。"""
    resolved = [os.path.realpath(root) for root in roots
                if not _invalid(root) and root and os.path.isabs(root)]
    return [root for root in resolved if root != "/"]


def check_project_path(path: str, roots: Sequence[str]) -> PathCheck:
    """校验一个宿主机项目目录。通过时 ``real_path`` 可直接作为沙箱绑定源。"""
    allowed = real_roots(roots)
    if not allowed:
        return _fail(path if isinstance(path, str) else "", PathCheckReason.NO_ROOTS)
    if _invalid(path) or not path.strip() or not os.path.isabs(path):
        return _fail(path if isinstance(path, str) else "", PathCheckReason.INVALID_PATH)

    real = os.path.realpath(path)
    root = next((r for r in allowed if is_within(real, r)), None)
    if root is None:
        return _fail(path, PathCheckReason.OUTSIDE_ROOTS, real_path=real)
    if not os.path.exists(real):
        return _fail(path, PathCheckReason.NOT_FOUND, real_path=real, root=root)
    if not os.path.isdir(real):
        return _fail(path, PathCheckReason.NOT_DIRECTORY, real_path=real, root=root)
    return PathCheck(ok=True, path=path, real_path=real, root=root)


def normalize_relative(relative: Optional[str]) -> Optional[str]:
    """项目内路径的规范 POSIX 形式，项目根为 ""。绝对路径、含 NUL 或经 .. 离开项目时返回 None。"""
    if relative is None:
        return ""
    if _invalid(relative) or relative.startswith("/") or os.path.isabs(relative):
        return None
    normalized = posixpath.normpath(relative) if relative else "."
    if normalized == ".." or normalized.startswith("../"):
        return None
    return "" if normalized == "." else normalized


def resolve_in_project(
        project_path: str,
        relative: Optional[str],
        roots: Sequence[str],
        expect: Expect = "any",
        must_exist: bool = True,
) -> PathCheck:
    """校验项目内的相对路径。

    ``must_exist`` 为 True 时（文件树与读文件）对完整路径取 realpath，符号链接指向项目外即拒绝。
    为 False 时（目标可能尚不存在）只做词法检查，
    并要求父目录的 realpath 仍在项目内，``real_path`` 为未解析最后一段的拼接路径。
    """
    if relative is None:
        relative = ""
    raw = relative if isinstance(relative, str) else ""
    project = check_project_path(project_path, roots)
    if not project.ok:
        return project.model_copy(update={"path": raw})
    project_real = project.real_path

    if _invalid(relative) or relative.startswith("/") or os.path.isabs(relative):
        return _fail(raw, PathCheckReason.INVALID_PATH, root=project.root)
    normalized = normalize_relative(relative)
    if normalized is None:
        return _fail(raw, PathCheckReason.ESCAPES_PROJECT, root=project.root)

    candidate = os.path.join(project_real, normalized) if normalized else project_real
    if not must_exist:
        parent_real = os.path.realpath(os.path.dirname(candidate)) if normalized else project_real
        if not is_within(parent_real, project_real):
            return _fail(raw, PathCheckReason.ESCAPES_PROJECT, real_path=parent_real,
                         root=project.root, relative=normalized)
        return PathCheck(ok=True, path=raw, real_path=candidate, root=project.root, relative=normalized)

    real = os.path.realpath(candidate)
    if not is_within(real, project_real):
        return _fail(raw, PathCheckReason.ESCAPES_PROJECT, real_path=real, root=project.root, relative=normalized)
    if not os.path.exists(real):
        return _fail(raw, PathCheckReason.NOT_FOUND, real_path=real, root=project.root, relative=normalized)
    if expect == "directory" and not os.path.isdir(real):
        return _fail(raw, PathCheckReason.NOT_DIRECTORY, real_path=real, root=project.root, relative=normalized)
    if expect == "file" and not os.path.isfile(real):
        return _fail(raw, PathCheckReason.NOT_FILE, real_path=real, root=project.root, relative=normalized)
    return PathCheck(ok=True, path=raw, real_path=real, root=project.root, relative=normalized)
