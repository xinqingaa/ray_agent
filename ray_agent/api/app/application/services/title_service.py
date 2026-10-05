"""Session title generation and edits, separate from Agent run accounting."""
import asyncio
import logging
import re
import unicodedata
from typing import Callable

from app.application.errors.exceptions import BadRequestError, NotFoundError
from app.domain.models.event import TitleEvent
from app.domain.repositories.uow import IUnitOfWork
from app.domain.services.run_ledger import RunLedger
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.repositories.file_app_config_repository import FileAppConfigRepository
from core.config import get_settings

logger = logging.getLogger(__name__)


class _StaleTitle(Exception):
    pass


def clean_title(value: str) -> str:
    title = re.sub(r"\s+", " ", value).strip().strip('"“”‘’`')
    if not title or len(title) > 255 or any(unicodedata.category(char).startswith('C') for char in title):
        raise BadRequestError("标题必须为 1 到 255 个可见字符")
    return title


def generated_title(value: str) -> str:
    """Keep model output compact even when it ignores the requested length."""
    first_line = value.splitlines()[0] if value.splitlines() else ""
    title = clean_title(re.sub(r"^(?:title|标题)\s*[:：]\s*", "", first_line, flags=re.I))
    words = title.split()
    if len(words) > 6:
        title = " ".join(words[:6])
    width = 0
    output = []
    for char in title:
        char_width = 2 if unicodedata.east_asian_width(char) in "WF" else 1
        if width + char_width > 30:
            break
        output.append(char)
        width += char_width
    return clean_title("".join(output).rstrip(" ,.;:!?，。；：！？"))


class TitleService:
    def __init__(self, uow_factory: Callable[[], IUnitOfWork], ledger: RunLedger) -> None:
        self._uow_factory = uow_factory
        self._ledger = ledger

    async def _session(self, session_id: str):
        async with self._uow_factory() as uow:
            session = await uow.session.get_by_id(session_id)
        if session is None:
            raise NotFoundError("该会话不存在")
        return session

    async def suggest(self, session_id: str, source: str | None = None) -> str:
        session = await self._session(session_id)
        if source is None:
            async with self._uow_factory() as uow:
                messages = await uow.event.list(session_id, types=["message"], limit=8)
            first = next((event.message for event in messages if getattr(event, "role", None) == "user"), "")
            material = (first or session.latest_message) if first == session.latest_message or not first else (
                f"Initial task: {first}\nLatest user message: {session.latest_message}"
            )
        else:
            material = source
        material = material.strip()[:2000]
        if not material:
            raise BadRequestError("会话还没有消息")
        from app.domain.models.model_catalog import auxiliary_call
        config = FileAppConfigRepository(get_settings().app_config_filepath).load().llm_config
        short_config, thinking, effort = auxiliary_call(
            config, max_tokens=256, temperature=0.2, timeout=20)
        prompt = (
            "You create sidebar titles for task conversations. Return ONLY a short noun phrase naming the task. "
            "Do not perform, answer, explain, or restate the task. Use the same language as the user. "
            "Keep it within 10–15 CJK characters or 3–6 Latin words. "
            "Examples: 'Explain what a byte is' -> 'What a byte is'; "
            "'请统计 CSV 并交付文件' -> 'CSV 统计与文件交付'; "
            "'Écris un résumé du rapport' -> 'Résumé du rapport'. "
            "Output only the title, with no prefix, quotes, or final punctuation."
        )
        result = await asyncio.wait_for(OpenAILLM(
            short_config, thinking=thinking, reasoning_effort=effort, reasoning_id="disabled" if thinking else None,
        ).invoke([
            {"role": "system", "content": prompt}, {"role": "user", "content": material},
        ]), timeout=23)
        if result.finish_reason == "length":
            raise BadRequestError("标题生成未完成，请重试")
        return generated_title(str(result.message.get("content") or ""))

    async def set_title(self, session_id: str, title: str, source: str = "manual", expected: str | None = None) -> str:
        await self._session(session_id)
        title = clean_title(title)
        event = TitleEvent(title=title)

        async def apply(uow: IUnitOfWork) -> None:
            if not await uow.session.set_title(session_id, title, source, expected):
                raise _StaleTitle()

        try:
            await self._ledger.append(session_id, [event], apply=apply)
        except _StaleTitle:
            if source == "manual":
                raise NotFoundError("该会话不存在")
            return ""
        return title

    async def auto_generate(self, session_id: str, first_message: str) -> None:
        try:
            title = await self.suggest(session_id, first_message)
            await self.set_title(session_id, title, source="auto", expected="provisional")
        except Exception:
            logger.exception("会话[%s]自动生成标题失败；保留临时标题", session_id)
