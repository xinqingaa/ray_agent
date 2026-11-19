"""本机 E5 Embedding：ONNX Runtime + tokenizers，查询／正文前缀、均值池化与 L2 归一化。

按模型有效输入上限（512 tokens）切分；不可只截断向量输入而声称整段已入库。
组件缺失时调用方不得启用语义索引。
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Sequence

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
    parts: list[str] = []

    def fits(piece: str) -> bool:
        return len(tokenizer.encode(prefix + piece.strip()).ids) <= max_tokens

    start = 0
    while start < len(body):
        # 在当前位置附近探测预算，长表不会为每段重复分词其余全文。
        high = min(start + max_tokens, len(body))
        end = start
        while fits(body[start:high]):
            end = high
            if high == len(body):
                break
            high = min(start + (high - start) * 2, len(body))
        low = end + 1
        while low <= high:
            middle = (low + high) // 2
            if fits(body[start:middle]):
                end = middle
                low = middle + 1
            else:
                high = middle - 1
        if end == start:
            raise ValueError("Embedding 输入预算不足以容纳前缀与正文")
        if end < len(body):
            boundary = max(body.rfind(separator, start + (end - start) // 2, end) for separator in ("\n", "\t", " "))
            if boundary > start and fits(body[start:boundary]):
                end = boundary
        parts.append(body[start:end])
        start = end
    return parts


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
            session = ort.InferenceSession(
                str(model_path), sess_options=opts, providers=["CPUExecutionProvider"])
            tokenizer = Tokenizer.from_file(str(tok_path))
            tokenizer.no_truncation()
            padding = tokenizer.padding or {"pad_id": 1, "pad_token": "<pad>"}
            tokenizer.enable_padding(pad_id=padding["pad_id"], pad_token=padding["pad_token"])
            self._input_names = [item.name for item in session.get_inputs()]
            self._tokenizer = tokenizer
            self._session = session
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
                if len(item.ids) > EMBEDDING_MAX_TOKENS:
                    raise ValueError("Embedding 输入超出模型预算")
                input_ids[row, :len(item.ids)] = item.ids
                attention[row, :len(item.ids)] = item.attention_mask
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
        self.load()
        parts = split_by_token_budget(query, self._tokenizer, prefix=QUERY_PREFIX)
        vectors = self.embed_texts(parts, as_query=True)
        return l2_normalize(vectors.mean(axis=0, keepdims=True))[0] if len(vectors) else np.zeros(EMBEDDING_DIM, dtype=np.float32)

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
