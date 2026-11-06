"""只读资源目录与可写数据根。

资源目录随代码或冻结产物分发（迁移脚本、内置 skill），按代码位置定位；数据根由启动参数指定，业务库、内容对象、
会话工作目录与 skill 存储都在其中。两者都不按当前工作目录解析。
"""
import sys
from dataclasses import dataclass
from pathlib import Path

RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


class DataRootMissing(RuntimeError):
    """没有指定数据根：开发时用启动参数传入，正式包由宿主经私有通道传入。"""


@dataclass(frozen=True)
class DataRoot:
    root: Path

    @property
    def database(self) -> Path:
        return self.root / "rayagent.db"

    @property
    def lock(self) -> Path:
        return self.root / "core.lock"

    @property
    def objects(self) -> Path:
        """不可变内容对象：附件、交付文件与截图的字节。"""
        return self.root / "objects"

    @property
    def sessions(self) -> Path:
        """每个会话一个工作目录。"""
        return self.root / "sessions"

    @property
    def skills(self) -> Path:
        return self.root / "skills"

    @property
    def tmp(self) -> Path:
        return self.root / "tmp"

    def prepare(self) -> None:
        for path in (self.root, self.objects, self.sessions, self.skills, self.tmp):
            path.mkdir(parents=True, exist_ok=True)


def data_root() -> DataRoot:
    from core.config import get_settings
    value = get_settings().data_root
    if not value:
        raise DataRootMissing("没有指定数据根：开发时用 --data-root 启动核心，正式包由宿主传入")
    return DataRoot(Path(value).expanduser().resolve())
