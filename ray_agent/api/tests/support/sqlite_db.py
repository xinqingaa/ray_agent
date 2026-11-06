"""真实 SQLite 业务库夹具：在临时数据根执行迁移并打开写协调器与读连接池。"""
import asyncio
from pathlib import Path
from typing import Awaitable, Callable

from app.infrastructure.repositories.db_uow import DBUnitOfWork
from app.infrastructure.storage.sqlite import Database, migrate


async def open_database(root: Path, *, busy_timeout_ms: int = 2000, begin_attempts: int = 3,
                        read_pool_size: int = 4) -> Database:
    root.mkdir(parents=True, exist_ok=True)
    path = root / "rayagent.db"
    await asyncio.to_thread(migrate, path)
    database = Database(path, busy_timeout_ms=busy_timeout_ms, begin_attempts=begin_attempts,
                        read_pool_size=read_pool_size)
    await database.init()
    return database


def factories(database: Database):
    return (lambda: DBUnitOfWork(database)), (lambda: DBUnitOfWork(database, readonly=True))


def with_database(root: Path, scenario: Callable[..., Awaitable[None]], timeout: float = 30, **options) -> None:
    """scenario(uow_factory, read_uow_factory, database)，结束后关闭连接。"""
    async def main():
        database = await open_database(root, **options)
        uow_factory, read_factory = factories(database)
        try:
            await scenario(uow_factory, read_factory, database)
        finally:
            await database.shutdown()
    asyncio.run(asyncio.wait_for(main(), timeout))
