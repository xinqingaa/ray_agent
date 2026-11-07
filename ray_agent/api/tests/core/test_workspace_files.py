"""限根文件 IO 的真实文件系统行为：越界、链接、特殊文件、保留目录、版本冲突与不覆盖。"""
import asyncio
import contextlib
import os
import resource
import sys
import time

import pytest

from app.domain.external.workspace_files import (
    FileKind, FileLimits, FileVersion, RootBinding, WorkspaceFileError,
)
from app.domain.models.error import ErrorCode
from app.domain.models.identity import RootedPath, RootKind
from app.infrastructure.external.workspace_files.folders import PosixFolderAccess
from app.infrastructure.external.workspace_files.posix import (
    PosixWorkspaceFiles, scan_binding, snapshot_binding, sweep_temp_files,
)


def at(path: str = "") -> RootedPath:
    return RootedPath(root_id="r", relative_path=path)


def make_files(root, limits=None, *, identity=True):
    info = os.stat(root)
    binding = RootBinding(root_id="r", kind=RootKind.WORKSPACE_FOLDER, path=str(root),
                          dev=info.st_dev if identity else None, ino=info.st_ino if identity else None)

    async def resolve(root_id):
        return binding

    return PosixWorkspaceFiles(resolve, limits)


def run(coro):
    return asyncio.run(coro)


def code_of(coro) -> WorkspaceFileError:
    with pytest.raises(WorkspaceFileError) as caught:
        run(coro)
    return caught.value


def case_insensitive(directory) -> bool:
    probe = directory / "CaseProbe"
    probe.write_text("x")
    try:
        return (directory / "caseprobe").exists()
    finally:
        probe.unlink()


@pytest.fixture
def root(tmp_path):
    folder = tmp_path / "ws"
    folder.mkdir()
    return folder


def test_write_read_round_trip_and_directory_listing(root):
    files = make_files(root)
    run(files.mkdir(at("src")))
    version = run(files.write_bytes(at("src/a.txt"), b"hello", None))
    assert version.size == 5
    assert run(files.read_bytes(at("src/a.txt"))) == b"hello"
    assert run(files.read_bytes(at("src/a.txt"), offset=1, length=3)) == b"ell"
    listing = run(files.list_dir(at("src")))
    assert [(entry.name, entry.kind) for entry in listing.entries] == [("a.txt", FileKind.FILE)]
    assert not [name for name in os.listdir(root / "src") if name.startswith(".rayagent-write-")]


def test_missing_parent_directory_is_not_created_by_write(root):
    files = make_files(root)
    assert code_of(files.write_bytes(at("nope/a.txt"), b"x", None)).code is ErrorCode.NOT_FOUND


