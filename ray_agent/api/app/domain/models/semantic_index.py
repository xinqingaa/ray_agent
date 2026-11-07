"""语义索引与混合召回的配置身份与限额。

Embedding 配置指纹变化时使用独立 LanceDB 索引空间，不与旧模型混查。
默认值同步参数页 docs/limits.md。
"""
from __future__ import annotations

# 本机默认：ONNX multilingual-e5-small；指纹参与路径隔离
EMBEDDING_CONFIG_FINGERPRINT = "e5-small-onnx-v1"
EMBEDDING_MODEL_ID = "intfloat/multilingual-e5-small"
EMBEDDING_DIM = 384
EMBEDDING_MAX_TOKENS = 512
EMBEDDING_BATCH_SIZE = 8

# RRF：按片段身份融合词法与向量排名；k 越大越平滑
RRF_K = 60
VECTOR_SEARCH_LIMIT = 40
SEMANTIC_INDEX_CHUNK_BATCH = 32

# 组件身份（与 component_manifest.json 一致）
EMBEDDING_COMPONENT_ID = "embedding-e5"
OCR_COMPONENT_ID = "ocr"

QUERY_PREFIX = "query: "
PASSAGE_PREFIX = "passage: "
