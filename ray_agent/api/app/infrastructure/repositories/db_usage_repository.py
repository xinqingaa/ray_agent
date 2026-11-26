"""用量写入与范围读取，共用业务库的写队列和读快照。"""
from datetime import datetime

from sqlalchemy import delete, func, select

from app.domain.models.clock import utc_now
from app.domain.models.usage import UsagePreferences, UsageTotals
from app.infrastructure.models.app_config import AppConfigModel
from app.infrastructure.models.usage import UsageModel


class DBUsageRepository:
    def __init__(self, db_session):
        self._db = db_session

    async def add(self, *, started_at: datetime, session_id, run_id, workspace_id, **fields) -> None:
        reset = await self._db.get(AppConfigModel, "usage_reset")
        if reset is not None and started_at <= reset.updated_at:
            return
        async def existing(table, identity):
            return identity if identity and await self._db.get(table, identity) is not None else None

        from app.infrastructure.models import RunModel, SessionModel, WorkspaceModel
        self._db.add(UsageModel(started_at=started_at, session_id=await existing(SessionModel, session_id),
                                run_id=await existing(RunModel, run_id),
                                workspace_id=await existing(WorkspaceModel, workspace_id), **fields))

    async def between(self, start: datetime, end: datetime, provider: str | None) -> list[UsageModel]:
        statement = select(UsageModel).where(UsageModel.started_at >= start, UsageModel.started_at < end)
        if provider is not None:
            statement = statement.where(UsageModel.provider == provider)
        return list((await self._db.scalars(statement)).all())

    async def model_pairs(self, provider: str | None) -> list[tuple[str, str]]:
        statement = select(UsageModel.provider, UsageModel.model).distinct()
        if provider is not None:
            statement = statement.where(UsageModel.provider == provider)
        return list((await self._db.execute(statement)).tuples().all())

    async def providers(self) -> list[str]:
        return list((await self._db.scalars(select(UsageModel.provider).distinct().order_by(UsageModel.provider))).all())

    async def run_cost(self, run_id: str) -> int | None:
        usd, _ = await self.run_costs(run_id)
        return usd

    async def run_costs(self, run_id: str) -> tuple[int | None, int | None]:
        row = (await self._db.execute(
            select(func.sum(UsageModel.cost_nano_usd), func.sum(UsageModel.cost_nano_cny)).where(
                UsageModel.run_id == run_id, UsageModel.purpose.in_(("main", "compact"))
            )
        )).one()
        return row[0], row[1]

    async def session_totals(self, session_id: str) -> UsageTotals:
        columns = (UsageModel.input_tokens, UsageModel.cached_tokens, UsageModel.output_tokens,
                   UsageModel.total_tokens, UsageModel.reasoning_tokens,
                   UsageModel.audio_duration_ms)
        statement = select(
            func.count(UsageModel.id), func.count().filter(UsageModel.failed),
            func.count().filter(UsageModel.cost_nano_usd.is_(None), UsageModel.cost_nano_cny.is_(None)),
            *(func.coalesce(func.sum(column), 0) for column in columns),
            func.sum(UsageModel.cost_nano_usd), func.sum(UsageModel.cost_nano_cny),
        ).where(UsageModel.session_id == session_id)
        (
            requests, failed_requests, unpriced_requests,
            input_tokens, cached_tokens, output_tokens,
            total_tokens, reasoning_tokens, audio_duration_ms,
            cost_nano_usd, cost_nano_cny,
        ) = (await self._db.execute(statement)).one()
        return UsageTotals(
            requests=requests, failed_requests=failed_requests, unpriced_requests=unpriced_requests,
            input_tokens=input_tokens, cached_tokens=cached_tokens, output_tokens=output_tokens,
            total_tokens=total_tokens, reasoning_tokens=reasoning_tokens, audio_duration_ms=audio_duration_ms,
            cost_nano_usd=cost_nano_usd, cost_nano_cny=cost_nano_cny,
        )

    async def preferences(self) -> UsagePreferences:
        row = await self._db.get(AppConfigModel, "usage_preferences")
        return UsagePreferences.model_validate(row.data) if row else UsagePreferences()

    async def save_preferences(self, preferences: UsagePreferences) -> None:
        await self._save_setting("usage_preferences", preferences.model_dump(mode="json"))

    async def clear(self) -> None:
        await self._db.execute(delete(UsageModel))
        await self._save_setting("usage_reset", {})

    async def _save_setting(self, key: str, value: dict) -> None:
        row = await self._db.get(AppConfigModel, key)
        if row is None:
            self._db.add(AppConfigModel(key=key, data=value, updated_at=utc_now()))
        else:
            row.data, row.version, row.updated_at = value, row.version + 1, utc_now()
