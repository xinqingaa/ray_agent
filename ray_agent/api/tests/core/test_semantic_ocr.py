"""P7：语义组件缺失时 FTS 照常；OCR／Embedding 安装后可检索；旧向量不冒充当前原文。"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app.application.services.background_jobs import BackgroundJobRunner
from app.application.services.capability_service import CapabilityService
from app.application.services.document_index_service import DocumentIndexService
from app.application.services.retrieval_service import RetrievalService
from app.application.services.semantic_index_service import SemanticIndexService
from app.domain.models.capability import Capability, CapabilityState, UnavailableReason
from app.domain.models.document_knowledge import DocumentOcrState
from app.domain.models.operation import OperationKind, OperationStatus
from app.domain.models.retrieval import SearchSourceType
from app.domain.models.semantic_index import EMBEDDING_DIM, OCR_COMPONENT_ID
from app.infrastructure.external.components.local_components import LocalRuntimeComponents
from app.infrastructure.external.document_parse.worker import parse as parse_file
from app.infrastructure.external.embedding.e5_onnx import E5OnnxEmbedder, split_by_token_budget
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
        if query == "semantic-only-probe":
            query = "工作区里的紫色企鹅会跳舞。"
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
        runner = BackgroundJobRunner(env.uow_factory, "semantic-test", read_uow_factory=env.read_factory)
        runner.register(OperationKind.SEMANTIC_INDEX, semantic.process_workspace, requeue_on_restart=True)

        async def consume(target):
            async with env.uow_factory() as uow:
                claimed = await uow.job.claim(runner.instance_id, [OperationKind.SEMANTIC_INDEX])
            assert claimed and claimed.operation_id == target.operation_id
            await runner.run_job(claimed)
            return await runner.get(target.operation_id)

        finished = await consume(job)
        assert finished.status is OperationStatus.SUCCEEDED and finished.result["chunks"] >= 1

        async with env.read_factory() as uow:
            pub = await uow.document.get_publication(wid)
        assert pub and pub.vector_generation == pub.generation

        mixed = await retrieval.search(wid, "紫色企鹅", [SearchSourceType.DOCUMENT_CHUNK])
        assert mixed[0].payload["match_kind"] == "hybrid"
        assert (await docs.summary(wid)).semantic.state == "ready"
        semantic_only, execution = await retrieval.search_with_execution(wid, "semantic-only-probe")
        assert execution.mode == "hybrid"
        assert semantic_only[0].payload["match_kind"] == "semantic" and semantic_only[0].source_id == mixed[0].source_id
        assert await retrieval.search(wid, "semantic-only-probe", [SearchSourceType.MEMORY]) == []

        # 未发布的表头不能改变固定版检索结果。
        store = semantic.store_for(wid, pub.embedding_config)
        store.begin_rebuild()
        pinned, _ = await retrieval.search_with_execution(wid, "semantic-only-probe")
        assert pinned[0].source_id == mixed[0].source_id
        async with env.uow_factory() as uow:
            broken = await uow.document.get_publication(wid)
            broken.vector_table_version = 99999
            await uow.document.save_publication(broken)
        fallback, execution = await retrieval.search_with_execution(wid, "紫色企鹅")
        assert fallback[0].source_id == mixed[0].source_id and execution.reason == "semantic_error"
        assert (await docs.summary(wid)).semantic.state == "failed"
        # 重建失败后仍沿同一操作重试，成功时固定版本重新可读。
        repairing = await semantic.enqueue(wid, retry=True)
        with monkeypatch.context() as patch:
            def fail_encoding(*args):
                raise RuntimeError("编码暂时失败")

            patch.setattr(semantic, "_rows", fail_encoding)
            failed = await consume(repairing)
            assert failed.status is OperationStatus.FAILED
        retried = await semantic.enqueue(wid, retry=True)
        assert retried.operation_id == repairing.operation_id and retried.generation > repairing.generation
        assert (await consume(retried)).status is OperationStatus.SUCCEEDED
        assert (await docs.summary(wid)).semantic.state == "ready"

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


def test_e5_budget_keeps_complete_input_and_excludes_padding(tmp_path):
    from tokenizers import Tokenizer, models, pre_tokenizers, processors

    alphabet = pre_tokenizers.ByteLevel.alphabet()
    vocab = {item: index + 3 for index, item in enumerate(alphabet)}
    vocab.update({"<s>": 0, "<pad>": 1, "</s>": 2})
    tokenizer = Tokenizer(models.BPE(vocab, []))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.post_processor = processors.TemplateProcessing(single="<s> $A </s>", special_tokens=[("<s>", 0), ("</s>", 2)])
    tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
    text = "无空白的长中文" * 100 + "\n字段\t中段定位" + "字" * 300 + "末尾标记"
    parts = split_by_token_budget(text, tokenizer, max_tokens=48)
    assert "".join(parts) == text
    assert all(len(tokenizer.encode("passage: " + part.strip()).ids) <= 48 for part in parts)

    class Session:
        def run(self, _outputs, feeds):
            ids = feeds["input_ids"]
            masks = feeds["attention_mask"]
            assert np.array_equal(masks, ids != 1)
            return [np.stack([ids % 7 + 1, ids % 13 + 1], axis=-1)]

    model = E5OnnxEmbedder(tmp_path)
    model._session = Session()
    model._tokenizer = tokenizer
    model._input_names = ["input_ids", "attention_mask"]
    np.testing.assert_allclose(model.embed_passages(["短文本"])[0], model.embed_passages(["短文本", parts[0]])[0])


def test_mixed_pdf_backfill_retains_text_source_and_publishes_scan_page(tmp_path):
    from PIL import Image, ImageDraw, ImageFont
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    async def body(env: Env):
        created = await env.service.create("混合扫描")
        folder, wid = Path(created.folder.location), created.workspace.id
        image = Image.new("RGB", (640, 180), "white")
        ImageDraw.Draw(image).text((24, 50), "SCANPAGEALPHA", fill="black", font=ImageFont.load_default(size=35))
        scan = tmp_path / "page.pdf"
        image.save(scan)
        pdf = PdfWriter()
        text_page = pdf.add_blank_page(width=640, height=180)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                                 NameObject("/BaseFont"): NameObject("/Helvetica")})
        text_page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): pdf._add_object(font)})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 20 Tf 30 100 Td (NATIVE TEXT BRAVO) Tj ET")
        text_page[NameObject("/Contents")] = pdf._add_object(content)
        pdf.append(scan)
        pdf.write(folder / "mixed.pdf")
        component = None
        async with env.read_factory() as uow:
            record = await uow.root.workspace_folder(wid)
        from app.domain.external.workspace_files import FileLimits
        retrieval = RetrievalService(env.uow_factory, env.read_factory)
        docs = DocumentIndexService(env.uow_factory, env.read_factory, env.folders,
                                    PosixWorkspaceFiles(_bindings(record), FileLimits()), retrieval,
                                    ocr_dir_probe=lambda: component)

        async def consume(operation_id):
            return await docs.process_workspace(JobStub(SimpleNamespace(
                operation_id=operation_id, payload={"workspace_id": wid}, progress=None, generation=1)))

        work = await docs.sync_workspace(wid)
        await consume(work["operation_id"])
        original, = await retrieval.search(wid, "BRAVO")
        item, = await docs.page(wid, after=None, limit=10)
        assert item[1].ocr_state is DocumentOcrState.WAITING_COMPONENT and item[1].ocr_pages_pending == 1
        assert not await retrieval.search(wid, "SCANPAGEALPHA")

        component = _install_ocr(tmp_path / "models")
        await docs.reconcile_ocr()
        moments = await docs.summary(wid)
        assert moments.ocr_pending == 1 and moments.active_operation_id
        await consume(moments.active_operation_id)
        native, = await retrieval.search(wid, "BRAVO")
        assert native.source_id == original.source_id and native.source_version == original.source_version
        scanned, = await retrieval.search(wid, "SCANPAGEALPHA")
        source = await docs.source(wid, scanned.source_id, scanned.source_version)
        assert source["locator"]["page"] == 2 and source["locator"]["region"] == 0
        assert (await docs.summary(wid)).ocr_pending == 0
        await docs.reconcile_ocr()
        assert (await docs.summary(wid)).active_operation_id is None

    scenario(tmp_path, body)


def test_component_install_ocr_marks_available(tmp_path, monkeypatch):
    async def run():
        root = tmp_path / "components"
        comps = LocalRuntimeComponents(root)
        # 预置文件模拟安装完成前的包复制
        _install_ocr(root / OCR_COMPONENT_ID / "versions")
        assert (await comps.status(OCR_COMPONENT_ID)).state.value == "not_installed"
        comps.publish(OCR_COMPONENT_ID, "ocr")
        status = await comps.status(OCR_COMPONENT_ID)
        assert status.state.value == "available"
        from app.infrastructure.external.execution import runtime
        from app.interfaces.service_dependencies import _ocr_dir_probe
        monkeypatch.setattr(runtime, "get_components", lambda: comps)
        assert _ocr_dir_probe() == comps.staging(OCR_COMPONENT_ID, "ocr")

    asyncio.run(run())
