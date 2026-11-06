"""会话工作目录：每个会话在数据根下一个目录，承接附件、超长工具结果、截图与临时文件。

目录名是会话工作目录根的不透明身份，不由客户端提交的会话 id 推导；删除会话时由清理任务回收整个目录。
"""
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.domain.models.identity import RootKind, RootRef

SESSIONS_DIR = "sessions"


@dataclass(frozen=True)
class SessionWorkdir:
    root: RootRef
    path: Path

    @property
    def uploads(self) -> Path:
        return self.path / "uploads"

    @property
    def outputs(self) -> Path:
        return self.path / "outputs"

    @property
    def screenshots(self) -> Path:
        return self.path / "screenshots"

    @property
    def tmp(self) -> Path:
        return self.path / "tmp"

    def ensure(self) -> "SessionWorkdir":
        for path in (self.path, self.uploads, self.outputs, self.screenshots, self.tmp):
            path.mkdir(parents=True, exist_ok=True)
        return self

    def contains(self, path: Path) -> bool:
        resolved = path.resolve()
        return resolved == self.path.resolve() or resolved.is_relative_to(self.path.resolve())


class SessionWorkdirs:
    def __init__(self, data_root: Path) -> None:
        self._data_root = data_root

    @staticmethod
    def new_root(session_id: str) -> tuple[RootRef, str]:
        """为新会话生成根身份与相对数据根的位置，随会话同事务登记。"""
        root_id = uuid.uuid4().hex
        return RootRef(root_id=root_id, kind=RootKind.SESSION_WORKDIR, session_id=session_id), f"{SESSIONS_DIR}/{root_id}"

    def resolve(self, root: RootRef, location: str) -> SessionWorkdir:
        path = (self._data_root / location).resolve()
        if path.parent != (self._data_root / SESSIONS_DIR).resolve():
            raise ValueError(f"会话工作目录位置异常：{location}")
        return SessionWorkdir(root=root, path=path)

    def remove(self, location: str) -> None:
        path = (self._data_root / location).resolve()
        if path.parent != (self._data_root / SESSIONS_DIR).resolve() or path.is_symlink():
            raise ValueError(f"会话工作目录位置异常：{location}")
        if path.exists():
            shutil.rmtree(path)
