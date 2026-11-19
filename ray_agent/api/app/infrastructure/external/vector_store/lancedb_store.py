"""按工作区与 Embedding 配置隔离的 LanceDB Embedded 向量表。

路径：`<data_root>/indexes/lancedb/<workspace_id>/<embedding_config>/chunks`
写入带 generation；查询固定表版本，不读中途最新表头。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np
import pyarrow as pa

from app.domain.models.semantic_index import EMBEDDING_CONFIG_FINGERPRINT, EMBEDDING_DIM

TABLE_NAME = "chunks"
_SAFE = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_segment(value: str) -> str:
    cleaned = _SAFE.sub("_", (value or "").strip()) or "default"
    return cleaned[:120]


class LanceChunkStore:
    """工作区向量表：chunk_id 主键，过滤 published generation。"""

    def __init__(self, indexes_root: Path, workspace_id: str,
                 embedding_config: str = EMBEDDING_CONFIG_FINGERPRINT) -> None:
        self.workspace_id = workspace_id
        self.embedding_config = embedding_config
        self.db_path = Path(indexes_root) / "lancedb" / safe_segment(workspace_id) / safe_segment(embedding_config)
        self._db = None
        self._table = None

    def _connect(self):
        if self._db is None:
            import lancedb
            self.db_path.mkdir(parents=True, exist_ok=True)
            self._db = lancedb.connect(str(self.db_path))
        return self._db

    def _schema(self) -> pa.Schema:
        return pa.schema([
            ("chunk_id", pa.string()),
            ("document_id", pa.string()),
            ("revision_id", pa.string()),
            ("revision", pa.int64()),
            ("generation", pa.int64()),
            ("text_hash", pa.string()),
            ("vector", pa.list_(pa.float32(), EMBEDDING_DIM)),
        ])

    def open_or_create(self):
        db = self._connect()
        names = set(db.list_tables().tables)
        if TABLE_NAME in names:
            self._table = db.open_table(TABLE_NAME)
        else:
            empty = pa.Table.from_pylist([], schema=self._schema())
            self._table = db.create_table(TABLE_NAME, data=empty)
        return self._table

    def table_version(self) -> int:
        table = self.open_or_create()
        return int(table.version)

    def open_at_version(self, version: Optional[int]):
        if version is None:
            return self.open_or_create()
        if not self.db_path.is_dir():
            raise FileNotFoundError("向量索引不存在")
        table = self._connect().open_table(TABLE_NAME)
        table.checkout(version)
        if int(table.version) != version:
            raise RuntimeError("向量表无法打开指定发布版本")
        return table

    def upsert_rows(self, rows: Sequence[dict[str, Any]]) -> int:
        """按 chunk_id 覆盖写入；返回写入后表版本。"""
        table = self.open_or_create()
        if not rows:
            return self.table_version()
        ids = [row["chunk_id"] for row in rows]
        quoted = ", ".join("'" + cid.replace("'", "''") + "'" for cid in ids)
        table.delete(f"chunk_id IN ({quoted})")
        return self.append_rows(table, rows)

    def append_rows(self, table, rows: Sequence[dict[str, Any]]) -> int:
        payload = []
        for row in rows:
            vector = row["vector"]
            if isinstance(vector, np.ndarray):
                vector = vector.astype(np.float32).tolist()
            payload.append({
                "chunk_id": row["chunk_id"],
                "document_id": row["document_id"],
                "revision_id": row["revision_id"],
                "revision": int(row["revision"]),
                "generation": int(row["generation"]),
                "text_hash": row["text_hash"],
                "vector": vector,
            })
        if payload:
            table.add(payload)
        return int(table.version)

    def delete_chunk_ids(self, chunk_ids: Sequence[str]) -> int:
        table = self.open_or_create()
        if not chunk_ids:
            return self.table_version()
        quoted = ", ".join("'" + cid.replace("'", "''") + "'" for cid in chunk_ids)
        table.delete(f"chunk_id IN ({quoted})")
        return int(table.version)

    def begin_rebuild(self):
        """清理写入表头，已发布历史版本仍可读。调用方串行化同一工作区的写入。"""
        table = self.open_or_create()
        table.delete("generation >= 0")
        return table

    def search(
            self, query_vector: np.ndarray, *, limit: int, version: Optional[int] = None,
            generation: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        table = self.open_at_version(version)
        vector = query_vector.astype(np.float32).tolist()
        query = table.search(vector)
        if generation is not None:
            query = query.where(f"generation = {int(generation)}", prefilter=True)
        return query.limit(limit).to_list()

    def drop(self) -> None:
        """配置变更时丢弃本索引空间目录。"""
        import shutil
        self._table = None
        self._db = None
        if self.db_path.exists():
            shutil.rmtree(self.db_path, ignore_errors=True)
