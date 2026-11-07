"""记忆规则：内容身份、常驻层选择、提炼决策的生效规则。纯函数，不访问存储与模型。"""
import hashlib
import json
import re
from enum import StrEnum
from typing import Any, Optional, Sequence

from pydantic import BaseModel, Field

from app.domain.models.workspace_memory import (
    MEMORY_CONTENT_MAX_CHARS,
    MEMORY_TYPE_RANK,
    RESIDENT_MEMORY_LIMIT,
    MemoryCertainty,
    MemoryEntry,
    MemoryOrigin,
    MemoryStatus,
    MemoryType,
)

_PUNCT = re.compile(r"[\s\u3000，。！？、；：,.!?;:\"'“”‘’（）()\[\]【】]+")


def normalize_content(text: str) -> str:
    """去掉空白与标点并小写：同一句话的格式差异不产生两条记忆，也不绕过抑制。"""
    return _PUNCT.sub("", (text or "").lower())


def content_fingerprint(text: str) -> str:
    """内容身份：归一化后的 SHA-256 十六进制摘要（64 位，对应抑制表的指纹列）。"""
    return hashlib.sha256(normalize_content(text).encode("utf-8")).hexdigest()


def select_resident(entries: Sequence[MemoryEntry], limit: int = RESIDENT_MEMORY_LIMIT) -> list[MemoryEntry]:
    """常驻层：只取活动条目；钉住的先，其次按类型（约束、偏好、决定先于事实），再按最近使用或更新。"""
    active = [entry for entry in entries if entry.status is MemoryStatus.ACTIVE]

    def recency(entry: MemoryEntry) -> float:
        return (entry.last_used_at or entry.updated_at).timestamp()

    ordered = sorted(active, key=lambda e: (0 if e.pinned else 1, MEMORY_TYPE_RANK[e.memory_type], -recency(e), e.id))
    return ordered[:max(0, limit)]


class ExtractionAction(StrEnum):
    ADD = "add"
    UPDATE = "update"
    DELETE = "delete"
    NONE = "none"


class ExtractionDecision(BaseModel):
    """模型对一条候选事实的判定。update／delete 必须指明目标条目，并携带判定时看到的目标版本。"""
    action: ExtractionAction
    content: str = Field(default="", max_length=MEMORY_CONTENT_MAX_CHARS)
    memory_type: MemoryType = MemoryType.FACT
    target_id: Optional[str] = None
    target_version: Optional[int] = None
    reason: str = ""


def can_change_directly(target: Optional[MemoryEntry]) -> bool:
    """按 D4：自动提炼只能直接更新或删除“自动提炼产生且未经用户确认”的活动条目。"""
    return (target is not None and target.status is MemoryStatus.ACTIVE
            and target.origin is MemoryOrigin.AUTO_EXTRACTION
            and target.certainty is not MemoryCertainty.USER_CONFIRMED)


def parse_decisions(text: str) -> list[dict[str, Any]]:
    """从模型输出里取 JSON 数组；容忍代码围栏与前后说明。解析不出时抛出 ValueError。"""
    raw = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
    if fenced:
        raw = fenced.group(1).strip()
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end < start:
        object_start, object_end = raw.find("{"), raw.rfind("}")
        if object_start < 0 or object_end < object_start:
            raise ValueError("模型没有返回 JSON")
        value: Any = json.loads(raw[object_start:object_end + 1])
    else:
        value = json.loads(raw[start:end + 1])
    if isinstance(value, dict):
        value = value.get("items") or value.get("facts") or value.get("decisions") or [value]
    if not isinstance(value, list):
        raise ValueError("模型返回的 JSON 不是数组")
    return [item for item in value if isinstance(item, dict)]
