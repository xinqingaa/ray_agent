"""本机业务库：WAL、外键与明确的 busy 处理。

写协调器独占一条写连接，业务写事务按进入顺序串行，事务以 BEGIN IMMEDIATE 开始，忙碌只在开始阶段有界重试，
那时业务代码还没有执行，也就没有外部副作用。读取使用独立的只读连接池，在 WAL 下与写入并发。
一个数据根只能由一个核心持有实例锁。schema 升级前用 SQLite 备份接口生成一致副本，旧二进制拒绝打开更新的 schema。
"""
import asyncio
import logging
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable, Optional, TypeVar

import aiosqlite
import anyio

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

T = TypeVar("T")

_BUSY_CODES = {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}
_RETRY_DELAY_SECONDS = 0.2
_REVISION_FILE_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class DatabaseBusyError(RuntimeError):
    """业务库在有界等待后仍被占用；请求没有执行，可以原样重试。"""


class DataRootLocked(RuntimeError):
    """数据根已被另一个核心持有。"""


class SchemaTooNew(RuntimeError):
    """业务库的 schema 版本超出本程序可读范围。"""


class SchemaUpgradeBackupError(RuntimeError):
    """升级前副本未能写完；拒绝继续升级，以免无法回退。"""


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


def _safe_revision(value: str) -> str:
    cleaned = _REVISION_FILE_SAFE.sub("_", value).strip("._")
    return cleaned or "unknown"


def backup_before_upgrade(database: Path, *, from_revision: str, to_revision: str) -> Path:
    """用 SQLite 在线备份接口生成升级前一致副本，写入数据根下的 upgrades/。

    副本文件名含来源／目标 schema 与 UTC 时间；失败时抛出 SchemaUpgradeBackupError，调用方不得继续升级。
    """
    directory = database.parent / "upgrades"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"rayagent.db.before-{_safe_revision(from_revision)}-to-{_safe_revision(to_revision)}-{stamp}"
    dest = directory / name
    temp = directory / f".{name}.{os.getpid()}.tmp"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(database) as source:
            with sqlite3.connect(temp) as target:
                source.backup(target)
        os.replace(temp, dest)
    except OSError as exc:
        try:
            Path(temp).unlink(missing_ok=True)
        except OSError:
            pass
        raise SchemaUpgradeBackupError(f"无法写入升级前副本：{dest}") from exc
    logger.info(f"升级前副本已写入 {dest}（{from_revision} → {to_revision}）")
    return dest


def migrate(database: Path) -> str:
    """升级到本程序的最新 schema 并返回版本；业务库版本超出可读范围时拒绝打开。

    已有库的 schema 低于本程序 head 时，先用 SQLite 备份接口写升级前副本，再执行迁移。
    """
    config = _alembic_config(database)
    script = ScriptDirectory.from_config(config)
    known = {revision.revision for revision in script.walk_revisions()}
    head = script.get_current_head()
    if database.exists():
        engine = create_engine(f"sqlite:///{database}")
        try:
            with engine.connect() as connection:
                current = MigrationContext.configure(connection).get_current_revision()
        finally:
            engine.dispose()
        if current is not None and current not in known:
            raise SchemaTooNew(f"业务库版本 {current} 来自更新的程序，当前程序不能打开")
        if current is not None and head is not None and current != head:
            backup_before_upgrade(database, from_revision=current, to_revision=head)
    command.upgrade(config, "head")
    return head


async def uninterrupted(awaitable: Awaitable[T]) -> T:
    """等一次驱动调用做完。调用交给工作线程后总会执行完；中途取消会让 SQLAlchemy 把连接当作断线，在取消中终止连接，
    被打断语句的游标还会拖住事务与锁。期间收到的取消在调用完成后重新交给当前任务，于下一个不访问数据库的等待点生效。"""
    task = asyncio.current_task()
    inner = asyncio.ensure_future(awaitable)
    deferred: list[asyncio.CancelledError] = []
    with anyio.CancelScope(shield=True):
        while not inner.done():
            try:
                await asyncio.wait((inner,))
            except asyncio.CancelledError as exc:
                deferred.append(exc)
                task.uncancel()
    for exc in deferred:
        task.cancel(*exc.args)
    return inner.result()


