"""P6 文档登记、解析、FTS 发布、删除撤回与跨工作区隔离。"""
import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.application.services.document_index_service import DocumentIndexService
from app.application.services.retrieval_service import RetrievalService
from app.domain.models.retrieval import SearchSourceType
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
