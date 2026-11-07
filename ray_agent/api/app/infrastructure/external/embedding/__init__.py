"""本机 Embedding 端口。"""
from app.infrastructure.external.embedding.e5_onnx import E5OnnxEmbedder, verify_embedder

__all__ = ["E5OnnxEmbedder", "verify_embedder"]
