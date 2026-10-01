"""托管目录共用 IO：目录描述符、无链接跟随遍历、原子发布和统一属主。"""
import hashlib
import os
import stat
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import BinaryIO, Iterator
from app.domain.services.project_paths import normalize_relative, path_error, project_directory

CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class FileEntry:
    path: str
    type: str
    size: int
    mode: int
    mtime_ns: int
    target: str | None = None


class ProjectFileIO:
    def __init__(self, root, *, uid=1000, gid=1000):
        self.root = str(root)
        self.uid, self.gid = uid, gid

    def _ownership(self, fd, *, directory=False):
        os.fchmod(fd, 0o775 if directory else 0o664)
        if os.geteuid() == 0:
            os.fchown(fd, self.uid, self.gid)

    @contextmanager
    def directory(self, relative='', *, create=False):
        path = normalize_relative(relative)
        if path is None:
            raise path_error(relative)
        with project_directory(self.root) as root_fd:
            fd = os.dup(root_fd)
            try:
                for part in path.split('/') if path else []:
                    if create:
                        try:
                            os.mkdir(part, mode=0o775, dir_fd=fd)
                            os.fsync(fd)
                        except FileExistsError:
                            pass
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = child
                    if create:
                        self._ownership(fd, directory=True)
                yield fd
            finally:
                os.close(fd)

    @staticmethod
    def _entry(parent_fd, name, relative):
        meta = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        kind = ('symlink' if stat.S_ISLNK(meta.st_mode) else 'directory' if stat.S_ISDIR(meta.st_mode)
            else 'file' if stat.S_ISREG(meta.st_mode) else 'other')
        return FileEntry(relative, kind, meta.st_size,
            stat.S_IMODE(meta.st_mode), meta.st_mtime_ns,
            os.readlink(name, dir_fd=parent_fd) if kind == 'symlink' else None)

    def inspect(self, relative):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        with self.directory(parent) as fd:
            return self._entry(fd, name, path)

    def children(self, relative='') -> list[FileEntry]:
        path = normalize_relative(relative)
        if path is None:
            raise path_error(relative)
        with self.directory(path) as fd:
            with os.scandir(fd) as entries:
                return [self._entry(fd, entry.name, f'{path}/{entry.name}' if path else entry.name)
                    for entry in entries]

    def walk(self) -> Iterator[FileEntry]:
        """仅进入真实目录；链接保留目标文字，特殊项交由各调用方明确处理。"""
        def visit(fd, prefix):
            with os.scandir(fd) as scan:
                names = sorted(entry.name for entry in scan)
            for name in names:
                path = f'{prefix}/{name}' if prefix else name
                entry = self._entry(fd, name, path)
                yield entry
                if entry.type == 'directory':
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    try:
                        yield from visit(child, path)
                    finally:
                        os.close(child)
        with self.directory() as fd:
            yield from visit(fd, '')

    @contextmanager
    def open_regular(self, relative):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        with self.directory(parent) as parent_fd:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent_fd)
            try:
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    raise ValueError(f'不是普通文件：{path}')
                with os.fdopen(os.dup(fd), 'rb') as handle:
                    yield handle
            finally:
                os.close(fd)

    def size(self):
        return sum(entry.size for entry in self.walk() if entry.type == 'file')

    def hash_file(self, relative):
        digest, size = hashlib.sha256(), 0
        with self.open_regular(relative) as handle:
            while chunk := handle.read(CHUNK_BYTES):
                digest.update(chunk)
                size += len(chunk)
        return digest.hexdigest(), size

    def publish(self, relative: str, source: BinaryIO, *, overwrite=False,
                expected_size=None, expected_hash=None, max_bytes=None):
        """先写临时文件/哈希/fsync，复核后原子发布。取消或异常不留下半文件。"""
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        with self.directory(parent, create=True) as parent_fd:
            temporary = '.rayagent-tmp-' + uuid.uuid4().hex
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600, dir_fd=parent_fd)
            try:
                digest, size = hashlib.sha256(), 0
                with os.fdopen(os.dup(fd), 'wb') as handle:
                    while chunk := source.read(CHUNK_BYTES):
                        size += len(chunk)
                        if max_bytes is not None and size > max_bytes:
                            raise ValueError(f'文件超过大小限制：{path}')
                        digest.update(chunk)
                        handle.write(chunk)
                    handle.flush()
                    self._ownership(fd)
                    os.fsync(fd)
                if expected_size is not None and size != expected_size:
                    raise ValueError(f'文件大小与确认项不一致：{path}')
                if expected_hash is not None and digest.hexdigest() != expected_hash:
                    raise ValueError(f'文件内容哈希与确认项不一致：{path}')
                if overwrite:
                    os.replace(temporary, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
                else:
                    # 临时文件到最终文件的排他原子发布；并非快照硬链接去重。
                    os.link(temporary, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd, follow_symlinks=False)
                    os.unlink(temporary, dir_fd=parent_fd)
                os.fsync(parent_fd)
                return {'path': path, 'size': size, 'sha256': digest.hexdigest()}
            finally:
                os.close(fd)
                try:
                    os.unlink(temporary, dir_fd=parent_fd)
                except FileNotFoundError:
                    pass

    def remove(self, relative):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        with self.directory(parent) as fd:
            meta = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(meta.st_mode):
                os.rmdir(name, dir_fd=fd)
            else:
                os.unlink(name, dir_fd=fd)
            os.fsync(fd)

    def link(self, relative, target):
        path = normalize_relative(relative)
        if not path:
            raise path_error(relative)
        parent, _, name = path.rpartition('/')
        with self.directory(parent, create=True) as fd:
            os.symlink(target, name, dir_fd=fd)
            if os.geteuid() == 0:
                os.chown(name, self.uid, self.gid, dir_fd=fd, follow_symlinks=False)
            os.fsync(fd)

    def restore_metadata(self, entry):
        path = entry['path']
        parent, _, name = path.rpartition('/')
        with self.directory(parent) as fd:
            if entry['type'] == 'symlink':
                if os.geteuid() == 0:
                    os.chown(name, self.uid, self.gid, dir_fd=fd, follow_symlinks=False)
            else:
                flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                if entry['type'] == 'directory':
                    flags |= os.O_DIRECTORY
                child = os.open(name, flags, dir_fd=fd)
                try:
                    self._ownership(child, directory=entry['type'] == 'directory')
                finally:
                    os.close(child)
            os.utime(name, ns=(entry['mtime_ns'], entry['mtime_ns']), dir_fd=fd, follow_symlinks=False)
