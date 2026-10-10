"""只清理固定清单内的存储与托管容器，不删除配置或任意 Docker 资源。"""
import asyncio
import os
import shutil
import stat
import uuid
import docker
from docker.errors import NotFound
from app.infrastructure.external.project.managed_storage import ManagedProjectStorage
from app.domain.models.file import File


class DataCleanupResources:
    def __init__(self, storage, files, settings, redis):
        self.storage, self.files, self.settings, self.redis = storage, files, settings, redis

    async def sandboxes(self, task):
        if self.settings.sandbox_address:
            # 直连的外部环境没有容器归属，不能代用户销毁。
            if task.sandbox_ids:
                raise ValueError('直连沙箱不能确认数据清理，请改用托管沙箱后重试')
            return
        if not task.sandbox_ids and not task.project_ids:
            return
        def remove():
            client = docker.from_env()
            try:
                containers = {}
                for identifier in task.sandbox_ids:
                    try:
                        container = client.containers.get(identifier)
                        if not container.name.startswith(self.settings.sandbox_name_prefix + '-'):
                            raise ValueError('沙箱容器不属于当前托管实例')
                        containers[container.id] = container
                    except NotFound:
                        pass
                for project_id in task.project_ids:
                    for container in client.containers.list(all=True, filters={'label': 'rayagent.project_id=' + project_id}):
                        containers[container.id] = container
                for container in containers.values():
                    try:
                        container.remove(force=True)
                    except NotFound:
                        pass
            finally:
                client.close()
        await asyncio.to_thread(remove)

    async def project(self, identifier):
        ManagedProjectStorage.check_id(identifier)
        def remove():
            # descriptors + rmtree 的安全实现不跟随项目或 Agent 留下的符号链接。
            root = os.open(self.storage.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                try:
                    parent = os.open('projects', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
                except FileNotFoundError:
                    return
                try:
                    try:
                        mode = os.stat(identifier, dir_fd=parent, follow_symlinks=False).st_mode
                        if stat.S_ISLNK(mode):
                            os.unlink(identifier, dir_fd=parent)
                        else:
                            shutil.rmtree(identifier, dir_fd=parent)
                    except FileNotFoundError:
                        pass
                finally:
                    os.close(parent)
            finally:
                os.close(root)
        await asyncio.to_thread(remove)

    async def attachment(self, value):
        await self.files.delete_file(File.model_validate(value))

    async def queue(self, identifier):
        await self.redis.delete('task:input:' + identifier)

    async def leftovers(self):
        """全局清空兼顾未登记成功的本地 UUID 文件及旧任务输入流。"""
        def registered_name(value):
            try:
                uuid.UUID(value.split('.')[0])
                return True
            except ValueError:
                return False
        def remove():
            # 仅清理存储约定的 UUID 对象与孤立项目；不扫描任意路径或 COS 桶。
            root = self.storage.root
            projects = root/'projects'
            if projects.is_dir() and not projects.is_symlink():
                for path in projects.iterdir():
                    if registered_name(path.name):
                        if path.is_symlink(): path.unlink()
                        else: shutil.rmtree(path)
            if self.settings.file_storage_backend == 'local':
                for year in root.iterdir():
                    if not (year.name.isdigit() and len(year.name)==4 and year.is_dir() and not year.is_symlink()): continue
                    for month in year.iterdir():
                        if not (month.name.isdigit() and len(month.name)==2 and month.is_dir() and not month.is_symlink()): continue
                        for day in month.iterdir():
                            if not (day.name.isdigit() and len(day.name)==2 and day.is_dir() and not day.is_symlink()): continue
                            for path in day.iterdir():
                                if registered_name(path.name) and not path.is_dir(): path.unlink(missing_ok=True)
        await asyncio.to_thread(remove)
        async for key in self.redis.scan_iter(match='task:input:*'):
            await self.redis.delete(key)
