"""工作区文档索引：状态、同步与来源读回。"""
from fastapi import APIRouter, Depends

from app.application.errors.exceptions import NotFoundError
from app.application.services.document_index_service import DocumentIndexService
from app.application.services.working_style_service import WorkingStyleService
from app.interfaces.schemas import Response
from app.interfaces.schemas.document_knowledge import (
    DocumentSourceView,
    DocumentView,
    IndexSummaryView,
    SyncIndexRequest,
)
from app.interfaces.service_dependencies import get_document_index_service, get_working_style_service

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


@router.post("/workspaces/{workspace_id}/documents/sync", response_model=Response[dict],
             summary="触发工作区文档登记与索引")
async def sync_documents(workspace_id: str, request: SyncIndexRequest,
                         documents: DocumentIndexService = Depends(get_document_index_service),
                         style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    paths = set(request.paths) if request.paths else None
    return Response.success(await documents.sync_workspace(workspace_id, paths=paths))


@router.get("/workspaces/{workspace_id}/documents/chunks/{chunk_id}",
            response_model=Response[DocumentSourceView], summary="读回已发布文件片段原文")
async def read_document_chunk(workspace_id: str, chunk_id: str,
                              documents: DocumentIndexService = Depends(get_document_index_service),
                              style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)
    item = await documents.get_chunk_source(workspace_id, chunk_id)
    if item is None:
        raise NotFoundError("片段不存在、已撤回或不属于该工作区")
    return Response.success(DocumentSourceView(**item))
