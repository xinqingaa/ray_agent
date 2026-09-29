#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""W10 文件浏览：忽略目录、条目上限截断、符号链接不跟随到项目外、过大与二进制只返回元数据、根目录浏览。"""
import asyncio
import os

import pytest

from app.domain.models.project import PathCheckReason, ProjectPathError
from app.infrastructure.external.project.local_project_files import LocalProjectFiles


def _write(path, data=b"x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


@pytest.fixture
def project(tmp_path):
    base = os.path.realpath(tmp_path)
    root = os.path.join(base, "root")
    proj = os.path.join(root, "proj")
    for name in (".git", "node_modules", ".venv", "__pycache__", ".next"):
        os.makedirs(os.path.join(proj, name))
    _write(os.path.join(proj, ".DS_Store"))
    _write(os.path.join(proj, "src", "app.py"), b"print('hi')\n")
    _write(os.path.join(proj, "README.md"), "# 标题\n".encode())
    _write(os.path.join(proj, ".env.example"), b"A=1\n")
    outside = os.path.join(base, "outside")
    _write(os.path.join(outside, "secret.txt"), b"secret")
    return {"root": root, "proj": proj, "outside": outside, "files": LocalProjectFiles([root])}


def test_list_directory_ignores_and_orders(project):
    listing = project["files"].list_directory_sync(project["proj"], "")
    names = [e.name for e in listing.entries]
    assert names == ["src", ".env.example", "README.md"]
    assert listing.total == 3 and not listing.truncated
    src = listing.entries[0]
    assert src.type == "directory" and src.path == "src" and src.size is None
    readme = listing.entries[2]
    assert readme.type == "file" and readme.size == len("# 标题\n".encode()) and readme.modified_at > 0

    nested = project["files"].list_directory_sync(project["proj"], "src")
    assert [e.path for e in nested.entries] == ["src/app.py"]


def test_list_directory_truncates(project):
    for i in range(12):
        _write(os.path.join(project["proj"], "many", f"f{i:02d}.txt"))
    files = LocalProjectFiles([project["root"]], entry_limit=5)
    listing = files.list_directory_sync(project["proj"], "many")
    assert listing.truncated and listing.total == 12 and len(listing.entries) == 5
    assert [e.name for e in listing.entries] == [f"f{i:02d}.txt" for i in range(5)]


def test_symlinks_inside_follow_outside_do_not(project):
    proj = project["proj"]
    os.symlink("src", os.path.join(proj, "code"))
    os.symlink(os.path.join(project["outside"], "secret.txt"), os.path.join(proj, "leak.txt"))
    os.symlink(project["outside"], os.path.join(proj, "leakdir"))
    os.symlink(os.path.join(proj, "gone"), os.path.join(proj, "broken"))
    entries = {e.name: e for e in project["files"].list_directory_sync(proj).entries}

    assert entries["code"].type == "directory" and entries["code"].link == "inside" and entries["code"].is_symlink
    for name in ("leak.txt", "leakdir"):
        assert entries[name].type == "symlink" and entries[name].link == "outside" and entries[name].size is None
    assert entries["broken"].type == "symlink" and entries["broken"].link == "broken"

    # 经项目内链接展开可以，经项目外链接展开或读取被拒绝
    assert [e.name for e in project["files"].list_directory_sync(proj, "code").entries] == ["app.py"]
    with pytest.raises(ProjectPathError) as exc:
        project["files"].list_directory_sync(proj, "leakdir")
    assert exc.value.reason == PathCheckReason.ESCAPES_PROJECT
    with pytest.raises(ProjectPathError) as exc:
        project["files"].read_file_sync(proj, "leak.txt")
    assert exc.value.reason == PathCheckReason.ESCAPES_PROJECT


def test_list_directory_rejects_escape_and_files(project):
    with pytest.raises(ProjectPathError) as exc:
        project["files"].list_directory_sync(project["proj"], "../..")
    assert exc.value.reason == PathCheckReason.ESCAPES_PROJECT
    with pytest.raises(ProjectPathError) as exc:
        project["files"].list_directory_sync(project["proj"], "README.md")
    assert exc.value.reason == PathCheckReason.NOT_DIRECTORY
    with pytest.raises(ProjectPathError) as exc:
        project["files"].list_directory_sync(project["outside"], "")
    assert exc.value.reason == PathCheckReason.OUTSIDE_ROOTS


def test_read_text_file(project):
    result = project["files"].read_file_sync(project["proj"], "README.md")
    assert result.kind == "text" and result.content == "# 标题\n" and result.name == "README.md"


def test_read_binary_returns_metadata_only(project):
    _write(os.path.join(project["proj"], "img.bin"), b"PNG" + b"\x00" * 10 + b"tail")
    result = project["files"].read_file_sync(project["proj"], "img.bin")
    assert result.kind == "binary" and result.content is None and result.size == 17


def test_read_nul_after_sniff_window_is_text(project):
    _write(os.path.join(project["proj"], "late.txt"), b"a" * 64 + b"\x00")
    files = LocalProjectFiles([project["root"]], sniff_bytes=16)
    assert files.read_file_sync(project["proj"], "late.txt").kind == "text"


def test_read_too_large_returns_metadata_only(project):
    _write(os.path.join(project["proj"], "big.txt"), b"a" * 2048)
    files = LocalProjectFiles([project["root"]], max_file_bytes=1024)
    result = files.read_file_sync(project["proj"], "big.txt")
    assert result.kind == "too_large" and result.content is None and result.size == 2048
    exact = LocalProjectFiles([project["root"]], max_file_bytes=2048).read_file_sync(project["proj"], "big.txt")
    assert exact.kind == "text" and len(exact.content) == 2048


def test_read_directory_rejected(project):
    with pytest.raises(ProjectPathError) as exc:
        project["files"].read_file_sync(project["proj"], "src")
    assert exc.value.reason == PathCheckReason.NOT_FILE


def test_async_wrappers(project):
    listing = asyncio.run(project["files"].list_directory(project["proj"], "src"))
    assert listing.entries[0].name == "app.py"
    assert asyncio.run(project["files"].read_file(project["proj"], "src/app.py")).content == "print('hi')\n"


def test_browse_lists_directories_and_git_repos(project):
    root = project["root"]
    os.makedirs(os.path.join(root, "plain"))
    _write(os.path.join(root, "file.txt"))
    os.makedirs(os.path.join(root, "node_modules"))
    os.symlink(project["outside"], os.path.join(root, "outlink"))
    os.symlink(os.path.join(root, "plain"), os.path.join(root, "inlink"))
    worktree = os.path.join(root, "wt")
    _write(os.path.join(worktree, ".git"), b"gitdir: /elsewhere\n")

    listing = asyncio.run(project["files"].browse(root))
    assert listing.path == root and listing.root == root and listing.parent is None
    by_name = {e.name: e for e in listing.entries}
    assert list(by_name) == ["inlink", "plain", "proj", "wt"]
    assert by_name["proj"].is_git_repo and by_name["wt"].is_git_repo and not by_name["plain"].is_git_repo
    assert by_name["inlink"].is_symlink
    assert by_name["proj"].path == os.path.join(root, "proj")

    inner = project["files"].browse_sync(os.path.join(root, "proj"))
    assert inner.parent == root and inner.is_git_repo
    assert [e.name for e in inner.entries] == ["src"]

    with pytest.raises(ProjectPathError) as exc:
        project["files"].browse_sync(project["outside"])
    assert exc.value.reason == PathCheckReason.OUTSIDE_ROOTS


def test_browse_truncates(project):
    for i in range(7):
        os.makedirs(os.path.join(project["root"], f"d{i}"))
    listing = LocalProjectFiles([project["root"]], entry_limit=3).browse_sync(project["root"])
    assert listing.truncated and listing.total == 8 and len(listing.entries) == 3
