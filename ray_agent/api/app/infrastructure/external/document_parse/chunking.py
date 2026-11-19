"""结构块切分为检索片段：保留页／块／行列锚点；表格带表头按行组切。"""
import csv
import hashlib
import io
from typing import Any
from uuid import uuid4

from app.domain.models.document_knowledge import (
    CHUNK_CONFIG_FINGERPRINT,
    DOCUMENT_CHUNK_CHARS,
    DOCUMENT_CHUNK_OVERLAP,
    DOCUMENT_TABLE_ROWS_PER_CHUNK,
    ContentBlock,
    DocumentChunk,
)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _column(number: int) -> str:
    name = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        name = chr(65 + remainder) + name
    return name or "A"


def _split_text(text: str, size: int = DOCUMENT_CHUNK_CHARS, overlap: int = DOCUMENT_CHUNK_OVERLAP) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    parts: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            # 尽量在换行或空格处断开
            window = text[start:end]
            break_at = max(window.rfind("\n"), window.rfind(" "))
            if break_at > size // 3:
                end = start + break_at + 1
        parts.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [p for p in parts if p]


def chunk_blocks(
        blocks: list[ContentBlock], *, document_id: str, revision_id: str, workspace_id: str, revision: int,
        title: str = "",
) -> list[DocumentChunk]:
    """将解析结构块切成片段；chunk_config 指纹写入调用方的修订记录。"""
    _ = CHUNK_CONFIG_FINGERPRINT
    chunks: list[DocumentChunk] = []
    ordinal = 0
    for block in blocks:
        if block.kind == "table":
            numbers = block.locator.get("rows")
            if numbers:
                rows = list(csv.reader(io.StringIO(block.text), delimiter="\t"))
                for start in range(0, len(rows), DOCUMENT_TABLE_ROWS_PER_CHUNK):
                    values = rows[start:start + DOCUMENT_TABLE_ROWS_PER_CHUNK]
                    row_numbers = numbers[start:start + len(values)]
                    occupied = {column for row in values for column, value in enumerate(row) if value.strip()}
                    if not occupied:
                        continue
                    left, right = min(occupied), max(occupied)
                    first_column, last_column = _column(left + 1), _column(right + 1)
                    locator = {**block.locator, "rows": ([numbers[0]] if start else []) + row_numbers,
                               "column_start": left + 1, "block_ordinal": block.ordinal,
                               "cell_range": f"{first_column}{row_numbers[0]}:{last_column}{row_numbers[-1]}"}
                    buffer = io.StringIO(newline="")
                    visible = ([rows[0]] if start else []) + values
                    csv.writer(buffer, delimiter="\t", lineterminator="\n").writerows(row[left:right + 1] for row in visible)
                    body = buffer.getvalue()
                    chunks.append(DocumentChunk(
                        id=str(uuid4()), revision_id=revision_id, document_id=document_id,
                        workspace_id=workspace_id, revision=revision, ordinal=ordinal, title=title,
                        body=body, text_hash=_hash(body), locator=locator,
                    ))
                    ordinal += 1
                continue
            header = (block.locator or {}).get("header") or ""
            rows = block.text.splitlines()
            if header and rows and rows[0] == header:
                body_rows = rows[1:]
            else:
                body_rows = rows
            step = DOCUMENT_TABLE_ROWS_PER_CHUNK
            for start in range(0, max(len(body_rows), 1), step):
                group = body_rows[start:start + step]
                body = "\n".join(([header] if header else []) + group).strip()
                if not body:
                    continue
                locator = dict(block.locator or {})
                locator.update({"row_start": start, "row_end": start + len(group) - 1, "block_ordinal": block.ordinal})
                chunks.append(DocumentChunk(
                    id=str(uuid4()), revision_id=revision_id, document_id=document_id,
                    workspace_id=workspace_id, revision=revision, ordinal=ordinal,
                    title=title or locator.get("sheet") or "表格", body=body, text_hash=_hash(body),
                    locator=locator, published=False,
                ))
                ordinal += 1
            continue
        for part in _split_text(block.text):
            locator = dict(block.locator or {})
            locator["block_ordinal"] = block.ordinal
            chunks.append(DocumentChunk(
                id=str(uuid4()), revision_id=revision_id, document_id=document_id,
                workspace_id=workspace_id, revision=revision, ordinal=ordinal,
                title=title or str(locator.get("heading") or locator.get("page") or ""),
                body=part, text_hash=_hash(part), locator=locator, published=False,
            ))
            ordinal += 1
    return chunks


def blocks_from_worker(payload: dict[str, Any], *, revision_id: str, workspace_id: str) -> list[ContentBlock]:
    """解析 worker 输出的 blocks 列表转为领域对象。"""
    result: list[ContentBlock] = []
    for index, item in enumerate(payload.get("blocks") or []):
        result.append(ContentBlock(
            id=str(uuid4()), revision_id=revision_id, workspace_id=workspace_id, ordinal=index,
            kind=str(item.get("kind") or "text"), text=str(item.get("text") or ""),
            locator=dict(item.get("locator") or {}),
        ))
    return result
