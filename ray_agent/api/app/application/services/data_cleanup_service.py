"""不可逆清理：受理固定清单 → 可重试资源清理 → 最后删除业务记录。"""
import asyncio
import logging

logger = logging.getLogger(__name__)
_workers = set()


class DataCleanupService:
    def __init__(self, repository, resources):
        self.repository, self.resources = repository, resources

    async def preview(self, project_id=None):
        return await self.repository.preview(project_id)

    async def start(self, project_id, confirmation):
        result = await self.repository.claim(project_id, confirmation)
        self.schedule(result.id)
        return result

    def schedule(self, identifier):
        worker = asyncio.create_task(self.execute(identifier))
        _workers.add(worker)
        worker.add_done_callback(_workers.discard)

    async def execute(self, identifier):
        # 独立 worker 锁避免重复点击、响应丢失重试或多进程同时清理。
        async with self.repository.worker() as acquired:
            if not acquired:
                return
            task = await self.repository.get(identifier)
            if task.state == 'completed':
                return
            try:
                await self.repository.update(identifier, state='running', error=None)
                steps = [('沙箱', lambda: self.resources.sandboxes(task))]
                steps += [('项目文件', lambda item=item: self.resources.project(item)) for item in task.project_ids]
                steps += [('附件', lambda item=item: self.resources.attachment(item)) for item in task.files]
                steps += [('消息队列', lambda item=item: self.resources.queue(item)) for item in task.task_ids]
                if task.scope == 'all':
                    steps.append(('残留文件与消息', self.resources.leftovers))
                for index, (label, action) in enumerate(steps):
                    if index < task.completed:
                        continue
                    await self.repository.update(identifier, phase=label)
                    await action()
                    await self.repository.update(identifier, completed=index+1)
                await self.repository.update(identifier, phase='记录')
                await self.repository.finish(identifier)
            except asyncio.CancelledError:
                await asyncio.shield(self.repository.update(identifier, state='failed', error='服务已停止，请读回状态并重试'))
                raise
            except Exception as error:
                logger.exception('数据清理失败 %s', identifier)
                await self.repository.update(identifier, state='failed', error=str(error))

    async def retry(self, identifier):
        task = await self.repository.get(identifier)
        if task.state != 'completed':
            self.schedule(identifier)
        return task
