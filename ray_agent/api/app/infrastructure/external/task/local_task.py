#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""进程内任务注册表：按运行 id 登记执行协程。核心退出后这些协程不复存在，由下次启动扫描处理遗留运行。"""
import asyncio
import logging
from typing import Dict, Optional

from app.domain.external.task import Task, TaskRunner

logger = logging.getLogger(__name__)


class LocalRunTask(Task):

    _task_registry: Dict[str, "LocalRunTask"] = {}
    _executing: Dict[str, asyncio.Task] = {}  # 执行协程真正退出前一直保留：取消会先把任务移出注册表

    def __init__(self, task_runner: TaskRunner) -> None:
        self._task_runner = task_runner
        self._id = str(getattr(task_runner, "run_id"))
        self._execution_task: Optional[asyncio.Task] = None
        LocalRunTask._task_registry[self._id] = self

    def _cleanup_registry(self) -> None:
        if LocalRunTask._task_registry.get(self._id) is self:
            del LocalRunTask._task_registry[self._id]

    async def _execute_task(self) -> None:
        try:
            await self._task_runner.invoke(self)
        except asyncio.CancelledError:
            logger.info(f"运行[{self._id}]执行被取消")
            raise
        except Exception as e:
            logger.error(f"运行[{self._id}]执行出现异常: {str(e)}")
        finally:
            asyncio.create_task(self._task_runner.on_done(self))
            self._cleanup_registry()
            if LocalRunTask._executing.get(self._id) is asyncio.current_task():
                del LocalRunTask._executing[self._id]

    async def invoke(self) -> None:
        if self.done:
            self._execution_task = asyncio.create_task(self._execute_task())
            LocalRunTask._executing[self._id] = self._execution_task

    def cancel(self) -> bool:
        if not self.done:
            self._execution_task.cancel()
        self._cleanup_registry()
        return True

    @property
    def task_runner(self) -> TaskRunner:
        return self._task_runner

    @property
    def id(self) -> str:
        return self._id

    @property
    def done(self) -> bool:
        return self._execution_task is None or self._execution_task.done()

    @property
    def execution(self) -> Optional[asyncio.Task]:
        return self._execution_task

    @classmethod
    def executing(cls, run_id: str) -> Optional[asyncio.Task]:
        """仍未退出的执行协程；取消之后到它真正结束之前仍能找到。"""
        task = cls._executing.get(run_id)
        if task is not None and task.done():
            del cls._executing[run_id]
            return None
        return task

    @classmethod
    def get(cls, task_id: str) -> Optional["LocalRunTask"]:
        return cls._task_registry.get(task_id)

    @classmethod
    def create(cls, task_runner: TaskRunner) -> "LocalRunTask":
        return cls(task_runner)

    @classmethod
    async def destroy(cls) -> None:
        tasks = list(cls._task_registry.values())
        for task in tasks:
            task.cancel()
        executions = [task.execution for task in tasks if task.execution is not None]
        if executions:
            await asyncio.gather(*executions, return_exceptions=True)
        for task in tasks:
            await task.task_runner.destroy()
        cls._task_registry.clear()