async def settle(awaitable: Awaitable[T]) -> T:
    """在独立任务里做完收尾（提交或回滚、归还连接、释放写入权）并等它结束；期间的取消在收尾完成后再交出。"""
    work = asyncio.ensure_future(awaitable)
    cancelled: Optional[asyncio.CancelledError] = None
    with anyio.CancelScope(shield=True):
        while not work.done():
            try:
                await asyncio.wait((work,))
            except asyncio.CancelledError as exc:
                cancelled = cancelled or exc
    if cancelled is not None:
        if not work.cancelled() and work.exception() is not None:
            logger.warning(f"收尾失败，同时收到取消: {work.exception()!r}")
        raise cancelled
    return work.result()


class _Connection(aiosqlite.Connection):
    """驱动连接：每次调用都做完再交还取消，关闭也不被打断。"""

    async def _execute(self, fn, *args, **kwargs):
        return await uninterrupted(super()._execute(fn, *args, **kwargs))

    async def close(self) -> None:
        await uninterrupted(super().close())


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
        # 由引擎自己发出 BEGIN，驱动不按语句类型隐式开启事务。
        connector = partial(sqlite3.connect, str(self.path), isolation_level=None)

        async def connect() -> _Connection:
            return await _Connection(connector, 64)

        engine = create_async_engine(
            f"sqlite+aiosqlite:///{self.path}", async_creator=connect, echo=self._echo,
            poolclass=AsyncAdaptedQueuePool, pool_size=1 if writer else self._read_pool_size, max_overflow=0,
            pool_timeout=30,
        )
        busy_timeout = self._busy_timeout_ms

        @event.listens_for(engine.sync_engine, "connect")
        def _connect(dbapi_connection, _record):
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

    def checked_out(self) -> tuple[int, int]:
        """写、读连接池中当前签出的连接数。"""
        return tuple(engine.pool.checkedout() if engine is not None else 0 for engine in (self._writer, self._reader))

    def write_locked(self) -> bool:
        return self._write_lock is not None and self._write_lock.locked()

    async def open_write(self) -> AsyncSession:
        """取得写入权并开始 IMMEDIATE 事务。同一任务内嵌套写事务会自锁，直接报错。"""
        if self._write_sessions is None:
            raise RuntimeError("业务库未初始化")
        task = asyncio.current_task()
        if task is not None and self._write_owner is task:
            raise RuntimeError("同一任务内不能嵌套写事务")
        await self._write_lock.acquire()
        self._write_owner = task
        try:
            return await self._begin_write()
        except BaseException:
            self._release_write()
            raise

    async def _begin_write(self) -> AsyncSession:
        attempt = 0
        while True:
            attempt += 1
            session = self._write_sessions()
            try:
                await session.connection()
                return session
            except BaseException as exc:
                await settle(session.close())
                if not is_busy(exc):
                    raise
                if attempt >= self._begin_attempts:
                    raise DatabaseBusyError("业务库被其他连接占用，请稍后重试") from exc
                logger.warning(f"业务库忙碌，第 {attempt} 次开始写事务失败，稍后重试")
                await asyncio.sleep(_RETRY_DELAY_SECONDS * attempt)

    def _release_write(self) -> None:
        self._write_owner = None
        self._write_lock.release()

    async def close_write(self, session: AsyncSession, *, commit: bool,
                          after_commit: Optional[Callable[[], None]] = None) -> None:
        """提交或回滚并归还写连接，最后释放写入权；调用方被取消时收尾照常做完。after_commit 在提交成功后执行。"""
        async def finish() -> None:
            try:
                if commit:
                    await session.commit()
                    if after_commit is not None:
                        after_commit()
                else:
                    await session.rollback()
            finally:
                try:
                    await session.close()
                finally:
                    self._release_write()
        await settle(finish())

    async def open_read(self) -> AsyncSession:
        if self._read_sessions is None:
            raise RuntimeError("业务库未初始化")
        session = self._read_sessions()
        try:
            await session.connection()
        except BaseException:
            await settle(session.close())
            raise
        return session

    @staticmethod
    async def close_read(session: AsyncSession) -> None:
        await settle(session.close())

    @asynccontextmanager
    async def read_session(self) -> AsyncIterator[AsyncSession]:
        session = await self.open_read()
        try:
            yield session
        finally:
            await self.close_read(session)

    @asynccontextmanager
    async def write_session(self, *, after_commit: Optional[Callable[[AsyncSession], None]] = None
                            ) -> AsyncIterator[AsyncSession]:
        """写事务：主体正常结束才提交，任何异常（含取消）都回滚。"""
        session = await self.open_write()
        commit = False
        try:
            yield session
            commit = True
        finally:
            await self.close_write(session, commit=commit,
                                   after_commit=(lambda: after_commit(session)) if after_commit else None)


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
