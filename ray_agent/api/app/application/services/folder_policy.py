"""哪些文件夹可以成为工作区或默认位置：系统目录、用户主目录、应用数据目录，以及与已有工作区嵌套的文件夹都不行。"""
import os
from typing import Iterable

from app.application.errors.exceptions import BadRequestError
from app.domain.models.workspace import RootRecord


def inside(path: str, root: str) -> bool:
    """path 等于 root 或在 root 之内（按路径段比较）。"""
    root = root.rstrip(os.sep) or os.sep
    return path == root or path.startswith(root + os.sep if root != os.sep else root)


def _ancestry(path: str) -> set[tuple[int, int]]:
    """路径本身与各级上级目录的文件系统身份（无法读取的级别跳过）。"""
    found = set()
    current = path
    while True:
        try:
            info = os.stat(current)
            found.add((info.st_dev, info.st_ino))
        except OSError:
            pass
        parent = os.path.dirname(current)
        if parent == current:
            return found
        current = parent


class FolderPolicy:
    def __init__(self, *, blocked: Iterable[str], data_root: str, home: str) -> None:
        self._blocked = [os.path.realpath(path) for path in blocked]
        self._data_root = os.path.realpath(data_root)
        self._home = os.path.realpath(home)

    def _reject(self, reason: str, message: str) -> BadRequestError:
        return BadRequestError(message, details={"reason": reason})

    def check_common(self, path: str) -> None:
        if path == os.sep:
            raise self._reject("filesystem_root", "不能把文件系统根目录作为工作区文件夹")
        if path == self._home or inside(self._home, path):
            raise self._reject("home", "不能把用户主目录或它的上级目录作为工作区文件夹，请选择其中的子文件夹")
        for blocked in self._blocked:
            if inside(path, blocked):
                raise self._reject("system", f"{blocked} 是系统目录，不能作为工作区文件夹")
        if inside(path, self._data_root) or inside(self._data_root, path):
            raise self._reject("data_root", "不能选择应用数据目录，或包含它的文件夹")

    def check_workspace(self, path: str, others: list[RootRecord], *, ignore_workspace_id: str | None = None) -> None:
        """新建、打开与改绑：通用限制之外，不与其他工作区文件夹嵌套（同一文件夹由调用方先按身份识别）。

嵌套按登记路径判断，并补充文件系统身份：候选文件夹的某级上级就是另一个工作区登记的文件夹时同样视为嵌套，
覆盖「那个工作区已失联、被用户移到别处」的情形。反方向（候选文件夹包含一个已被移走的失联工作区）无法在不扫描
目录树的前提下发现，由这个工作区之后重新打开或改绑时的同一检查拦住，所以互相包含不会被提交。"""
        self.check_common(path)
        ancestry = None
        for other in others:
            if other.ref.workspace_id == ignore_workspace_id:
                continue
            location = os.path.realpath(other.location) if os.path.exists(other.location) else other.location
            overlaps = inside(path, location) or inside(location, path)
            if not overlaps and other.dev is not None:
                # 失联的工作区被用户移到了别处：登记路径已不可信，按文件系统身份看候选文件夹是否在它里面
                ancestry = ancestry if ancestry is not None else _ancestry(path)
                overlaps = (other.dev, other.ino) in ancestry
            if overlaps:
                raise BadRequestError("该文件夹与已有工作区的文件夹重叠，同一位置只能属于一个工作区",
                                      details={"reason": "nested", "workspace_id": other.ref.workspace_id})

    def check_location(self, path: str, others: list[RootRecord]) -> None:
        """默认工作区位置：不能在已有工作区之内；可以是它们的上级（默认位置本来就是它们的父目录）。"""
        if path == os.sep:
            raise self._reject("filesystem_root", "不能把文件系统根目录作为默认位置")
        for blocked in self._blocked:
            if inside(path, blocked):
                raise self._reject("system", f"{blocked} 是系统目录，不能作为默认位置")
        if inside(path, self._data_root) or inside(self._data_root, path):
            raise self._reject("data_root", "不能选择应用数据目录，或包含它的文件夹")
        for other in others:
            if inside(path, other.location):
                raise BadRequestError("默认位置不能在已有工作区的文件夹之内",
                                      details={"reason": "nested", "workspace_id": other.ref.workspace_id})
