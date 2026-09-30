#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""W10 Git 只读读取：在临时仓库上核对 status 与 diff，非仓库、超时、大小上限，以及仓库配置不能让 API 执行命令。"""
import asyncio
import os
import shutil
import stat
import subprocess
import time

import pytest

from app.domain.models.project import PathCheckReason, ProjectPathError
from app.infrastructure.external.project.git_reader import GitCliReader, parse_status_v2

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="需要 git")

GIT_ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], env=GIT_ENV, check=True,
                          capture_output=True, text=True).stdout


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb" if isinstance(data, bytes) else "w") as f:
        f.write(data)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def root(tmp_path):
    path = os.path.join(os.path.realpath(tmp_path), "root")
    os.makedirs(path)
    return path


def make_repo(root, name="repo", commit=True):
    repo = os.path.join(root, name)
    os.makedirs(repo)
    git(repo, "init", "-q", "-b", "main")
    if commit:
        write(os.path.join(repo, "keep.txt"), "keep\n")
        write(os.path.join(repo, "edit.txt"), "one\ntwo\n")
        write(os.path.join(repo, "gone.txt"), "bye\n")
        write(os.path.join(repo, "logo.bin"), b"\x89PNG\x00\x01\x02")
        git(repo, "add", ".")
        git(repo, "commit", "-q", "-m", "init")
    return repo


def test_status_and_diff_on_changes(root):
    repo = make_repo(root)
    write(os.path.join(repo, "staged.txt"), "new staged\n")
    git(repo, "add", "staged.txt")
    write(os.path.join(repo, "edit.txt"), "one\ntwo\nthree\n")
    os.remove(os.path.join(repo, "gone.txt"))
    write(os.path.join(repo, "notes", "untracked.md"), "draft\n")
    write(os.path.join(repo, "logo.bin"), b"\x89PNG\x00\x09\x09\x09")
    reader = GitCliReader([root])

    status = run(reader.status(repo))
    assert status.state == "ok"
    assert status.branch == "main" and not status.detached and not status.initial and status.oid
    assert status.upstream is None and status.ahead is None
    by_path = {e.path: e for e in status.entries}
    assert by_path["staged.txt"].index == "added" and by_path["staged.txt"].worktree is None
    assert by_path["edit.txt"].index is None and by_path["edit.txt"].worktree == "modified"
    assert by_path["gone.txt"].worktree == "deleted"
    assert by_path["notes/untracked.md"].kind == "untracked"
    assert by_path["logo.bin"].worktree == "modified"

    worktree = run(reader.diff(repo, "worktree"))
    assert worktree.state == "ok" and not worktree.truncated
    files = {f.path: f for f in worktree.files}
    assert files["edit.txt"].additions == 1 and files["edit.txt"].deletions == 0
    assert files["gone.txt"].deletions == 1
    assert files["logo.bin"].binary and files["logo.bin"].additions is None
    assert "staged.txt" not in files and "notes/untracked.md" not in files
    assert "+three" in worktree.diff and "Binary files" in worktree.diff

    staged = run(reader.diff(repo, "staged"))
    assert [f.path for f in staged.files] == ["staged.txt"]
    assert "+new staged" in staged.diff

    single = run(reader.diff(repo, "worktree", "edit.txt"))
    assert [f.path for f in single.files] == ["edit.txt"] and not single.untracked

    deleted = run(reader.diff(repo, "worktree", "gone.txt"))
    assert deleted.files[0].deletions == 1 and "-bye" in deleted.diff


def test_untracked_single_file_diff_is_all_added(root):
    repo = make_repo(root)
    write(os.path.join(repo, "notes", "untracked.md"), "line1\nline2\n")
    write(os.path.join(repo, "blob.dat"), b"\x00\x01binary")
    reader = GitCliReader([root])

    diff = run(reader.diff(repo, "worktree", "notes/untracked.md"))
    assert diff.state == "ok" and diff.untracked
    assert diff.files[0].path == "notes/untracked.md" and diff.files[0].additions == 2
    assert diff.files[0].orig_path is None
    assert "new file mode" in diff.diff and "+line1" in diff.diff and "+line2" in diff.diff

    binary = run(reader.diff(repo, "worktree", "blob.dat"))
    assert binary.untracked and binary.files[0].binary and "Binary files" in binary.diff


