"""在模型请求返回或失败时记录一次，不改变上游请求的重试语义。"""
import asyncio
import logging
from datetime import datetime

from app.domain.models.llm import LLMUsage
from app.domain.models.usage import UsageCharge, usage_context

logger = logging.getLogger(__name__)


async def record_usage(
    started_at: datetime, provider: str, model: str, *, failed: bool = False,
    usage: LLMUsage | None = None, charge: UsageCharge | None = None, audio_duration_ms: int | None = None,
) -> None:
    from app.infrastructure.storage.sqlite import get_database, get_uow
    try:
        get_database()
    except RuntimeError:
        return  # 单独构造的模型客户端没有业务库

    scope = usage_context.get()

    async def write():
        async with get_uow() as uow:
            await uow.usage.add(
                started_at=started_at, session_id=scope.session_id, run_id=scope.run_id,
                workspace_id=scope.workspace_id, purpose=scope.purpose, provider=provider, model=model, failed=failed,
                input_tokens=usage.prompt_tokens if usage else None,
                cached_tokens=usage.cached_tokens if usage else None,
                cache_write_tokens=usage.cache_write_tokens if usage else None,
                output_tokens=usage.completion_tokens if usage else None,
                total_tokens=usage.resolved_total if usage and usage.available else None,
                reasoning_tokens=usage.reasoning_tokens if usage else None,
                audio_duration_ms=audio_duration_ms, **(charge or UsageCharge()).model_dump(),
            )

    task = asyncio.create_task(write())
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        except Exception:
            logger.exception("取消模型请求时写入用量失败")
        raise
    except Exception:
        logger.exception("写入模型用量失败")
