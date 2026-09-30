"""托管项目内路径：只接受相对路径，所有父目录通过描述符无跟随打开。"""
import os
import unicodedata
from contextlib import contextmanager
from typing import Optional

from app.domain.models.project import PathCheck, PathCheckReason, ProjectPathError, PATH_CHECK_MESSAGES


def normalize_relative(relative: Optional[str]) -> Optional[str]:
    if relative is None or relative == '':
        return ''
    if not isinstance(relative, str) or '\x00' in relative or '\\' in relative or relative.startswith('/'):
        return None
    parts = unicodedata.normalize('NFC', relative).split('/')
    if any(p in ('', '.', '..') for p in parts):
        return None
    return '/'.join(parts)


def path_error(path, reason=PathCheckReason.INVALID_PATH):
    return ProjectPathError(PathCheck(ok=False, path=path, reason=reason, message=PATH_CHECK_MESSAGES[reason]))


@contextmanager
def project_directory(project_path: str, relative: str = ''):
    normalized = normalize_relative(relative)
    if normalized is None:
        raise path_error(relative)
    fd = os.open(project_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in normalized.split('/') if normalized else []:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        yield fd
    finally:
        os.close(fd)
