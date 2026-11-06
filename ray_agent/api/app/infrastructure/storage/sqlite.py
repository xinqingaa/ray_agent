"""本机业务库：WAL、外键与明确的 busy 处理。

写协调器独占一条写连接，业务写事务按进入顺序串行，事务以 BEGIN IMMEDIATE 开始，忙碌只在开始阶段有界重试，
那时业务代码还没有执行，也就没有外部副作用。读取使用独立的只读连接池，在 WAL 下与写入并发。
一个数据根只能由一个核心持有实例锁。
"""
import asyncio
import logging
import os
import sqlite3
from pathlib import Path
from typing import Optional

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool

from core.paths import RESOURCE_ROOT

logger = logging.getLogger(__name__)

_BUSY_CODES = {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}
_RETRY_DELAY_SECONDS = 0.2


class DatabaseBusyError(RuntimeError):
    """业务库在有界等待后仍被占用；请求没有执行，可以原样重试。"""


class DataRootLocked(RuntimeError):
    """数据根已被另一个核心持有。"""


class SchemaTooNew(RuntimeError):
    """业务库的 schema 版本超出本程序可读范围。"""


def is_busy(error: BaseException) -> bool:
    origin = getattr(error, "orig", error)
    code = getattr(origin, "sqlite_errorcode", None)
    if code is not None:
        return code & 0xFF in _BUSY_CODES
    return isinstance(origin, sqlite3.OperationalError) and "locked" in str(origin)


