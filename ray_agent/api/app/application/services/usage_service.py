"""按本机时区聚合请求用量，并给时间桶、对比和热力图共用同一口径。"""
import os
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.application.errors.exceptions import BadRequestError, NotFoundError
from app.domain.models.clock import utc_now
from app.domain.models.usage import UsageBucket, UsageGroup, UsageHour, UsagePreferences, UsageRange, UsageReport, UsageTotals
from app.domain.services.usage_pricing import PRICE_SOURCES, PRICE_VERSION, deepseek_peak_at

PURPOSES = ("main", "compact", "title", "memory", "summary", "transcribe", "connection_test")
WINDOW_DAYS = {"3d": 3, "7d": 7, "30d": 30, "90d": 90}
CALENDAR_DAYS = 13 * 7


def local_timezone() -> tzinfo:
    names = [os.environ.get("TZ")]
    local_path = Path("/etc/localtime")
    target = str(local_path.resolve())
    names.append(target.split("/zoneinfo/", 1)[-1] if "/zoneinfo/" in target else None)
    for name in filter(None, names):
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    try:
        with local_path.open("rb") as zone:
            return ZoneInfo.from_file(zone, key="local")
    except (OSError, ValueError):
        return datetime.now().astimezone().tzinfo or timezone.utc


def _midnight(day: date, zone: tzinfo) -> datetime:
    return datetime.combine(day, time.min, zone)


def _range(range_id: UsageRange, start, end, now: datetime, zone: tzinfo):
    today = now.astimezone(zone).date()
    first = _midnight(today - timedelta(days=CALENDAR_DAYS - 1), zone)
    if range_id == "custom":
        if start is None or end is None or start.tzinfo is None or end.tzinfo is None:
            raise BadRequestError("自定义范围需要带时区的起止时间")
        start, end = start.astimezone(zone), end.astimezone(zone)
        if any((point.minute, point.second, point.microsecond) != (0, 0, 0) for point in (start, end)):
            raise BadRequestError("自定义范围的起止时间必须是本机时区的整点")
        now_local = now.astimezone(zone)
        tomorrow = _midnight(today + timedelta(days=1), zone)
        if start.timestamp() < first.timestamp() or end.timestamp() > tomorrow.timestamp() or start.timestamp() >= end.timestamp() or start.timestamp() > now_local.timestamp():
            raise BadRequestError("起止时间超出可选范围，或结束时间早于开始")
        hours = (end.timestamp() - start.timestamp()) / 3600
        unit = "hour" if hours <= 48 else "3h" if hours <= 192 else "day"
        return start, end, unit, first
    end = now.astimezone(zone)
    if range_id == "24h":
        return (now - timedelta(hours=24)).astimezone(zone), end, "hour", first
    if range_id == "today":
        return _midnight(today, zone), end, "hour", first
    return _midnight(today - timedelta(days=WINDOW_DAYS[range_id] - 1), zone), end, (
        "3h" if range_id == "3d" else "day"
    ), first


def _boundaries(start: datetime, end: datetime, zone: tzinfo, unit: str) -> list[float]:
    """按当地钟表切桶，跳过夏令时缺失的小时并区分重复小时。"""
    left, right = start.timestamp(), end.timestamp()
    points = {left, right}
    step = {"hour": 1, "3h": 3, "day": 24}[unit]
    day = start.date()
    while day <= end.date():
        for hour in range(0, 24, step):
            wall = datetime.combine(day, time(hour))
            for fold in ((0, 1) if unit == "hour" else (0,)):
                value = wall.replace(tzinfo=zone, fold=fold).timestamp()
                if left < value < right and datetime.fromtimestamp(value, zone).replace(tzinfo=None) == wall:
                    points.add(value)
        day += timedelta(days=1)
    return sorted(points)


class _Aggregate:
    def __init__(self) -> None:
        self.totals = UsageTotals()
        self.models = Counter()
        self.periods: set[str] = set()

    def add(self, row) -> None:
        total = self.totals
        total.requests += 1
        total.failed_requests += int(row.failed)
        total.unpriced_requests += int(row.cost_nano_usd is None)
        for name in ("input_tokens", "cached_tokens", "output_tokens", "total_tokens", "reasoning_tokens", "audio_duration_ms"):
            setattr(total, name, getattr(total, name) + (getattr(row, name) or 0))
        if row.cost_nano_usd is not None:
            total.cost_nano_usd = (total.cost_nano_usd or 0) + row.cost_nano_usd
        self.models[row.model] += 1
        if row.price_period:
            self.periods.add(row.price_period)

    def details(self) -> dict:
        top = sorted(self.models, key=lambda model: (-self.models[model], model))[:3]
        return dict(**self.totals.model_dump(), top_models=top,
                    top_model_counts={model: self.models[model] for model in top}, price_periods=sorted(self.periods))


