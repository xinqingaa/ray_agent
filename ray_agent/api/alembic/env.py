"""业务库迁移环境。核心启动时以代码构造的配置调用；命令行在 ray_agent/api 下运行时从 RAYAGENT_DATA_ROOT 定位业务库。

表结构变更一律使用批量模式（render_as_batch），SQLite 以复制表的方式完成 ALTER。
"""
import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, event, pool

from app.infrastructure.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    root = os.environ.get("RAYAGENT_DATA_ROOT")
    if not root:
        raise RuntimeError("命令行迁移需要用 RAYAGENT_DATA_ROOT 指定数据根")
    return f"sqlite:///{Path(root).expanduser().resolve() / 'rayagent.db'}"


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"}, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url(), poolclass=pool.NullPool)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_connection, _record):
        # 由迁移显式 BEGIN，结构变更与版本号同一事务提交。
        dbapi_connection.isolation_level = None
        # 批量模式会删除并重建表；外键开启时删除被引用的表会级联删掉子表数据。
        dbapi_connection.execute("PRAGMA foreign_keys=OFF")
        dbapi_connection.execute("PRAGMA journal_mode=WAL")

    @event.listens_for(engine, "begin")
    def _begin(connection):
        connection.exec_driver_sql("BEGIN")

    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True,
                          transactional_ddl=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
