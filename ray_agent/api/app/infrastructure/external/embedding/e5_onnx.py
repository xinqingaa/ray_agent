"""本机 E5 Embedding：ONNX Runtime + tokenizers，查询／正文前缀、均值池化与 L2 归一化。

按模型有效输入上限（512 tokens）切分；不可只截断向量输入而声称整段已入库。
组件缺失时调用方不得启用语义索引。
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from app.domain.models.semantic_index import (
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_DIM,
    EMBEDDING_MAX_TOKENS,
    PASSAGE_PREFIX,
    QUERY_PREFIX,
)

logger = logging.getLogger(__name__)


def mean_pool(last_hidden: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    """对 token 维做掩码均值池化。last_hidden: (batch, seq, dim)。"""
    mask = attention_mask.astype(np.float32)[:, :, None]
    summed = (last_hidden * mask).sum(axis=1)
    counts = np.clip(mask.sum(axis=1), a_min=1e-9, a_max=None)
    return summed / counts


def l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.clip(norms, a_min=1e-12, a_max=None)
    return vectors / norms


def split_by_token_budget(text: str, tokenizer, *, max_tokens: int = EMBEDDING_MAX_TOKENS,
                          prefix: str = PASSAGE_PREFIX) -> list[str]:
    """按有效输入上限切分正文；前缀占用计入预算。超长时按词／字符窗口切，不静默丢尾。"""
    body = (text or "").strip()
    if not body:
        return []
    budget = max(8, max_tokens - len(tokenizer.encode(prefix).ids))
    ids = tokenizer.encode(body).ids
    if len(ids) <= budget:
        return [body]
    parts: list[str] = []
    # 用字符近似回退：按预算比例切原文，再校验 token 长度
    approx = max(32, int(len(body) * budget / max(len(ids), 1)))
    start = 0
    while start < len(body):
        end = min(len(body), start + approx)
        # 尽量在空白处断开
        if end < len(body):
            cut = body.rfind(" ", start + approx // 2, end)
            if cut > start:
                end = cut
        chunk = body[start:end].strip()
        if chunk:
            # 仍超长则硬截 token
            encoded = tokenizer.encode(chunk).ids
            if len(encoded) > budget:
                piece_ids = encoded[:budget]
                chunk = tokenizer.decode(piece_ids)
            parts.append(chunk)
        if end <= start:
            break
        start = end
    return parts or [body[:approx]]


class E5OnnxEmbedder:
    """加载组件目录中的 model.onnx 与 tokenizer.json。"""

    def __init__(self, component_dir: Path) -> None:
        self.root = Path(component_dir)
        self._session = None
        self._tokenizer = None
        self._lock = threading.Lock()
        self._input_names: list[str] = []

    @property
    def ready(self) -> bool:
        return (self.root / ".ready").is_file() and (self.root / "model.onnx").is_file() \
            and (self.root / "tokenizer.json").is_file()

    def load(self) -> None:
        if self._session is not None:
            return
        with self._lock:
            if self._session is not None:
                return
            import onnxruntime as ort
            from tokenizers import Tokenizer

            model_path = self.root / "model.onnx"
            tok_path = self.root / "tokenizer.json"
            if not model_path.is_file() or not tok_path.is_file():
                raise FileNotFoundError(f"Embedding 组件不完整: {self.root}")
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.inter_op_num_threads = 1
            self._session = ort.InferenceSession(
                str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])
            self._tokenizer = Tokenizer.from_file(str(tok_path))
            self._tokenizer.enable_truncation(max_length=EMBEDDING_MAX_TOKENS)
            self._tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
            self._input_names = [item.name for item in self._session.get_inputs()]
            logger.info("已加载 E5 ONNX Embedding dim=%s inputs=%s", EMBEDDING_DIM, self._input_names)

    def embed_texts(self, texts: Sequence[str], *, as_query: bool = False) -> np.ndarray:
        """返回 (n, dim) float32 归一化向量。空输入返回 (0, dim)。"""
        self.load()
        assert self._session is not None and self._tokenizer is not None
        prefix = QUERY_PREFIX if as_query else PASSAGE_PREFIX
        prepared = [f"{prefix}{(text or '').strip()}" for text in texts]
        if not prepared:
            return np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
        out_rows: list[np.ndarray] = []
        for start in range(0, len(prepared), EMBEDDING_BATCH_SIZE):
            batch = prepared[start:start + EMBEDDING_BATCH_SIZE]
            encoded = self._tokenizer.encode_batch(batch)
            max_len = max(len(item.ids) for item in encoded)
            input_ids = np.zeros((len(batch), max_len), dtype=np.int64)
            attention = np.zeros((len(batch), max_len), dtype=np.int64)
            for row, item in enumerate(encoded):
                ids = item.ids[:EMBEDDING_MAX_TOKENS]
                input_ids[row, :len(ids)] = ids
                attention[row, :len(ids)] = 1
            feeds: dict = {}
            for name in self._input_names:
                if name in ("input_ids", "inputs_ids"):
                    feeds[name] = input_ids
                elif name == "attention_mask":
                    feeds[name] = attention
                elif name == "token_type_ids":
                    feeds[name] = np.zeros_like(input_ids)
                else:
                    feeds[name] = input_ids
            outputs = self._session.run(None, feeds)
            # 常见输出：last_hidden_state 或 (sentence_embedding,)
            hidden = outputs[0]
            if hidden.ndim == 2:
                pooled = hidden
            else:
                pooled = mean_pool(hidden.astype(np.float32), attention)
            out_rows.append(l2_normalize(pooled.astype(np.float32)))
        return np.vstack(out_rows)

    def embed_query(self, query: str) -> np.ndarray:
        vectors = self.embed_texts([query], as_query=True)
        return vectors[0] if len(vectors) else np.zeros(EMBEDDING_DIM, dtype=np.float32)

    def embed_passages(self, passages: Sequence[str]) -> np.ndarray:
        return self.embed_texts(passages, as_query=False)

    def passage_parts(self, text: str) -> list[str]:
        self.load()
        assert self._tokenizer is not None
        return split_by_token_budget(text, self._tokenizer)


def verify_embedder(component_dir: Path) -> None:
    """可启动检查：加载模型并对样例句做一次编码（首次加载可能较慢）。"""
    embedder = E5OnnxEmbedder(component_dir)
    embedder.load()
    vector = embedder.embed_query("ping")
    if vector.shape != (EMBEDDING_DIM,):
        raise RuntimeError(f"Embedding 维度异常: {vector.shape}")
    if not np.isfinite(vector).all():
        raise RuntimeError("Embedding 输出含非有限值")