def test_rename_and_conflict_parsing(root):
    repo = make_repo(root)
    git(repo, "mv", "keep.txt", "kept.txt")
    status = run(GitCliReader([root]).status(repo))
    renamed = next(e for e in status.entries if e.kind == "renamed")
    assert renamed.path == "kept.txt" and renamed.orig_path == "keep.txt" and renamed.index == "renamed"

    data = (b"# branch.oid abc\x00# branch.head (detached)\x00"
            b"u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict file.txt\x00")
    parsed = parse_status_v2(data, 10)
    assert parsed.detached and parsed.branch is None
    assert parsed.entries[0].kind == "unmerged" and parsed.entries[0].conflict == "both_modified"
    assert parsed.entries[0].path == "conflict file.txt"


def test_upstream_ahead_behind(root):
    origin = make_repo(root, "origin")
    clone = os.path.join(root, "clone")
    subprocess.run(["git", "clone", "-q", origin, clone], env=GIT_ENV, check=True)
    write(os.path.join(clone, "keep.txt"), "changed\n")
    git(clone, "commit", "-q", "-am", "local")
    status = run(GitCliReader([root]).status(clone))
    assert status.upstream == "origin/main" and status.ahead == 1 and status.behind == 0


def test_repo_without_commits(root):
    repo = make_repo(root, commit=False)
    write(os.path.join(repo, "first.txt"), "hello\n")
    git(repo, "add", "first.txt")
    write(os.path.join(repo, "later.txt"), "later\n")
    reader = GitCliReader([root])

    status = run(reader.status(repo))
    assert status.state == "ok" and status.initial and status.oid is None and status.branch == "main"
    kinds = {e.path: (e.kind, e.index) for e in status.entries}
    assert kinds == {"first.txt": ("ordinary", "added"), "later.txt": ("untracked", None)}

    staged = run(reader.diff(repo, "staged"))
    assert staged.state == "ok" and [f.path for f in staged.files] == ["first.txt"]
    assert "+hello" in staged.diff
    single = run(reader.diff(repo, "staged", "first.txt"))
    assert single.files[0].additions == 1


def test_not_a_repository(root):
    plain = os.path.join(root, "plain")
    os.makedirs(plain)
    reader = GitCliReader([root])
    assert run(reader.status(plain)).state == "not_a_repository"
    assert run(reader.diff(plain, "worktree")).state == "not_a_repository"


def test_subdirectory_of_repo_is_not_a_repository(root):
    repo = make_repo(root)
    os.makedirs(os.path.join(repo, "sub"))
    assert run(GitCliReader([root]).status(os.path.join(repo, "sub"))).state == "not_a_repository"


def test_path_validation_before_git(root, tmp_path):
    repo = make_repo(root)
    outside = os.path.join(os.path.realpath(tmp_path), "outside")
    os.makedirs(outside)
    os.symlink(outside, os.path.join(repo, "leakdir"))
    reader = GitCliReader([root])
    for bad, reason in (("../x", PathCheckReason.ESCAPES_PROJECT),
                        ("/etc/passwd", PathCheckReason.INVALID_PATH),
                        ("leakdir/file", PathCheckReason.ESCAPES_PROJECT)):
        with pytest.raises(ProjectPathError) as exc:
            run(reader.diff(repo, "worktree", bad))
        assert exc.value.reason == reason
    with pytest.raises(ProjectPathError):
        run(reader.status(outside))
    with pytest.raises(ValueError):
        run(reader.diff(repo, "HEAD"))


def test_pathspec_magic_is_literal(root):
    repo = make_repo(root)
    write(os.path.join(repo, "edit.txt"), "changed\n")
    # ":(glob)*" 若被当作 pathspec 魔法会匹配所有文件
    diff = run(GitCliReader([root]).diff(repo, "worktree", ":(glob)*"))
    assert diff.state == "ok" and diff.files == [] and diff.diff == ""


def test_status_entry_limit(root):
    repo = make_repo(root)
    for i in range(5):
        write(os.path.join(repo, f"u{i}.txt"), "x\n")
    status = run(GitCliReader([root], status_limit=3).status(repo))
    assert status.truncated and len(status.entries) == 3


def test_status_byte_limit_keeps_complete_records(root):
    repo = make_repo(root)
    for i in range(50):
        write(os.path.join(repo, f"untracked-file-{i:03d}.txt"), "x\n")
    status = run(GitCliReader([root], status_max_bytes=600).status(repo))
    assert status.state == "ok" and status.truncated
    assert 0 < len(status.entries) < 50
    assert all(e.path.startswith("untracked-file-") and e.path.endswith(".txt") for e in status.entries)


