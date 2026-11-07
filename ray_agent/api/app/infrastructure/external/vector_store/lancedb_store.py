"""按工作区与 Embedding 配置隔离的 LanceDB Embedded 向量表。

路径：`<data_root>/indexes/lancedb/<workspace_id>/<embedding_config>/chunks`
写入带 generation；查询固定表版本，不读中途最新表头。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np
import pyarrow as pa

from app.domain.models.semantic_index import EMBEDDING_CONFIG_FINGERPRINT, EMBEDDING_DIM

logger = logging.getLogger(__name__)

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
        self.db_path.mkdir(parents=True, exist_ok=True)
        self._db = None
        self._table = None

    def _connect(self):
        if self._db is None:
            import lancedb
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
        try:
            listing = db.list_tables()
            names = set(getattr(listing, "tables", None) or list(listing))
        except Exception:  # noqa: BLE001 — 旧版 API
            names = set(db.table_names())
        if TABLE_NAME in names:
            self._table = db.open_table(TABLE_NAME)
        else:
            empty = pa.Table.from_pylist([], schema=self._schema())
            self._table = db.create_table(TABLE_NAME, data=empty, mode="overwrite")
        return self._table

    def table_version(self) -> int:
        table = self.open_or_create()
        # Lance 表版本：最新已提交版本号
        try:
            return int(table.version)
        except Exception:  # noqa: BLE001
            return 0

    def open_at_version(self, version: Optional[int]):
        table = self.open_or_create()
        if version is None:
            return table
        try:
            return table.checkout(version) if hasattr(table, "checkout") else table
        except Exception as error:  # noqa: BLE001
            logger.warning("LanceDB checkout(%s) 失败，回退最新: %s", version, error)
            return table

    def upsert_rows(self, rows: Sequence[dict[str, Any]]) -> int:
        """按 chunk_id 覆盖写入；返回写入后表版本。"""
        table = self.open_or_create()
        if not rows:
            return self.table_version()
        ids = [row["chunk_id"] for row in rows]
        # 先删旧再追加，避免重复
        try:
            if ids:
                # filter 字符串需转义单引号
                quoted = ", ".join("'" + cid.replace("'", "''") + "'" for cid in ids)
                table.delete(f"chunk_id IN ({quoted})")
        except Exception as error:  # noqa: BLE001
            logger.info("LanceDB 删除旧行跳过: %s", error)
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
        table.add(payload)
        return self.table_version()

    def delete_chunk_ids(self, chunk_ids: Sequence[str]) -> int:
        table = self.open_or_create()
        if not chunk_ids:
            return self.table_version()
        quoted = ", ".join("'" + cid.replace("'", "''") + "'" for cid in chunk_ids)
        try:
            table.delete(f"chunk_id IN ({quoted})")
        except Exception as error:  # noqa: BLE001
            logger.info("LanceDB 删除失败: %s", error)
        return self.table_version()

    def replace_generation(self, generation: int, rows: Sequence[dict[str, Any]]) -> int:
        """以完整快照对齐某代次：清空后写入，避免旧向量冒充当前事实。"""
        table = self.open_or_create()
        try:
            # 删掉全部行后重建
            table.delete("generation >= 0")
        except Exception:  # noqa: BLE001
            # 空表或语法差异：覆盖建表
            db = self._connect()
            empty = pa.Table.from_pylist([], schema=self._schema())
            self._table = db.create_table(TABLE_NAME, data=empty, mode="overwrite")
            table = self._table
        if rows:
            for row in rows:
                row = dict(row)
                row["generation"] = generation
            return self.upsert_rows(rows)
        return self.table_version()

    def search(
            self, query_vector: np.ndarray, *, limit: int, version: Optional[int] = None,
            allowed_chunk_ids: Optional[set[str]] = None,
    ) -> list[dict[str, Any]]:
        table = self.open_at_version(version)
        vector = query_vector.astype(np.float32).tolist()
        try:
            results = table.search(vector).limit(max(limit * 3, limit)).to_list()
        except Exception as error:  # noqa: BLE001
            logger.warning("LanceDB 查询失败: %s", error)
            return []
        hits = []
        for item in results:
            chunk_id = item.get("chunk_id")
            if allowed_chunk_ids is not None and chunk_id not in allowed_chunk_ids:
                continue
            hits.append(item)
            if len(hits) >= limit:
                break
        return hits

    def drop(self) -> None:
        """配置变更时丢弃本索引空间目录。"""
        import shutil
        self._table = None
        self._db = None
        if self.db_path.exists():
            shutil.rmtree(self.db_path, ignore_errors=True)
