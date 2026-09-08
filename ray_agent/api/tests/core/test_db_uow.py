#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""UoW 在取消时必须把连接还回池子，不能留给 GC terminate。"""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.infrastructure.repositories.db_uow import DBUnitOfWork


def _session_mock(*, commit_error=None, close_error=None):
    session = MagicMock()
    if commit_error is None:
        session.commit = AsyncMock()
    else:
        session.commit = AsyncMock(side_effect=commit_error)
    session.rollback = AsyncMock()
    if close_error is None:
        session.close = AsyncMock()
    else:
        session.close = AsyncMock(side_effect=close_error)
    session.in_transaction = MagicMock(return_value=False)
    return session


def test_uow_commits_and_closes_on_success():
    async def _run():
        session = _session_mock()
        uow = DBUnitOfWork(MagicMock(return_value=session))
        async with uow:
            pass
        session.commit.assert_awaited()
        session.close.assert_awaited()
        session.rollback.assert_not_awaited()

    asyncio.run(_run())


def test_uow_rollbacks_and_closes_on_body_error():
    async def _run():
        session = _session_mock()
        uow = DBUnitOfWork(MagicMock(return_value=session))
        with pytest.raises(RuntimeError, match="boom"):
            async with uow:
                raise RuntimeError("boom")
        session.rollback.assert_awaited()
        session.close.assert_awaited()
        session.commit.assert_not_awaited()

    asyncio.run(_run())


def test_cancelled_commit_closes_session_in_background():
    async def _run():
        session = _session_mock(commit_error=asyncio.CancelledError())
        uow = DBUnitOfWork(MagicMock(return_value=session))
        await uow.__aenter__()
        with pytest.raises(asyncio.CancelledError):
            await uow.__aexit__(None, None, None)
        await asyncio.sleep(0)
        session.close.assert_awaited()

    asyncio.run(_run())


def test_cancelled_close_retries_in_background():
    async def _run():
        session = _session_mock()
        session.close = AsyncMock(side_effect=[asyncio.CancelledError(), None])
        uow = DBUnitOfWork(MagicMock(return_value=session))
        await uow.__aenter__()
        with pytest.raises(asyncio.CancelledError):
            await uow.__aexit__(None, None, None)
        await asyncio.sleep(0)
        assert session.close.await_count == 2

    asyncio.run(_run())
