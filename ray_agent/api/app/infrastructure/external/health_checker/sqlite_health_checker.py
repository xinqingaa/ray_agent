"""业务库健康检查：经读连接池执行一次查询，并确认写协调器可用。"""
from sqlalchemy import text

from app.domain.external.health_checker import HealthChecker
from app.domain.models.health_status import HealthStatus


class SQLiteHealthChecker(HealthChecker):

    def __init__(self, database) -> None:
        self._database = database

    async def check(self) -> HealthStatus:
        try:
            if not self._database.ready:
                return HealthStatus(service="sqlite", status="error", details="业务库未初始化")
            session = await self._database.open_read()
            try:
                mode = (await session.execute(text("PRAGMA journal_mode"))).scalar_one()
            finally:
                await self._database.close_read(session)
            if str(mode).lower() != "wal":
                return HealthStatus(service="sqlite", status="error", details=f"业务库日志模式异常：{mode}")
            return HealthStatus(service="sqlite", status="ok")
        except Exception as e:
            return HealthStatus(service="sqlite", status="error", details=str(e))
