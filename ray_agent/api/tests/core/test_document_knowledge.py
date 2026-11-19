"""P6 文档登记、解析、FTS 发布、删除撤回与跨工作区隔离。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.application.services.document_index_service import DocumentIndexService
from app.application.services.retrieval_service import RetrievalService
from app.domain.models.retrieval import SearchSourceType
from app.infrastructure.external.document_parse.runner import run_document_parse
from app.infrastructure.external.document_parse.worker import parse as parse_file
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
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


async def _index_service(env: Env, workspace_id: str) -> DocumentIndexService:
    async with env.read_factory() as uow:
        record = await uow.root.workspace_folder(workspace_id)
    assert record is not None
    from app.domain.external.workspace_files import FileLimits
    files = PosixWorkspaceFiles(_bindings(record), FileLimits())
    retrieval = RetrievalService(env.uow_factory, env.read_factory)
    return DocumentIndexService(env.uow_factory, env.read_factory, env.folders, files, retrieval), retrieval


def test_parse_text_markdown_csv_and_image(tmp_path):
    md = _write(tmp_path, "a.md", "# 标题\n\n季度预算评审在周五。\n")
    result = parse_file(str(md), "markdown")
    assert result["status"] == "ok" and any("季度预算" in b["text"] for b in result["blocks"])
    csv_path = _write(tmp_path, "t.csv", "name,amount\nalpha,10\nbeta,20\n")
    table = parse_file(str(csv_path), "csv")
    assert table["status"] == "ok" and table["blocks"][0]["kind"] == "table"
    png = _write(tmp_path, "scan.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    pending = parse_file(str(png), "image")
    assert pending["status"] == "pending_component" and pending.get("component_needed") == "ocr"


def test_corrupt_document_has_actionable_parse_failure(tmp_path):
    from app.infrastructure.external.document_parse.worker import parse

    path = tmp_path / "损坏.docx"
    path.write_bytes(b"not a document")
    result = parse(str(path), "docx")
    assert result["status"] == "failed"
    assert result["reason"] == "文件无法解析，请检查文件是否损坏或格式是否正确"


def test_document_worker_starts_outside_source_directory(tmp_path, monkeypatch):
    md = _write(tmp_path, "worker.md", "# 索引验收\n\n从其他目录启动。\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("PYTHONPATH", raising=False)
    result = asyncio.run(run_document_parse(md, "markdown"))
    assert result["status"] == "ok", result
    assert any("从其他目录启动" in block["text"] for block in result["blocks"])


def test_pdf_page_count_is_published_with_document_revision(tmp_path):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    from app.interfaces.schemas.document_knowledge import DocumentView

    async def body(env: Env):
        workspace = await env.service.create("PDF页数")
        wid = workspace.workspace.id
        path = Path(workspace.folder.location) / "manual.pdf"
        writer = PdfWriter()
        first_page = writer.add_blank_page(200, 300)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                 NameObject("/Subtype"): NameObject("/Type1"),
                                 NameObject("/BaseFont"): NameObject("/Helvetica")})
        first_page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 20 240 Td (Searchable page) Tj ET")
        first_page[NameObject("/Contents")] = content
        writer.add_blank_page(200, 300)
        writer.write(path)

        service, _ = await _index_service(env, wid)
        sync = await service.sync_workspace(wid)
        await service.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync["operation_id"], payload={"workspace_id": wid}, generation=1)))
        pair, = await service.page(wid, after=None, limit=10)
        view = DocumentView.of(*pair)
        assert view.status.value == "searchable"
        assert view.page_count == 2  # 空白页也计数，不能用最后一个检索片段推算。

    scenario(tmp_path, body)


def test_document_index_search_isolation_update_and_delete(tmp_path):
    async def body(env: Env):
        created_a = await env.service.create("工作区A")
        created_b = await env.service.create("工作区B")
        folder_a = Path(created_a.folder.location)
        folder_b = Path(created_b.folder.location)
        wid_a, wid_b = created_a.workspace.id, created_b.workspace.id
        _write(folder_a, "notes/budget.md", "工作区 A 的季度预算上限是一百万。\n")
        _write(folder_b, "notes/budget.md", "工作区 B 的季度预算上限是两百万。\n")

        svc_a, retrieval = await _index_service(env, wid_a)
        svc_b, _ = await _index_service(env, wid_b)
        sync_a = await svc_a.sync_workspace(wid_a)
        sync_b = await svc_b.sync_workspace(wid_b)
        assert sync_a["pending_parse"] >= 1 and sync_b["pending_parse"] >= 1
        assert sync_a["operation_id"] and sync_b["operation_id"]

        await svc_a.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync_a["operation_id"], payload={"workspace_id": wid_a},
            progress=None, generation=1)))
        await svc_b.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync_b["operation_id"], payload={"workspace_id": wid_b},
            progress=None, generation=1)))

        hits_a = await retrieval.search(wid_a, "季度预算", [SearchSourceType.DOCUMENT_CHUNK])
        hits_b = await retrieval.search(wid_b, "季度预算", [SearchSourceType.DOCUMENT_CHUNK])
        assert hits_a and "一百万" in hits_a[0].snippet
        assert hits_b and "两百万" in hits_b[0].snippet
        assert hits_a[0].source_id != hits_b[0].source_id
        source = await svc_a.get_chunk_source(wid_a, hits_a[0].source_id)
        assert source and source["relative_path"].endswith("budget.md") and not source["stale"]
        assert await svc_a.get_chunk_source(wid_b, hits_a[0].source_id) is None

        # 修改：旧片段立即撤出，新修订发布后可检索新内容
        _write(folder_a, "notes/budget.md", "工作区 A 的季度预算已调整为五十万。\n")
        sync2 = await svc_a.sync_workspace(wid_a)
        assert await retrieval.search(wid_a, "一百万", [SearchSourceType.DOCUMENT_CHUNK]) == []
        await svc_a.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync2["operation_id"], payload={"workspace_id": wid_a},
            progress=None, generation=1)))
        after = await retrieval.search(wid_a, "五十万", [SearchSourceType.DOCUMENT_CHUNK])
        assert after and "五十万" in after[0].snippet

        (folder_a / "notes/budget.md").unlink()
        await svc_a.sync_workspace(wid_a)
        assert await retrieval.search(wid_a, "五十万", [SearchSourceType.DOCUMENT_CHUNK]) == []
        assert (await svc_a.summary(wid_a)).withdrawn >= 1

    scenario(tmp_path, body)


def test_restart_reclaims_parsing_and_staged_revisions(tmp_path):
    from app.application.services.background_jobs import BackgroundJobRunner
    from app.domain.models.document_knowledge import DocumentChunk, DocumentIndexStatus
    from app.domain.models.operation import OperationKind, OperationStatus
    from tests.support.sqlite_db import with_database

    async def body(write_factory, read_factory, database):
        env = Env(tmp_path, write_factory, read_factory)
        expected = {}
        for status in (DocumentIndexStatus.PARSING, DocumentIndexStatus.INDEXING):
            workspace = await env.service.create(status.value)
            wid = workspace.workspace.id
            _write(Path(workspace.folder.location), "subject.md", "# 可恢复\n\n可检索的正文")
            service, retrieval = await _index_service(env, wid)
            sync = await service.sync_workspace(wid)
            async with write_factory() as uow:
                doc, = await uow.document.list_workspace(wid)
                revision = await uow.document.get_revision_by_number(doc.id, doc.current_revision)
                doc.status = revision.status = status
                await uow.document.save(doc)
                await uow.document.save_revision(revision)
                if status is DocumentIndexStatus.INDEXING:
                    await uow.document.replace_chunks(revision.id, [DocumentChunk(
                        id="abandoned", revision_id=revision.id, document_id=doc.id, revision=revision.revision,
                        workspace_id=wid, ordinal=0, body="不完整的产物", text_hash="test")])
                operation = await uow.job.claim("exited", [OperationKind.DOCUMENT_INDEX])
                assert operation.operation_id == sync["operation_id"]
            expected[wid] = (service, retrieval)
        await database.shutdown()
        await database.init()
        runner = BackgroundJobRunner(write_factory, "new-core", read_uow_factory=read_factory)
        runner.register(OperationKind.DOCUMENT_INDEX,
                        lambda context: expected[context.job.payload["workspace_id"]][0].process_workspace(context),
                        requeue_on_restart=True)
        assert len(await runner.recover()) == 2
        for _ in range(2):
            async with write_factory() as uow:
                job = await uow.job.claim("new-core", [OperationKind.DOCUMENT_INDEX])
            await runner.run_job(job)
            job = await runner.get(job.operation_id)
            assert job.status is OperationStatus.SUCCEEDED and job.result["processed"] == 1
        for wid, (service, retrieval) in expected.items():
            assert (await service.summary(wid)).searchable == 1
            assert await retrieval.search(wid, "可检索")
            assert not await retrieval.search(wid, "不完整")
        async with read_factory() as uow:
            assert await uow.document.get_chunk("abandoned") is None

    with_database(tmp_path, body)


def test_partial_snapshot_and_scope_controls_preserve_authorization(tmp_path, monkeypatch):
    import pytest
    from app.application.errors.exceptions import GoneError
    from app.domain.external.workspace_files import FolderSnapshot
    from app.domain.models.document_knowledge import DocumentIndexStatus

    async def body(env: Env):
        workspace = await env.service.create("受控范围")
        wid = workspace.workspace.id
        root = Path(workspace.folder.location)
        material = _write(root, "included/report.md", "核验旧版材料")
        service, retrieval = await _index_service(env, wid)
        retrieval.bind_documents(service.visible_hits)

        async def sync_and_run():
            sync = await service.sync_workspace(wid)
            if sync["operation_id"]:
                await service.process_workspace(JobStub(SimpleNamespace(
                    operation_id=sync["operation_id"], payload={"workspace_id": wid}, generation=1)))

        await sync_and_run()
        old, = await retrieval.search(wid, "核验旧版")
        original = await service.source(wid, old.source_id, old.source_version)
        assert original["preview_revision"] and not original["stale"]

        async def partial(_path):
            return FolderSnapshot({}, truncated=True)

        with monkeypatch.context() as patch:
            patch.setattr(service._files, "snapshot", partial)
            await service.sync_workspace(wid)
            summary = await service.summary(wid)
            assert summary.truncated_scan and summary.scope_review_required
            assert summary.searchable == 1 and summary.withdrawn == 0

        await service.update_policy(wid, version=0, paused=True, excluded_directories=[], scope_confirmed=True)
        _write(root, "next.txt", "暂停后新增文件")
        await sync_and_run()
        assert not await retrieval.search(wid, "暂停后新增")
        assert await retrieval.search(wid, "核验旧版")

        material.write_text("核验新版内容", encoding="utf-8")
        assert not await retrieval.search(wid, "核验旧版")  # 外部编辑尚未被重扫发现
        assert (await service.source(wid, old.source_id, old.source_version))["stale"]
        await service.update_policy(wid, version=1, paused=False, excluded_directories=["included"], scope_confirmed=True)
        await sync_and_run()
        assert material.exists() and (await service.summary(wid)).excluded == 1
        assert any(doc.status is DocumentIndexStatus.EXCLUDED for doc in await service.list_documents(wid))
        with pytest.raises(GoneError):
            await service.source(wid, old.source_id, old.source_version)
        await service.update_policy(wid, version=2, paused=False, excluded_directories=[], scope_confirmed=True)
        await sync_and_run()
        assert await retrieval.search(wid, "核验新版")
        with pytest.raises(GoneError):
            await service.source(wid, old.source_id, old.source_version)
        material.unlink()
        assert not await retrieval.search(wid, "核验新版")

    scenario(tmp_path, body)


def test_table_locations_preserve_sheet_coordinates(tmp_path):
    from openpyxl import Workbook
    from app.infrastructure.external.document_parse.chunking import blocks_from_worker, chunk_blocks
    import csv
    import io

    workbook = Workbook()
    first = workbook.active
    first.title = "项目预算"
    first["D4"] = "名称\n与用途"
    first["F18"] = "金额\t元"
    second = workbook.create_sheet("另一个计划")
    second["B21"] = "下半年"
    path = tmp_path / "book.xlsx"
    workbook.save(path)
    parsed = parse_file(str(path), "xlsx")
    blocks = blocks_from_worker(parsed, revision_id="revision", workspace_id="workspace")
    first_chunk, second_chunk = chunk_blocks(
        blocks, document_id="document", revision_id="revision", workspace_id="workspace", revision=2)
    assert first_chunk.locator["sheet"] == "项目预算"
    assert first_chunk.locator["rows"] == [4, 18]
    assert first_chunk.locator["cell_range"] == "D4:F18"
    first_row, second_row = csv.reader(io.StringIO(first_chunk.body), delimiter="\t")
    assert first_row[0] == "名称\n与用途" and second_row[2] == "金额\t元"
    assert second_chunk.locator["sheet"] == "另一个计划"
    assert second_chunk.locator["cell_range"] == "B21:B21"


def test_scan_and_single_failure_retry_have_durable_operations(tmp_path, monkeypatch):
    from app.application.services.background_jobs import BackgroundJobRunner
    from app.domain.models.document_knowledge import DocumentIndexStatus
    from app.domain.models.operation import OperationKind, OperationStatus
    from app.application.services import document_index_service as index_module

    async def body(env: Env):
        workspace = await env.service.create("索引重试")
        wid = workspace.workspace.id
        _write(Path(workspace.folder.location), "retry.txt", "处理完成后可以检索")
        service, retrieval = await _index_service(env, wid)
        original = index_module.run_document_parse

        async def fail_once(*args, **kwargs):
            return {"status": "failed", "reason": "暂时读取失败"}

        runner = BackgroundJobRunner(env.uow_factory, "core", read_uow_factory=env.read_factory)
        runner.register(OperationKind.DOCUMENT_INDEX, service.process_workspace, requeue_on_restart=True)

        async def run_one():
            async with env.uow_factory() as uow:
                claimed = await uow.job.claim("core", [OperationKind.DOCUMENT_INDEX])
            assert claimed
            await runner.run_job(claimed)
            return await runner.get(claimed.operation_id)

        scan = await service.start_scan(wid)
        assert (await service.start_scan(wid)).operation_id == scan.operation_id
        assert (await run_one()).operation_id == scan.operation_id
        with monkeypatch.context() as patch:
            patch.setattr(index_module, "run_document_parse", fail_once)
            assert (await run_one()).result["failed"] == 1
        (doc, revision), = await service.page(wid, after=None, limit=10)
        assert doc.status is DocumentIndexStatus.FAILED and revision.error_message == "暂时读取失败"
        assert (await service.sync_workspace(wid))["operation_id"] is None

        retry = await service.start_scan(wid, retry=True, document_id=doc.id, revision=doc.current_revision)
        done = await run_one()
        assert done.operation_id == retry.operation_id and done.status is OperationStatus.SUCCEEDED
        assert index_module.run_document_parse is original
        assert (await run_one()).result["processed"] == 1
        assert await retrieval.search(wid, "处理完成")

    scenario(tmp_path, body)


def test_explicit_sources_survive_readback_and_consumed_inputs(tmp_path):
    import pytest
    from app.application.errors.exceptions import ConflictError
    from app.application.services.context_assembly import ContextAssembly
    from app.application.services.memory_service import MemoryService
    from app.domain.models.event import MessageEvent
    from app.domain.models.retrieval import KnowledgeReference
    from app.domain.models.run_input import RunInput
    from app.domain.services.run_ledger import RunLedger
    from tests.support.memory_env import MemEnv

    async def body(env: Env):
        created = await env.service.create("引用版本")
        wid = created.workspace.id
        root = Path(created.folder.location)
        first = _write(root, "initial.md", "唯一来源甲号")
        _write(root, "followup.md", "唯一来源乙号")
        service, retrieval = await _index_service(env, wid)
        sync = await service.sync_workspace(wid)
        await service.process_workspace(JobStub(SimpleNamespace(
            operation_id=sync["operation_id"], payload={"workspace_id": wid}, generation=1)))
        refs = []
        for query in ("甲号", "乙号"):
            hit, = await retrieval.search(wid, query)
            refs.append(KnowledgeReference.model_validate(hit.model_dump()))

        mem = MemEnv(env.uow_factory, env.read_factory)
        session = await mem.session(wid)
        foreign = await mem.session((await mem.workspace("其他")).id)
        assembly = ContextAssembly(env.uow_factory, env.read_factory, retrieval,
                                   MemoryService(env.uow_factory, env.read_factory, retrieval), documents=service)
        first_message = MessageEvent(role="user", message="检查已选材料", knowledge_references=[refs[0]])

        async def append_input(uow, event):
            await assembly.accept_references(uow, session, event.knowledge_references, run_id=event.run_id)
            return await uow.run_input.add(RunInput(
                session_id=session.id, run_id=event.run_id, message_seq=event.seq))

        ledger = RunLedger(env.uow_factory)
        started = await ledger.start(session.id, events_after=[first_message],
                                     apply=lambda uow: append_input(uow, first_message))
        await assembly.assemble(session, started.id)
        saved = await assembly.manifest(started.id)
        assert [hit.source_id for hit in saved.explicit_hits] == [refs[0].source_id]
        assert "唯一来源甲号" in await assembly.refresh_frozen(started.id)
        async with env.uow_factory() as uow:
            with pytest.raises(ConflictError):
                await assembly.accept_references(uow, foreign, [refs[0]], run_id="foreign")

        injected = MessageEvent(role="user", message="加一份", knowledge_references=[refs[1]])

        async def consume_input(uow):
            input_id = await append_input(uow, injected)
            await uow.run_input.consume([input_id], injected.seq)

        await ledger.append(session.id, [injected], run_id=started.id, apply=consume_input)
        assert "唯一来源乙号" in await assembly.refresh_frozen(started.id)
        saved = await assembly.manifest(started.id)
        assert await assembly.citation_sources(saved) == refs

        first.write_text("此文件已经换成新版本", encoding="utf-8")
        updated = await assembly.refresh_frozen(started.id)
        assert "唯一来源甲号" not in updated and "唯一来源乙号" in updated
        saved = await assembly.manifest(started.id)
        inactive, = await assembly.inactive_document_hits(saved)
        assert inactive.stale and inactive.source_id == refs[0].source_id and not inactive.payload.get("unreadable_reason")
        first.unlink()
        inactive, = await assembly.inactive_document_hits(saved)
        assert inactive.payload["unreadable_reason"] and not inactive.snippet

    scenario(tmp_path, body)


def test_cancelled_worker_leaves_no_publication_and_can_retry(tmp_path, monkeypatch):
    from app.application.services.background_jobs import BackgroundJobRunner
    from app.application.services import document_index_service as index_module
    from app.domain.models.operation import OperationKind, OperationStatus

    async def body(env: Env):
        workspace = await env.service.create("取消再试")
        wid = workspace.workspace.id
        _write(Path(workspace.folder.location), "report.txt", "只发布完整内容")
        service, retrieval = await _index_service(env, wid)
        synced = await service.sync_workspace(wid)
        worker_started = asyncio.Event()

        async def interrupted(*args, cancel_event, **kwargs):
            worker_started.set()
            await cancel_event.wait()
            return {"status": "ok", "blocks": [{"kind": "text", "text": "不可发布的部分产物"}]}

        runner = BackgroundJobRunner(env.uow_factory, "core", read_uow_factory=env.read_factory)
        runner.register(OperationKind.DOCUMENT_INDEX, service.process_workspace, requeue_on_restart=True)

        async def claim():
            async with env.uow_factory() as uow:
                return await uow.job.claim("core", [OperationKind.DOCUMENT_INDEX])

        with monkeypatch.context() as patch:
            patch.setattr(index_module, "run_document_parse", interrupted)
            work = asyncio.create_task(runner.run_job(await claim()))
            await asyncio.wait_for(worker_started.wait(), 5)
            await runner.cancel(synced["operation_id"])
            await asyncio.wait_for(work, 5)
        cancelled = await runner.get(synced["operation_id"])
        assert cancelled.status is OperationStatus.CANCELLED
        assert not await retrieval.search(wid, "部分产物")
        assert not await retrieval.search(wid, "完整内容")
        await runner.retry(cancelled.operation_id)
        retried = await claim()
        assert retried.generation > cancelled.generation
        await runner.run_job(retried)
        assert (await runner.get(retried.operation_id)).status is OperationStatus.SUCCEEDED
        assert await retrieval.search(wid, "完整内容")

    scenario(tmp_path, body)
