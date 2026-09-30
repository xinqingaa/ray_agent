"""平台托管项目目录与挂载。外部只能提供项目 id，不能登记宿主机路径。"""
import os
import re
import socket
from pathlib import Path
from functools import lru_cache

import docker
from docker.types import Mount

from core.config import get_settings


class ManagedProjectStorage:
    def __init__(self, root: str, *, local_bind: str | None = None, uid=1000, gid=1000):
        self.root = Path(root).absolute()
        self.local_bind = local_bind
        self.uid, self.gid = uid, gid
        self.volume: str | None = None
        self.reason: str | None = "项目存储尚未完成启动自检"

    @staticmethod
    def check_id(project_id: str) -> str:
        if not isinstance(project_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", project_id):
            raise ValueError("项目标识不合法")
        return project_id

    def files_path(self, project_id: str) -> Path:
        return self.root / "projects" / self.check_id(project_id) / "files"

    def initialize(self, client=None, *, in_container=None, container_id=None):
        self.volume = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            if in_container is None:
                in_container = Path('/.dockerenv').exists()
            if in_container:
                client = client or docker.from_env()
                container = client.containers.get(container_id or socket.gethostname())
                container.reload()
                target = str(self.root)
                self.volume = next((m['Name'] for m in container.attrs.get('Mounts', [])
                    if m.get('Type') == 'volume' and m.get('Destination') == target and m.get('RW')), None)
                if not self.volume:
                    raise ValueError("无法解析项目文件存储的命名卷，请检查 API 数据卷挂载")
                if tuple(map(int, client.version()['ApiVersion'].split('.'))) < (1, 45):
                    raise ValueError("项目卷子路径挂载要求 Docker API 1.45 或以上")
            elif not self.local_bind or Path(self.local_bind).resolve() != self.root.resolve():
                raise ValueError("本地开发需显式设置 PROJECT_LOCAL_BIND 为 API 文件存储目录")
            self.reason = None
        except Exception as exc:
            self.reason = f"项目存储不可用：{exc}"
        return self.reason is None

    def ensure_project(self, project_id: str):
        """逐层无跟随创建目录；不允许 Agent 将 files 根替换成链接。"""
        self.check_id(project_id)
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in ('projects', project_id, 'files'):
                try:
                    os.mkdir(part, mode=0o775, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = child
                os.fchmod(fd, 0o775)
                if os.geteuid() == 0:
                    os.fchown(fd, self.uid, self.gid)
        finally:
            os.close(fd)
        return self.files_path(project_id)

    def validate(self, project_id: str):
        if self.reason:
            raise ValueError(self.reason)
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in ('projects', self.check_id(project_id), 'files'):
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = child
        finally:
            os.close(fd)

    def mount(self, project_id: str):
        self.validate(project_id)
        if self.volume:
            mount = Mount(target='/workspace', source=self.volume, type='volume')
            mount['VolumeOptions'] = {'NoCopy': True, 'Subpath': f'projects/{project_id}/files'}
            return mount
        # 仅本地开发的托管目录回退；不能接入用户目录。
        return Mount(target='/workspace', source=str(self.files_path(project_id)), type='bind')


@lru_cache()
def get_managed_storage():
    settings = get_settings()
    storage = ManagedProjectStorage(settings.file_storage_local_dir,
        local_bind=settings.project_local_bind, uid=settings.project_uid, gid=settings.project_gid)
    storage.initialize()
    return storage
