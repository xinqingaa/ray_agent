"""压缩组件：选择范围、请求摘要、生成替换后的消息与事件；循环内的自动压缩与会话的手动压缩共用。

自身不保存记忆、不写事件，由调用方持久化：循环先替换并保存记忆，再把事件交给运行器写入；
手动压缩把两条事件与替换后的记忆放在同一次账本写入里。最小收益判断由调用方决定是否启用（只在水位触发时启用）。
"""
import asyncio
import copy
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from app.domain.external.llm import LLM, is_retryable
from app.domain.models.app_config import AgentConfig
from app.domain.models.event import BaseEvent, CompactEvent, CompactUsage, ContextEvent, ContextOp, MessageEvent
from app.domain.services.context.budget import ContextBudget, ContextEstimate, estimate_message, estimate_text, \
    raw_parts
from app.domain.services.context.compaction import (
    MIN_GAIN_RATIO,
    match_events,
    plan_compaction,
    render_transcript,
    select_reinjection,
    summary_message,
    user_origins,
)
from app.domain.services.prompts.compact import COMPACT_PROMPT

logger = logging.getLogger(__name__)

Messages = List[Dict[str, Any]]
UserEventsLoader = Callable[[], Awaitable[Sequence[BaseEvent]]]

KEPT_WATERMARK_SHARE = 0.6  # 保留区（含系统提示词与工具 schema）不超过水位的这个比例，给摘要与用户原文留出空间


class CompactionStatus(str, Enum):
    COMPACTED = "compacted"
    SKIPPED = "skipped"
    FAILED = "failed"  # 摘要请求按 max_retries 重试后仍失败或返回空内容


class SkipReason:
    NO_ROUNDS = "no_rounds"  # 少于 2 轮，没有可摘要的完整轮次
    MIN_GAIN = "min_gain"  # 可摘要部分扣除重新注入的原文后不足可用上限的 MIN_GAIN_RATIO


@dataclass
class CompactionResult:
    status: CompactionStatus
    reason: Optional[str] = None  # SKIPPED 时为 SkipReason 取值
    usage: CompactUsage = field(default_factory=CompactUsage)  # 摘要请求的尝试次数与用量；跳过时为零
    messages: Messages = field(default_factory=list)  # COMPACTED：替换 system 之后全部消息的新序列
    compact: Optional[CompactEvent] = None
    context: Optional[ContextEvent] = None


def user_message_events(events: Sequence[BaseEvent]) -> List[Tuple[int, str]]:
    """会话里已写入的用户消息事件，(seq, 文本)，用来把重新注入的原文对应到事件。"""
    return [(e.seq, e.message) for e in events
            if isinstance(e, MessageEvent) and e.role == "user" and e.seq is not None]


def _add_optional(total: Optional[int], value: Optional[int]) -> Optional[int]:
    if value is None:
        return total
    return (total or 0) + value


