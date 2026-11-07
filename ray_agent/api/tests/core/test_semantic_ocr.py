"""P7：语义组件缺失时 FTS 照常；OCR／Embedding 安装后可检索；旧向量不冒充当前原文。"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app.application.services.capability_service import CapabilityService
from app.application.services.document_index_service import DocumentIndexService
from app.application.services.retrieval_service import RetrievalService
from app.application.services.semantic_index_service import SemanticIndexService
from app.domain.models.capability import Capability, CapabilityState, UnavailableReason
from app.domain.models.retrieval import SearchSourceType
from app.domain.models.semantic_index import EMBEDDING_DIM, OCR_COMPONENT_ID
from app.infrastructure.external.components.local_components import LocalRuntimeComponents
from app.infrastructure.external.document_parse.worker import parse as parse_file
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from core.paths import DataRoot
from tests.core.test_workspaces import Env, scenario
from tests.support.memory_env import JobStub


def _write(root: Path, relative: str, content: str | bytes) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    return path


def _bindings(record):
    from app.domain.external.workspace_files import RootBinding
    from app.domain.models.identity import RootKind

    async def resolve(_rooted):
        return RootBinding(
            root_id=record.ref.root_id, kind=RootKind.WORKSPACE_FOLDER, path=record.location,
            dev=record.dev, ino=record.ino,
        )
    return resolve


class FakeEmbedder:
    root = Path("/tmp/fake-e5")

    def passage_parts(self, text: str) -> list[str]:
        body = (text or "").strip()
        return [body] if body else []

    def embed_query(self, query: str) -> np.ndarray:
        return self.embed_passages([query])[0]

    def embed_passages(self, passages) -> np.ndarray:
        rows = []
        for text in passages:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            raw = np.frombuffer((digest * ((EMBEDDING_DIM * 4) // len(digest) + 1))[:EMBEDDING_DIM * 4],
                                dtype=np.uint8).astype(np.float32)
            vec = raw.reshape(-1)[:EMBEDDING_DIM]
            vec = vec / (np.linalg.norm(vec) + 1e-9)
            rows.append(vec)
        return np.vstack(rows)


def _install_ocr(components_root: Path) -> Path:
    """从 rapidocr 包复制模型到组件目录并标记就绪（跳过引擎冷启动）。"""
    import rapidocr_onnxruntime
    pkg = Path(rapidocr_onnxruntime.__file__).parent / "models"
    target = components_root / OCR_COMPONENT_ID
    target.mkdir(parents=True, exist_ok=True)
    mapping = {
        "det.onnx": "ch_PP-OCRv4_det_infer.onnx",
        "rec.onnx": "ch_PP-OCRv4_rec_infer.onnx",
        "cls.onnx": "ch_ppocr_mobile_v2.0_cls_infer.onnx",
    }
    for dest, src in mapping.items():
        shutil.copyfile(pkg / src, target / dest)
    (target / ".ready").write_text("test\n", encoding="utf-8")
    return target


def test_capability_without_semantic_components():
    async def run():
        current = await CapabilityService().current()
        by_name = {item.capability: item for item in current}
        assert by_name[Capability.FULL_TEXT_SEARCH].state is CapabilityState.AVAILABLE
        assert by_name[Capability.SEMANTIC_INDEX].reason is UnavailableReason.COMPONENT_MISSING
        assert by_name[Capability.OCR].reason is UnavailableReason.COMPONENT_MISSING

    asyncio.run(run())


def test_image_pending_ocr_without_component(tmp_path):
    png = _write(tmp_path, "scan.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    pending = parse_file(str(png), "image")
    assert pending["status"] == "pending_component" and pending.get("component_needed") == "ocr"


def test_ocr_component_parses_image(tmp_path):
    from PIL import Image, ImageDraw, ImageFont
    ocr_dir = _install_ocr(tmp_path / "components")
    image_path = tmp_path / "hello.png"
    image = Image.new("RGB", (400, 80), color=(255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.text((20, 20), "HelloOCR", fill=(0, 0, 0))
    image.save(image_path)
    import os
    os.environ["RAYAGENT_OCR_COMPONENT"] = str(ocr_dir)
    try:
        result = parse_file(str(image_path), "image")
    finally:
        os.environ.pop("RAYAGENT_OCR_COMPONENT", None)
    assert result["status"] == "ok"
    text = " ".join(block["text"] for block in result["blocks"])
    # OCR 对合成字可能不完全精确，至少应产出非空文本块
    assert result["blocks"] and len(text.strip()) >= 2


def test_fts_works_without_semantic_and_rrf_with_fake_embedder(tmp_path, monkeypatch):
    async def body(env: Env):
        created = await env.service.create("语义工作区")
        folder = Path(created.folder.location)
        wid = created.workspace.id
        _write(folder, "notes/alpha.md", "工作区里的紫色企鹅会跳舞。\n")
        _write(folder, "notes/beta.md", "完全无关的厨房菜谱。\n")

        async with env.read_factory() as uow:
            record = await uow.root.workspace_folder(wid)
        from app.domain.external.workspace_files import FileLimits
        files = PosixWorkspaceFiles(_bindings(record), FileLimits())
        retrieval = RetrievalService(env.uow_factory, env.read_factory)
        indexes = DataRoot(tmp_path / "data").indexes
        indexes.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv("RAYAGENT_DATA_ROOT", str(tmp_path / "data"))
        # 测试 Env 已有 data root；覆盖 semantic 用的 indexes 路径
        semantic = SemanticIndexService(env.uow_factory, env.read_factory)
        semantic._embedder = FakeEmbedder()  # noqa: SLF001

        async def always_yes():
            return True

        semantic.embedding_available = always_yes  # type: ignore[method-assign]
        original_indexes = semantic._indexes_root
        semantic._indexes_root = lambda: indexes  # type: ignore[method-assign]
        retrieval.bind_semantic(semantic)

        docs = DocumentIndexService(
            env.uow_factory, env.read_factory, env.folders, files, retrieval, semantic=semantic)
        sync = await docs.sync_workspace(wid)
        assert sync["pending_parse"] >= 1
        await docs.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync["operation_id"], payload={"workspace_id": wid},
            progress=None, generation=1)))

        # 无向量时全文仍可用
        hits = await retrieval.search(wid, "紫色企鹅", [SearchSourceType.DOCUMENT_CHUNK])
        assert hits and "紫色企鹅" in hits[0].snippet
        source = await docs.get_chunk_source(wid, hits[0].source_id)
        assert source and source["locator"] is not None

        # 写入语义索引
        job = await semantic.enqueue(wid)
        assert job is not None
        result = await semantic.process_workspace(JobStub(SimpleNamespace(
            operation_id=job.operation_id, payload={"workspace_id": wid},
            progress=None, generation=1)))
        assert result["status"] == "ok" and result["chunks"] >= 1

        async with env.read_factory() as uow:
            pub = await uow.document.get_publication(wid)
        assert pub and pub.vector_generation == pub.generation

        mixed = await retrieval.search(wid, "紫色企鹅", [SearchSourceType.DOCUMENT_CHUNK])
        assert mixed and mixed[0].payload.get("locator") is not None

        # 修改文件：旧 FTS 撤出；向量代次落后时不把旧向量当当前事实（vector_generation != generation）
        _write(folder, "notes/alpha.md", "工作区里的橙色狐狸在奔跑。\n")
        sync2 = await docs.sync_workspace(wid)
        assert await retrieval.search(wid, "紫色企鹅", [SearchSourceType.DOCUMENT_CHUNK]) == []
        await docs.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync2["operation_id"], payload={"workspace_id": wid},
            progress=None, generation=1)))
        after = await retrieval.search(wid, "橙色狐狸", [SearchSourceType.DOCUMENT_CHUNK])
        assert after and "橙色狐狸" in after[0].snippet
        async with env.read_factory() as uow:
            pub2 = await uow.document.get_publication(wid)
        assert pub2.generation > pub2.vector_generation  # 语义尚未跟上，查询只用 FTS

        semantic._indexes_root = original_indexes  # type: ignore[method-assign]

    scenario(tmp_path, body)


def test_component_install_ocr_marks_available(tmp_path):
    async def run():
        root = tmp_path / "components"
        comps = LocalRuntimeComponents(root)
        # 预置文件模拟安装完成前的包复制
        _install_ocr(root)
        status = await comps.status(OCR_COMPONENT_ID)
        assert status.state.value == "available"

    asyncio.run(run())
