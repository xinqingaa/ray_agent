"""在已确认的 RayAgent 或工作区根发布标准 Skill 包。"""
import ctypes
import errno
import hashlib
import os
import shutil
import stat
import sys
import uuid
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path

from app.domain.models.workspace import MARKER_DIRECTORY
from app.domain.services.skill_discovery import NATIVE_RELATIVE, read_package_dir
from app.domain.services.skill_packages import SkillError, safe_path

DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


@dataclass(frozen=True)
class NativeSkillTarget:
    path: Path
    workspace_id: str | None = None
    identity: tuple[int, int] | None = None

    @property
    def id(self):
        return hashlib.sha256(repr((str(self.path), self.workspace_id, self.identity)).encode()).hexdigest()

    def destination(self, name):
        return self.path / NATIVE_RELATIVE / name


@contextmanager
def open_directory(path, *, parent=None, create=False):
    if create:
        try:
            os.mkdir(path, dir_fd=parent)
        except FileExistsError:
            pass
    fd = os.open(path, DIR_FLAGS, dir_fd=parent)
    try:
        yield fd
    finally:
        os.close(fd)


def _rename_exclusive(fd, source, dest):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameatx_np' if sys.platform == 'darwin' else 'renameat2', None)
    if rename is None:
        raise SkillError('此平台不支持无覆盖发布 Skill', 503)
    flag = 4 if sys.platform == 'darwin' else 1  # RENAME_EXCL / RENAME_NOREPLACE
    if rename(fd, os.fsencode(source), fd, os.fsencode(dest), flag):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), dest)


def _write_package(fd, bundle):
    for rel, raw in bundle.items():
        *parts, leaf = safe_path(rel).split('/')
        with ExitStack() as stack:
            parent = fd
            for part in parts:
                parent = stack.enter_context(open_directory(part, parent=parent, create=True))
            file = os.open(leaf, os.O_WRONLY | os.O_NOFOLLOW | os.O_CREAT | os.O_EXCL, 0o644, dir_fd=parent)
            with os.fdopen(file, 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())


def install_native_skill(target: NativeSkillTarget, name, bundle, settings):
    """同名已有内容相同可重试，差异或链接都按冲突处理。"""
    dest = target.destination(name)
    if not target.path.is_absolute() or target.path.resolve() != target.path:
        raise SkillError('安装根不可用或为链接', 409)
    try:
        with ExitStack() as stack:
            root = stack.enter_context(open_directory(target.path, create=target.workspace_id is None))
            info = os.fstat(root)
            identity = (info.st_dev, info.st_ino)
            if target.identity is not None and identity != target.identity:
                raise SkillError('工作区文件夹已变化，请重新选择安装位置', 409)
            native = stack.enter_context(open_directory(MARKER_DIRECTORY, parent=root, create=True))
            skills = stack.enter_context(open_directory('skills', parent=native, create=True))
            stage = '.publish-' + uuid.uuid4().hex
            try:
                with open_directory(stage, parent=skills, create=True) as staging:
                    _write_package(staging, bundle)
                    os.fsync(staging)
                live = target.path.lstat()
                if not stat.S_ISDIR(live.st_mode) or (live.st_dev, live.st_ino) != identity:
                    raise SkillError('安装根已移动，请重新选择安装位置', 409)
                with open_directory(dest.parent) as current:
                    current_info, opened_info = os.fstat(current), os.fstat(skills)
                    if (current_info.st_dev, current_info.st_ino) != (opened_info.st_dev, opened_info.st_ino):
                        raise SkillError('安装目录已变化，请重新选择安装位置', 409)
                try:
                    _rename_exclusive(skills, stage, name)
                except OSError as exc:
                    if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                        raise
                    try:
                        if dest.resolve(strict=True) == dest and read_package_dir(dest, settings) == bundle:
                            return
                    except (OSError, SkillError, RuntimeError):
                        pass
                    raise SkillError('目标已有同名且内容不同的 Skill', 409) from exc
                os.fsync(skills)
            finally:
                try:
                    shutil.rmtree(stage, dir_fd=skills)
                except FileNotFoundError:
                    pass
    except OSError as exc:
        raise SkillError('无法写入选定的 Skill 目录，请检查路径及写入权限', 409) from exc