def _groups(groups) -> list[UsageGroup]:
    return [UsageGroup(key=key, **aggregate.totals.model_dump()) for key, aggregate in sorted(groups.items())]


class UsageService:
    def __init__(self, write_factory, read_factory):
        self._write = write_factory
        self._read = read_factory

    async def preferences(self) -> UsagePreferences:
        async with self._read() as uow:
            return await uow.usage.preferences()

    async def set_preferences(self, *, show_conversation_cost: bool | None, voice: str | None) -> UsagePreferences:
        async with self._write() as uow:
            preferences = await uow.usage.preferences()
            values = preferences.model_dump()
            if show_conversation_cost is not None:
                values["show_conversation_cost"] = show_conversation_cost
            if voice is not None:
                values["voice"] = voice
            preferences = UsagePreferences.model_validate(values)
            await uow.usage.save_preferences(preferences)
            return preferences

    async def session(self, session_id: str) -> UsageTotals:
        async with self._read() as uow:
            if await uow.session.get_by_id(session_id) is None:
                raise NotFoundError("会话不存在")
            return await uow.usage.session_totals(session_id)

    async def providers(self) -> list[str]:
        async with self._read() as uow:
            return await uow.usage.providers()

    async def report(self, range_id: UsageRange, start, end, provider, *, now=None, zone=None) -> UsageReport:
        now, zone = now or utc_now(), zone or local_timezone()
        start, end, unit, first = _range(range_id, start, end, now, zone)
        left, right = start.timestamp(), end.timestamp()
        prev = left - (right - left)
        calendar_last = _midnight(now.astimezone(zone).date() + timedelta(days=1), zone)
        today = calendar_last.date() - timedelta(days=1)
        week_start = today - timedelta(days=today.weekday())
        query_start = datetime.fromtimestamp(min(first.timestamp(), prev), timezone.utc)
        async with self._read() as uow:
            rows = await uow.usage.between(query_start, now, provider)
            model_pairs = await uow.usage.model_pairs(provider)

        total, previous = _Aggregate(), _Aggregate()
        bounds = _boundaries(start, end, zone, unit)
        buckets = [(_Aggregate(), defaultdict(_Aggregate)) for _ in bounds[1:]]
        hours = defaultdict(_Aggregate)
        calendar = defaultdict(_Aggregate)
        providers, models = defaultdict(_Aggregate), defaultdict(lambda: defaultdict(_Aggregate))
        for provider_key, model_key in model_pairs:
            providers[provider_key] = _Aggregate()
            models[provider_key][model_key] = _Aggregate()
        purposes = {purpose: _Aggregate() for purpose in PURPOSES}
        for row in rows:
            stamp = row.started_at.timestamp()
            local = row.started_at.astimezone(zone)
            calendar[local.date()].add(row)
            if prev <= stamp < left:
                previous.add(row)
            if not left <= stamp < right:
                continue
            total.add(row)
            aggregate, breakdown = buckets[bisect_right(bounds, stamp) - 1]
            aggregate.add(row)
            breakdown[row.provider].add(row)
            hours[local.weekday(), local.hour].add(row)
            providers[row.provider].add(row)
            models[row.provider][row.model].add(row)
            purposes[row.purpose].add(row)

        return UsageReport(
            start=start, end=end, previous_start=datetime.fromtimestamp(prev, zone), selectable_from=first,
            timezone=str(zone), price_version=PRICE_VERSION, price_sources=PRICE_SOURCES, bucket_unit=unit, totals=total.totals, previous=previous.totals,
            buckets=[UsageBucket(start=datetime.fromtimestamp(a, zone), end=datetime.fromtimestamp(b, zone),
                                 providers=_groups(breakdown), **aggregate.details())
                     for a, b, (aggregate, breakdown) in zip(bounds, bounds[1:], buckets)],
            providers=[group.model_copy(update={"models": _groups(models[group.key])}) for group in _groups(providers)],
            purposes=[UsageGroup(key=key, **purpose.totals.model_dump()) for key, purpose in purposes.items()],
            hours=[UsageHour(weekday=d, hour=h, deepseek_peak=deepseek_peak_at(datetime.combine(day, time(h, 30), zone)),
                             **hours[d, h].details())
                   for d in range(7) for day in (week_start + timedelta(days=d),) for h in range(24)],
            calendar=[UsageBucket(start=_midnight(day, zone), end=_midnight(day + timedelta(days=1), zone),
                                  **calendar[day].details())
                      for offset in range((calendar_last.date() - first.date()).days)
                      for day in (first.date() + timedelta(days=offset),)],
        )