class InstanceLock:
    """操作系统级的排他文件锁，持有到进程退出；进程被强制结束时由系统释放。"""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._fd: Optional[int] = None

    def acquire(self) -> None:
        fd = os.open(self._path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            raise DataRootLocked(f"数据根已被另一个核心占用：{self._path.parent}") from exc
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode())
        self._fd = fd

    def release(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None


def _alembic_config(database: Path) -> Config:
    config = Config()
    config.set_main_option("script_location", str(RESOURCE_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    return config


def migrate(database: Path) -> str:
    """升级到本程序的最新 schema 并返回版本；业务库版本超出可读范围时拒绝打开。"""
    config = _alembic_config(database)
    script = ScriptDirectory.from_config(config)
    known = {revision.revision for revision in script.walk_revisions()}
    if database.exists():
        engine = create_engine(f"sqlite:///{database}")
        try:
            with engine.connect() as connection:
                current = MigrationContext.configure(connection).get_current_revision()
        finally:
            engine.dispose()
        if current is not None and current not in known:
            raise SchemaTooNew(f"业务库版本 {current} 来自更新的程序，当前程序不能打开")
    command.upgrade(config, "head")
    return script.get_current_head()


class Database:
    def __init__(self, path: Path, *, busy_timeout_ms: int, begin_attempts: int, read_pool_size: int,
                 echo: bool = False) -> None:
        self.path = path
        self._busy_timeout_ms = busy_timeout_ms
        self._begin_attempts = begin_attempts
        self._read_pool_size = read_pool_size
        self._echo = echo
        self._writer: Optional[AsyncEngine] = None
        self._reader: Optional[AsyncEngine] = None
        self._write_sessions: Optional[async_sessionmaker[AsyncSession]] = None
        self._read_sessions: Optional[async_sessionmaker[AsyncSession]] = None
        self._write_lock: Optional[asyncio.Lock] = None
        self._write_owner: Optional[asyncio.Task] = None

    def _engine(self, *, writer: bool) -> AsyncEngine:
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{self.path}", echo=self._echo, poolclass=AsyncAdaptedQueuePool,
            pool_size=1 if writer else self._read_pool_size, max_overflow=0, pool_timeout=30,
        )
        busy_timeout = self._busy_timeout_ms

        @event.listens_for(engine.sync_engine, "connect")
        def _connect(dbapi_connection, _record):
            # 由引擎自己发出 BEGIN，避免驱动按语句类型隐式开启事务。
            dbapi_connection.isolation_level = None
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute(f"PRAGMA busy_timeout={busy_timeout}")
            if writer:
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=FULL")
            else:
                cursor.execute("PRAGMA query_only=ON")
            cursor.close()

        @event.listens_for(engine.sync_engine, "begin")
        def _begin(connection):
            connection.exec_driver_sql("BEGIN IMMEDIATE" if writer else "BEGIN")

        return engine

    async def init(self) -> None:
        if self._writer is not None:
            return
        self._writer = self._engine(writer=True)
        self._reader = self._engine(writer=False)
        self._write_sessions = async_sessionmaker(self._writer, autoflush=False, expire_on_commit=False)
        self._read_sessions = async_sessionmaker(self._reader, autoflush=False, expire_on_commit=False)
        self._write_lock = asyncio.Lock()
        logger.info(f"业务库已打开: {self.path}")

    async def shutdown(self) -> None:
        for engine in (self._reader, self._writer):
            if engine is not None:
                await engine.dispose()
        self._writer = self._reader = None
        self._write_sessions = self._read_sessions = None

    @property
    def ready(self) -> bool:
        return self._writer is not None

    async def open_write(self) -> AsyncSession:
        """取得写入权并开始 IMMEDIATE 事务。同一任务内嵌套写事务会自锁，直接报错。"""
        if self._write_sessions is None:
            raise RuntimeError("业务库未初始化")
        task = asyncio.current_task()
        if task is not None and self._write_owner is task:
            raise RuntimeError("同一任务内不能嵌套写事务")
        await self._write_lock.acquire()
        self._write_owner = task
        attempt = 0
        while True:
            attempt += 1
            session = self._write_sessions()
            try:
                await session.connection()
                return session
            except OperationalError as exc:
                retry = is_busy(exc) and attempt < self._begin_attempts
                closing = self._close(session, release=not retry)
                try:
                    await asyncio.shield(closing)
                    if retry:
                        logger.warning(f"业务库忙碌，第 {attempt} 次开始写事务失败，稍后重试")
                        await asyncio.sleep(_RETRY_DELAY_SECONDS * attempt)
                except BaseException:
                    if retry:
                        closing.add_done_callback(lambda _: self._release_write())
                    raise
                if retry:
                    continue
                if is_busy(exc):
                    raise DatabaseBusyError("业务库被其他连接占用，请稍后重试") from exc
                raise
            except BaseException:
                await asyncio.shield(self._close(session, release=True))
                raise

    def _close(self, session: AsyncSession, *, release: bool) -> asyncio.Task:
        async def finish() -> None:
            try:
                await session.close()
            finally:
                if release:
                    self._release_write()
        return asyncio.get_running_loop().create_task(finish())

    def _release_write(self) -> None:
        self._write_owner = None
        self._write_lock.release()

    async def close_write(self, session: AsyncSession, *, commit: bool) -> None:
        """提交或回滚并归还写连接。收尾在独立任务里完成：调用方被取消时连接仍会被清理，写入权随后才释放。"""
        async def finish() -> None:
            try:
                if commit:
                    await session.commit()
                else:
                    await session.rollback()
            finally:
                try:
                    await session.close()
                finally:
                    self._release_write()
        await asyncio.shield(asyncio.get_running_loop().create_task(finish()))

    async def open_read(self) -> AsyncSession:
        if self._read_sessions is None:
            raise RuntimeError("业务库未初始化")
        session = self._read_sessions()
        try:
            await session.connection()
        except BaseException:
            await session.close()
            raise
        return session

    @staticmethod
    async def close_read(session: AsyncSession) -> None:
        await asyncio.shield(asyncio.get_running_loop().create_task(session.close()))


_database: Optional[Database] = None


def open_database(path: Path) -> Database:
    from core.config import get_settings
    settings = get_settings()
    return Database(path, busy_timeout_ms=settings.sqlite_busy_timeout_ms, begin_attempts=settings.sqlite_begin_attempts,
                    read_pool_size=settings.sqlite_read_pool_size, echo=settings.sqlalchemy_echo)


def set_database(database: Optional[Database]) -> None:
    global _database
    _database = database


def get_database() -> Database:
    if _database is None:
        raise RuntimeError("业务库未初始化")
    return _database


def get_uow():
    from app.infrastructure.repositories.db_uow import DBUnitOfWork
    return DBUnitOfWork(get_database())


def get_read_uow():
    from app.infrastructure.repositories.db_uow import DBUnitOfWork
    return DBUnitOfWork(get_database(), readonly=True)