def test_symlinks_are_reported_never_followed(root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    (root / "link").symlink_to(outside)
    (root / "file-link").symlink_to(outside / "secret.txt")
    files = make_files(root)

    entries = {entry.name: entry for entry in run(files.list_dir(at())).entries}
    assert entries["link"].kind is FileKind.SYMLINK and entries["link"].link_target == str(outside)
    assert entries["file-link"].kind is FileKind.SYMLINK

    # 链接出现在路径中段或末段，读、写、列举都拒绝
    assert code_of(files.read_bytes(at("link/secret.txt"))).code is ErrorCode.FORBIDDEN
    assert code_of(files.read_bytes(at("file-link"))).code is ErrorCode.FORBIDDEN
    assert code_of(files.list_dir(at("link"))).code is ErrorCode.FORBIDDEN
    assert code_of(files.write_bytes(at("link/new.txt"), b"x", None)).code is ErrorCode.FORBIDDEN
    assert code_of(files.write_bytes(at("file-link"), b"x", FileVersion(size=6, modified_ns=0))).code \
        in (ErrorCode.FORBIDDEN, ErrorCode.CONFLICT)
    assert (outside / "secret.txt").read_text() == "secret"
    assert not (outside / "new.txt").exists()


def test_symlink_swapped_in_after_listing_is_still_refused(root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    files = make_files(root)
    run(files.mkdir(at("sub")))
    (root / "sub").rmdir()
    (root / "sub").symlink_to(outside)
    assert code_of(files.write_bytes(at("sub/x.txt"), b"x", None)).code is ErrorCode.FORBIDDEN
    assert not list(outside.iterdir())


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="needs mkfifo")
def test_fifo_is_other_and_refused_without_blocking(root):
    os.mkfifo(root / "pipe")
    files = make_files(root)
    entries = {entry.name: entry for entry in run(files.list_dir(at())).entries}
    assert entries["pipe"].kind is FileKind.OTHER
    assert code_of(files.read_bytes(at("pipe"))).code is ErrorCode.FORBIDDEN
    assert code_of(files.write_bytes(at("pipe"), b"x", FileVersion(size=0, modified_ns=0))).code is ErrorCode.FORBIDDEN


def test_reserved_directory_is_rejected_and_hidden(root):
    files = make_files(root)
    (root / ".rayagent").mkdir()
    (root / ".rayagent" / "workspace.json").write_text("{}")
    assert ".rayagent" not in [entry.name for entry in run(files.list_dir(at())).entries]
    for path in (".rayagent", ".rayagent/workspace.json", ".RayAgent/x", "a/.rayagent/x"):
        assert code_of(files.read_bytes(at(path))).code is ErrorCode.FORBIDDEN
        assert code_of(files.write_bytes(at(path), b"x", None)).code is ErrorCode.FORBIDDEN


def test_listing_applies_exclusion_rules(root):
    for name in (".git", "node_modules", "src"):
        (root / name).mkdir()
    for name in (".env", "key.pem", "data.sqlite", "readme.md"):
        (root / name).write_text("x")
    names = [entry.name for entry in run(make_files(root).list_dir(at())).entries]
    assert names == ["readme.md", "src"]


def test_write_with_none_never_overwrites_and_reports_current_version(root):
    files = make_files(root)
    first = run(files.write_bytes(at("a.txt"), b"one", None))
    error = code_of(files.write_bytes(at("a.txt"), b"two", None))
    assert error.code is ErrorCode.CONFLICT and error.current == first
    assert (root / "a.txt").read_text() == "one"


def test_overwrite_requires_matching_version_and_preserves_mode(root):
    files = make_files(root)
    version = run(files.write_bytes(at("a.sh"), b"one", None))
    os.chmod(root / "a.sh", 0o750)
    version = run(files.stat(at("a.sh"))).version
    new_version = run(files.write_bytes(at("a.sh"), b"two", version))
    assert (root / "a.sh").read_text() == "two" and new_version.size == 3
    assert (os.stat(root / "a.sh").st_mode & 0o777) == 0o750
    stale = code_of(files.write_bytes(at("a.sh"), b"three", version))
    assert stale.code is ErrorCode.CONFLICT and stale.current == new_version
    assert (root / "a.sh").read_text() == "two"
    deleted = code_of(files.write_bytes(at("missing.txt"), b"x", version))
    assert deleted.code is ErrorCode.CONFLICT and deleted.current is None


def test_hash_in_expected_version_is_checked(root):
    files = make_files(root)
    run(files.write_bytes(at("a.txt"), b"abc", None))
    version = run(files.stat(at("a.txt"), with_hash=True)).version
    assert version.content_hash
    wrong = version.model_copy(update={"content_hash": "0" * 64})
    assert code_of(files.write_bytes(at("a.txt"), b"x", wrong)).code is ErrorCode.CONFLICT
    run(files.write_bytes(at("a.txt"), b"x", version))


def test_change_inside_the_publish_window_is_a_conflict(root):
    files = make_files(root)
    version = run(files.write_bytes(at("a.txt"), b"one", None))
    files.before_publish = lambda: (root / "a.txt").write_text("changed by someone else")
    error = code_of(files.write_bytes(at("a.txt"), b"mine", version))
    assert error.code is ErrorCode.CONFLICT
    assert (root / "a.txt").read_text() == "changed by someone else"
    assert not [name for name in os.listdir(root) if name.startswith(".rayagent-write-")]

    files.before_publish = lambda: (root / "new.txt").write_text("raced")
    error = code_of(files.write_bytes(at("new.txt"), b"mine", None))
    assert error.code is ErrorCode.CONFLICT
    assert (root / "new.txt").read_text() == "raced"
    assert not [name for name in os.listdir(root) if name.startswith(".rayagent-write-")]


def test_case_only_difference_is_a_conflict(root):
    if not case_insensitive(root):
        pytest.skip("文件系统区分大小写，不存在大小写冲突")
    files = make_files(root)
    version = run(files.write_bytes(at("Readme.md"), b"one", None))
    assert code_of(files.write_bytes(at("readme.md"), b"two", None)).code is ErrorCode.CONFLICT
    assert code_of(files.write_bytes(at("readme.md"), b"two", version)).code is ErrorCode.CONFLICT
    assert os.listdir(root) == ["Readme.md"] and (root / "Readme.md").read_text() == "one"


def test_root_identity_mismatch_and_missing_root_are_unavailable(root, tmp_path):
    files = make_files(root)
    run(files.write_bytes(at("a.txt"), b"x", None))
    root.rename(tmp_path / "moved")
    assert code_of(files.read_bytes(at("a.txt"))).code is ErrorCode.UNAVAILABLE
    assert not root.exists()  # 不会在旧位置自动创建空目录
    root.mkdir()  # 同路径换成另一个目录：身份不符
    assert code_of(files.list_dir(at())).code is ErrorCode.UNAVAILABLE
    assert os.listdir(root) == []


def test_session_workdir_style_root_without_identity(root):
    files = make_files(root, identity=False)
    run(files.write_bytes(at("a.txt"), b"x", None))
    assert run(files.read_bytes(at("a.txt"))) == b"x"


def test_read_cap_and_streaming(root):
    files = make_files(root, FileLimits(read_bytes=4))
    run(files.write_bytes(at("a.txt"), b"abcdefgh", None))
    assert run(files.read_bytes(at("a.txt"))) == b"abcd"
    assert code_of(files.read_bytes(at("a.txt"), length=5)).code is ErrorCode.PAYLOAD_TOO_LARGE

    async def stream():
        reader = await files.open_reader(at("a.txt"))
        try:
            return reader.read()
        finally:
            reader.close()
    assert run(stream()) == b"abcdefgh"


def test_write_size_cap_leaves_no_temp_file(root):
    files = make_files(root, FileLimits(write_bytes=3))
    assert code_of(files.write_bytes(at("a.txt"), b"abcdef", None)).code is ErrorCode.PAYLOAD_TOO_LARGE
    assert os.listdir(root) == []


def test_move_never_overwrites_and_delete_checks_version(root):
    files = make_files(root)
    version = run(files.write_bytes(at("a.txt"), b"a", None))
    run(files.write_bytes(at("b.txt"), b"b", None))
    assert code_of(files.move(at("a.txt"), at("b.txt"))).code is ErrorCode.CONFLICT
    moved = run(files.move(at("a.txt"), at("c.txt"), version))
    assert moved.name == "c.txt" and not (root / "a.txt").exists()
    stale = FileVersion(size=99, modified_ns=0)
    assert code_of(files.delete(at("c.txt"), stale)).code is ErrorCode.CONFLICT
    run(files.delete(at("c.txt"), run(files.stat(at("c.txt"))).version))
    assert sorted(os.listdir(root)) == ["b.txt"]


def test_scan_counts_files_and_honors_exclusions_and_cap(root):
    (root / "node_modules").mkdir()
    (root / "node_modules" / "dep.js").write_text("x")
    (root / "src").mkdir()
    (root / "src" / "a.py").write_text("12345")
    (root / "b.txt").write_text("123")
    summary = run(make_files(root).scan(at()))
    assert (summary.files, summary.directories, summary.bytes, summary.truncated) == (2, 1, 8, False)
    capped = run(make_files(root, FileLimits(scan_entries=1)).scan(at()))
    assert capped.truncated


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX only")
def test_long_name_is_an_invalid_request_not_a_crash(root):
    files = make_files(root)
    assert code_of(files.write_bytes(at("x" * 300), b"x", None)).code is ErrorCode.INVALID_REQUEST


def _binding(root) -> RootBinding:
    info = os.stat(root)
    return RootBinding(root_id="r", kind=RootKind.WORKSPACE_FOLDER, path=str(root), dev=info.st_dev, ino=info.st_ino)


@contextlib.contextmanager
def fd_budget(spare: int):
    """把文件描述符软上限压到「当前已开 + spare」，复现 macOS 默认的紧张上限；退出时还原。"""
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (len(os.listdir("/dev/fd")) + spare, hard))
    try:
        yield
    finally:
        resource.setrlimit(resource.RLIMIT_NOFILE, (soft, hard))


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX only")
def test_scan_and_snapshot_cover_every_directory_under_a_tight_fd_limit(root):
    for index in range(400):
        (root / f"d{index:03d}").mkdir()
        (root / f"d{index:03d}" / "f.txt").write_text("x")
    binding = _binding(root)
    with fd_budget(30):
        summary = scan_binding(binding, (), FileLimits())
        snapshot = snapshot_binding(binding, (), FileLimits())
    assert (summary.files, summary.directories, summary.truncated) == (400, 400, False)
    assert len(snapshot.files) == 400 and not snapshot.truncated


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX only")
def test_folder_identity_check_reports_lost_only_when_really_gone_and_raises_on_other_errors(root):
    access = PosixFolderAccess()
    binding = _binding(root)
    assert run(access.matches(str(root), binding.dev, binding.ino)) is True
    assert run(access.matches(str(root), binding.dev, binding.ino + 1)) is False
    loop = asyncio.new_event_loop()  # 事件循环自己要用描述符，先建好再压上限
    loop.run_until_complete(access.matches(str(root), binding.dev, binding.ino))
    with fd_budget(5):
        spare = []
        try:
            while True:
                spare.append(os.open(root, os.O_RDONLY))
        except OSError:
            pass
        try:
            with pytest.raises(WorkspaceFileError):  # 描述符耗尽不是「文件夹丢了」
                loop.run_until_complete(access.matches(str(root), binding.dev, binding.ino))
        finally:
            for fd in spare:
                os.close(fd)
    loop.close()
    gone = root.parent / "gone"
    gone.mkdir()
    info = os.stat(gone)
    gone.rmdir()
    assert run(access.matches(str(gone), info.st_dev, info.st_ino)) is False


def test_crash_residual_temp_files_are_hidden_everywhere_and_swept_only_when_old_and_own(tmp_path):
    root = tmp_path / "w"
    root.mkdir()
    (root / "a.txt").write_text("x")
    old, fresh, foreign = (root / ".rayagent-write-old.tmp"), (root / ".rayagent-write-new.tmp"), root / "mine.tmp"
    for path in (old, fresh, foreign):
        path.write_text("残留")
    long_ago = time.time() - 7200
    os.utime(old, (long_ago, long_ago))
    os.utime(foreign, (long_ago, long_ago))
    files, binding = make_files(root), _binding(root)
    assert [entry.name for entry in run(files.list_dir(at())).entries] == ["a.txt", "mine.tmp"]
    assert run(files.scan(at())).files == 2 and set(snapshot_binding(binding, (), FileLimits()).files) == {"a.txt", "mine.tmp"}
    assert sweep_temp_files(binding, FileLimits(), 3600, time.time()) == 1
    assert sorted(os.listdir(root)) == [fresh.name, "a.txt", "mine.tmp"]  # 新的可能属于进行中的写入，外来命名不动
