"""工作区文档索引：状态、同步与来源读回。"""
from fastapi import APIRouter, Depends, Query

from app.application.services.document_index_service import DocumentIndexService
from app.application.services.semantic_index_service import SemanticIndexService
from app.application.services.working_style_service import WorkingStyleService
from app.interfaces.schemas import Response
from app.interfaces.schemas.document_knowledge import (
    DocumentSourceView,
    DocumentPage,
    DocumentView,
    IndexPolicyRequest,
    IndexSummaryView,
    RetryIndexRequest,
    SyncIndexRequest,
)
from app.interfaces.schemas.operation import OperationView
from app.interfaces.service_dependencies import get_document_index_service, get_semantic_index_service, get_working_style_service

router = APIRouter(tags=["文档知识"])


@router.get("/workspaces/{workspace_id}/documents/index", response_model=Response[IndexSummaryView],
            summary="工作区文档索引汇总")
async def document_index_summary(workspace_id: str,
                                 documents: DocumentIndexService = Depends(get_document_index_service),
                                 style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    return Response.success(IndexSummaryView.of(await documents.summary(workspace_id)))


@router.get("/workspaces/{workspace_id}/documents", response_model=Response[list[DocumentView]],
            summary="工作区已登记文档列表")
async def list_documents(workspace_id: str,
                         documents: DocumentIndexService = Depends(get_document_index_service),
                         style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    items = await documents.list_documents(workspace_id)
    return Response.success([DocumentView.of(item) for item in items])


@router.get("/workspaces/{workspace_id}/documents/page", response_model=Response[DocumentPage])
async def page_documents(workspace_id: str, after: str | None = None, limit: int = Query(default=50, ge=1, le=200),
                         documents: DocumentIndexService = Depends(get_document_index_service),
                         style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    rows = await documents.page(workspace_id, after=after, limit=limit)
    items = [DocumentView.of(doc, revision) for doc, revision in rows[:limit]]
    return Response.success(DocumentPage(items=items, next_after=items[-1].relative_path if len(rows) > limit else None))


@router.put("/workspaces/{workspace_id}/documents/policy", response_model=Response[IndexSummaryView])
async def set_policy(workspace_id: str, request: IndexPolicyRequest,
                     documents: DocumentIndexService = Depends(get_document_index_service)):
    return Response.success(IndexSummaryView.of(await documents.update_policy(workspace_id, **request.model_dump())))


@router.post("/workspaces/{workspace_id}/documents/semantic/retry", response_model=Response[OperationView | None])
async def retry_semantic_index(workspace_id: str,
                               semantic: SemanticIndexService = Depends(get_semantic_index_service),
                               style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    job = await semantic.enqueue(workspace_id, retry=True)
    return Response.success(OperationView.from_operation(job) if job else None)


@router.post("/workspaces/{workspace_id}/documents/retry", response_model=Response[OperationView])
async def retry_documents(workspace_id: str, request: RetryIndexRequest,
                          documents: DocumentIndexService = Depends(get_document_index_service),
                          style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    job = await documents.start_scan(workspace_id, retry=True, document_id=request.document_id, revision=request.revision)
    return Response.success(OperationView.from_operation(job))


@router.post("/workspaces/{workspace_id}/documents/sync", response_model=Response[OperationView],
             summary="触发工作区文档登记与索引")
async def sync_documents(workspace_id: str, request: SyncIndexRequest,
                         documents: DocumentIndexService = Depends(get_document_index_service),
                         style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    job = await documents.start_scan(workspace_id, paths=request.paths or None)
    return Response.success(OperationView.from_operation(job))


@router.get("/workspaces/{workspace_id}/documents/chunks/{chunk_id}",
            response_model=Response[DocumentSourceView], summary="按版本读回文件来源")
async def read_document_chunk(workspace_id: str, chunk_id: str, version: int | None = Query(default=None, ge=1),
                              documents: DocumentIndexService = Depends(get_document_index_service),
                              style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    item = await documents.source(workspace_id, chunk_id, version)
    return Response.success(DocumentSourceView(**item))