def test_diff_size_limit(root):
    repo = make_repo(root)
    write(os.path.join(repo, "edit.txt"), "".join(f"line {i}\n" for i in range(5000)))
    diff = run(GitCliReader([root], diff_max_bytes=2048).diff(repo, "worktree"))
    assert diff.state == "ok" and diff.truncated
    assert 0 < len(diff.diff.encode()) <= 2048 and diff.diff.endswith("\n")


def test_timeout_kills_process(root, tmp_path):
    repo = make_repo(root)
    pid_file = os.path.join(os.path.realpath(tmp_path), "git.pid")
    fake = os.path.join(os.path.realpath(tmp_path), "slow-git")
    write(fake, f"#!/bin/sh\necho $$ > {pid_file}\nexec sleep 30\n")
    os.chmod(fake, os.stat(fake).st_mode | stat.S_IEXEC)

    # macOS 第一次执行新建的脚本前会做安全扫描，超时留足让脚本真正启动
    started = time.monotonic()
    status = run(GitCliReader([root], git_binary=fake, timeout=2).status(repo))
    assert status.state == "timeout" and status.error and time.monotonic() - started < 6
    with open(pid_file) as f:
        pid = int(f.read())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_repo_config_cannot_run_commands(root, tmp_path):
    """Agent 在沙箱里可写 .git/config；API 读取时不能执行其中的 fsmonitor、filter 或 diff 驱动命令。"""
    repo = make_repo(root)
    marker = os.path.join(os.path.realpath(tmp_path), "pwned")
    write(os.path.join(repo, ".gitattributes"), "*.txt filter=evil diff=evil\n")
    git(repo, "config", "core.fsmonitor", f"touch {marker}.fsmonitor; false")
    git(repo, "config", "filter.evil.clean", f"touch {marker}.clean; cat")
    git(repo, "config", "filter.evil.required", "true")
    git(repo, "config", "diff.evil.textconv", f"touch {marker}.textconv; cat")
    git(repo, "config", "diff.evil.command", f"touch {marker}.command")
    git(repo, "config", "diff.external", f"touch {marker}.external")
    git(repo, "config", "core.pager", f"touch {marker}.pager; cat")
    git(repo, "config", "core.worktree", "/")
    write(os.path.join(repo, "edit.txt"), "changed\n")
    time.sleep(1.1)  # 让索引的时间戳不再“可能干净”，迫使 git 重新计算工作区内容
    os.utime(os.path.join(repo, "keep.txt"))

    reader = GitCliReader([root])
    status = run(reader.status(repo))
    diff = run(reader.diff(repo, "worktree"))
    single = run(reader.diff(repo, "worktree", "edit.txt"))
    assert status.state == "ok" and diff.state == "ok" and single.state == "ok"
    assert {e.path for e in status.entries} >= {"edit.txt", ".gitattributes"}
    assert all(not e.path.startswith(("etc/", "usr/")) for e in status.entries)
    assert "+changed" in diff.diff
    leftovers = [name for name in os.listdir(os.path.dirname(marker)) if name.startswith("pwned")]
    assert leftovers == []


def test_real_conflict_and_both_diff_scopes(root):
    repo = make_repo(root)
    git(repo, "checkout", "-q", "-b", "other")
    write(os.path.join(repo, "edit.txt"), "other branch\n")
    git(repo, "commit", "-q", "-am", "other")
    git(repo, "checkout", "-q", "main")
    write(os.path.join(repo, "edit.txt"), "main branch\n")
    git(repo, "commit", "-q", "-am", "main")
    merged = subprocess.run(["git", "-C", repo, "merge", "other"], env=GIT_ENV,
                            capture_output=True, text=True)
    assert merged.returncode == 1
    reader = GitCliReader([root])
    status = run(reader.status(repo))
    conflict = next(e for e in status.entries if e.path == "edit.txt")
    assert conflict.kind == "unmerged" and conflict.conflict == "both_modified"
    for scope in ("staged", "worktree"):
        diff = run(reader.diff(repo, scope, "edit.txt"))
        assert diff.state == "ok" and diff.diff

    git(repo, "merge", "--abort")
    write(os.path.join(repo, "edit.txt"), "staged text\n")
    git(repo, "add", "edit.txt")
    write(os.path.join(repo, "edit.txt"), "working text\n")
    status = run(reader.status(repo))
    entry = next(e for e in status.entries if e.path == "edit.txt")
    assert entry.index == "modified" and entry.worktree == "modified"
    assert "+staged text" in run(reader.diff(repo, "staged", "edit.txt")).diff
    assert "+working text" in run(reader.diff(repo, "worktree", "edit.txt")).diff
