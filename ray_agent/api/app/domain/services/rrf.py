"""词法与向量结果按片段身份做 Reciprocal Rank Fusion。"""
from __future__ import annotations

from typing import Iterable, Sequence, TypeVar

from app.domain.models.semantic_index import RRF_K

T = TypeVar("T")


def rrf_fuse(
        ranked_lists: Sequence[Sequence[T]],
        *,
        key=lambda item: item,
        k: int = RRF_K,
        limit: int | None = None,
) -> list[tuple[T, float]]:
    """多路排名融合。key 提取稳定身份（如 chunk_id / source_id）。返回 (代表项, 分数) 按分数降序。"""
    scores: dict[object, float] = {}
    representatives: dict[object, T] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked, start=1):
            identity = key(item)
            scores[identity] = scores.get(identity, 0.0) + 1.0 / (k + rank)
            representatives.setdefault(identity, item)
    ordered = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    result = [(representatives[identity], score) for identity, score in ordered]
    if limit is not None:
        return result[:limit]
    return result


def rrf_fuse_hits(
        lexical: Iterable,
        vector: Iterable,
        *,
        k: int = RRF_K,
        limit: int,
) -> list:
    """专用于 SearchHit：按 (source_type, source_id) 融合，分数写入 hit.score。"""
    lex = list(lexical)
    vec = list(vector)

    def identity(hit):
        return (hit.source_type, hit.source_id)

    fused = rrf_fuse([lex, vec], key=identity, k=k, limit=limit)
    out = []
    for hit, score in fused:
        updated = hit.model_copy(update={"score": float(score)})
        out.append(updated)
    return out
