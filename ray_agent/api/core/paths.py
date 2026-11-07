"""只读资源目录与可写数据根。

资源目录随代码或冻结产物分发（迁移脚本、内置 skill），按代码位置定位；数据根由启动参数指定，业务库、内容对象、
会话工作目录与 skill 存储都在其中。两者都不按当前工作目录解析。
"""
import os
import sys
import uuid
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
    def install_id_file(self) -> Path:
        """本机安装身份：首次启动生成并保持不变，写入工作区文件夹标记。"""
        return self.root / "install_id"

    @property
    def dev_host_secret_file(self) -> Path:
        """无宿主的开发启动把宿主密钥写在这里，方便开发工具以宿主身份调用。"""
        return self.root / "dev_host_secret"

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

    @property
    def components(self) -> Path:
        return self.root / "components"

    @property
    def browser_profiles(self) -> Path:
        return self.root / "browser-profiles"

    @property
    def runtimes(self) -> Path:
        return self.root / "runtimes"

    @property
    def execution(self) -> Path:
        return self.root / "execution"

    def prepare(self) -> None:
        for path in (self.root, self.objects, self.sessions, self.skills, self.tmp,
                     self.components, self.browser_profiles, self.runtimes, self.execution):
            path.mkdir(parents=True, exist_ok=True)

    def install_id(self) -> str:
        """读取本机安装身份；不存在时原子创建。"""
        try:
            value = self.install_id_file.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            value = ""
        if value:
            return value
        value = f"inst-{uuid.uuid4().hex}"
        temp = self.install_id_file.with_name(f".install_id.{uuid.uuid4().hex}")
        temp.write_text(value + "\n", encoding="utf-8")
        try:
            os.link(temp, self.install_id_file)  # 并发启动时只有一个赢家，其余读取赢家的值
        except FileExistsError:
            value = self.install_id_file.read_text(encoding="utf-8").strip()
        finally:
            temp.unlink(missing_ok=True)
        return value


def data_root() -> DataRoot:
    from core.config import get_settings
    value = get_settings().data_root
    if not value:
        raise DataRootMissing("没有指定数据根：开发时用 --data-root 启动核心，正式包由宿主传入")
    return DataRoot(Path(value).expanduser().resolve())
