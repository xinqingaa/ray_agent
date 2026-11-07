"""应用层中文分词与英文规范化：入库与查询共用；不依赖 SQLite 默认中文分词。"""
from __future__ import annotations

import re
import threading
from functools import lru_cache

_CJK = re.compile(r"[\u4e00-\u9fff]")
_TOKEN = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]+")
_jieba = None
_jieba_lock = threading.Lock()


def _ensure_jieba():
    global _jieba
    if _jieba is not None:
        return _jieba
    with _jieba_lock:
        if _jieba is None:
            import jieba
            jieba.setLogLevel(20)
            # 预热一次，避免首词延迟落在请求路径上
            list(jieba.cut_for_search("初始化"))
            _jieba = jieba
    return _jieba


def tokenize(text: str) -> str:
    """把正文切成空格分隔的检索词；英文小写，中文用 jieba 搜索模式。"""
    if not text or not text.strip():
        return ""
    parts: list[str] = []
    for match in _TOKEN.finditer(text):
        token = match.group(0)
        if _CJK.search(token):
            jieba = _ensure_jieba()
            parts.extend(t.strip() for t in jieba.cut_for_search(token) if t.strip())
        else:
            parts.append(token.lower())
    # 去重但保序，避免 FTS 词袋膨胀
    seen: set[str] = set()
    ordered: list[str] = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            ordered.append(part)
    return " ".join(ordered)


@lru_cache(maxsize=256)
def tokenize_cached(text: str) -> str:
    return tokenize(text)


ANY_TERM_LIMIT = 24  # 任一词命中模式下最多取的检索词数


def fts_match_query(text: str, *, any_term: bool = False) -> str:
    """把用户查询转成 FTS5 MATCH 表达式；空结果返回空串表示不应检索。

    默认所有词都要命中；any_term 用于长问句的初始召回：丢弃单字符词（多为虚词），任一词命中即可。
    """
    tokens = tokenize(text).split()
    if any_term:
        tokens = [token for token in tokens if len(token) > 1][:ANY_TERM_LIMIT]
    if not tokens:
        return ""
    # 对含特殊字符的词加引号
    escaped = []
    for token in tokens:
        safe = token.replace('"', '""')
        escaped.append(f'"{safe}"')
    return (" OR " if any_term else " AND ").join(escaped)
