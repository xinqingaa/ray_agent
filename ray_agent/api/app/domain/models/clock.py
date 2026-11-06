"""业务时间一律带时区的 UTC；落库与接口都以 UTC 表达。"""
from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
