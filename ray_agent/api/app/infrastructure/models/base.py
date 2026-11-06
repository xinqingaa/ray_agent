#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""业务库 ORM 基类与列类型：时间以 UTC 保存并读回带时区的值，结构化内容是 JSON 文本列。"""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, TypeDecorator
from sqlalchemy.orm import DeclarativeBase


class UTCDateTime(TypeDecorator):
    """不带时区的输入按本机时间解释，统一换算为 UTC 保存；读回为 UTC 时区的 datetime。"""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


# 可空 JSON 列的 None 写成 SQL NULL，而不是 JSON 文本 null
NullableJSON = JSON(none_as_null=True)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: UTCDateTime}