class Compactor:

    def __init__(self, llm: LLM, agent_config: AgentConfig, retry_interval: float = 1.0, label: str = "") -> None:
        self._llm = llm
        self._config = agent_config
        self._retry_interval = retry_interval
        self._label = label

    def fresh_budget(self) -> ContextBudget:
        """只按字符估算的容量估算器（没有 usage 可校准），参数与循环的估算器相同。"""
        return ContextBudget(
            context_window=self._llm.context_window,
            max_tokens=self._llm.max_tokens,
            safety_ratio=self._config.context_safety_ratio,
            watermark_ratio=self._config.compact_watermark,
        )

    async def compact(
            self,
            messages: Messages,
            tools: List[Dict[str, Any]],
            before: ContextEstimate,
            trigger: str,
            load_user_events: UserEventsLoader,
            min_gain: bool,
    ) -> CompactionResult:
        """messages 是发给模型的完整消息（第一条为 system），tools 是请求携带的工具 schema，before 是压缩前的估算。

        把保留区之前的历史换成摘要并重新注入其中的用户原文；摘要失败时返回 FAILED，调用方不改记忆。
        替换后的估算按字符计算（记忆被替换后没有 usage 可校准）。
        """
        system = messages[:1]
        plan = plan_compaction(
            messages, self._config.compact_keep_turns,
            lambda kept: sum(raw_parts([*system, *kept], tools).values()) <= before.watermark * KEPT_WATERMARK_SHARE)
        if plan is None:
            logger.info(f"{self._label} 没有可摘要的完整轮次，跳过压缩")
            return CompactionResult(CompactionStatus.SKIPPED, reason=SkipReason.NO_ROUNDS)
        summarized, kept = messages[1:plan.boundary], messages[plan.boundary:]

        origins = user_origins(summarized)
        match_events(origins, user_message_events(await load_user_events()))
        reinjection = select_reinjection(origins, self._config.compact_user_chars)
        gain = (sum(estimate_message(m) for m in summarized)
                - sum(estimate_message(m) for m in reinjection.messages))
        if min_gain and gain < before.limit * MIN_GAIN_RATIO:
            # 可摘要的部分太小（例如最近一轮本身就很大），摘要换不回空间，只会多一次模型请求
            logger.info(f"{self._label} 可摘要部分约 {gain:.0f} tokens，低于最小收益，跳过压缩")
            return CompactionResult(CompactionStatus.SKIPPED, reason=SkipReason.MIN_GAIN)

        transcript = render_transcript(
            summarized, lambda text: estimate_text(COMPACT_PROMPT + text) + 16 <= before.limit)
        summary, usage = await self._request_summary(transcript)
        if not summary:
            return CompactionResult(CompactionStatus.FAILED, usage=usage)

        replaced = [summary_message(summary, plan.summarized_turns, reinjection.omitted),
                    *reinjection.messages, *copy.deepcopy(kept)]
        after = self.fresh_budget().estimate([*system, *replaced], tools)
        logger.info(f"{self._label} 压缩完成（{trigger}）：摘要 {plan.summarized_turns} 轮，保留 {plan.kept_turns} 轮，"
                    f"估算 {before.total} → {after.total} tokens")
        return CompactionResult(
            CompactionStatus.COMPACTED,
            usage=usage,
            messages=replaced,
            compact=CompactEvent(
                trigger=trigger,
                before_estimate=before.as_dict(),
                after_estimate=after.as_dict(),
                summarized_turns=plan.summarized_turns,
                kept_turns=plan.kept_turns,
                summary=summary,
                reinjected_event_seqs=reinjection.event_seqs,
                omitted_user_messages=reinjection.omitted,
                usage=usage,
            ),
            context=ContextEvent(op=ContextOp.REPLACE, messages=copy.deepcopy(replaced)),
        )

    async def _request_summary(self, transcript: str) -> Tuple[Optional[str], CompactUsage]:
        """独立的摘要请求（不带工具）；传输错误与空回复按 max_retries 重试。"""
        usage = CompactUsage()
        request = [{"role": "system", "content": COMPACT_PROMPT}, {"role": "user", "content": transcript}]
        while usage.attempts < self._config.max_retries:
            usage.attempts += 1
            try:
                result = await self._llm.invoke(messages=request)
            except Exception as e:
                logger.warning(f"{self._label} 摘要请求失败（第 {usage.attempts} 次）: {e}")
                if not is_retryable(e):
                    break
                await asyncio.sleep(self._retry_interval)
                continue
            if result.usage is not None:
                usage.prompt_tokens = _add_optional(usage.prompt_tokens, result.usage.prompt_tokens)
                usage.completion_tokens = _add_optional(usage.completion_tokens, result.usage.completion_tokens)
                usage.cached_tokens = _add_optional(usage.cached_tokens, result.usage.cached_tokens)
            summary = str((result.message or {}).get("content") or "").strip()
            if summary:
                return summary, usage
            logger.warning(f"{self._label} 摘要请求返回空内容（第 {usage.attempts} 次）")
            await asyncio.sleep(self._retry_interval)
        return None, usage
