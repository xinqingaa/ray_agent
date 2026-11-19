"""工作区检索与运行背景清单（“本次参考”）。"""
from fastapi import APIRouter, Depends

from app.application.errors.exceptions import NotFoundError
from app.application.services.context_assembly import ContextAssembly
from app.application.services.retrieval_service import RetrievalService
from app.application.services.working_style_service import WorkingStyleService
from app.domain.models.retrieval import KnowledgeReference, SearchSourceType
from app.interfaces.schemas import Response
from app.interfaces.schemas.retrieval import ContextManifestView, SearchHitView, SearchRequest, SearchResponse
from app.interfaces.service_dependencies import get_context_assembly, get_retrieval_service, get_working_style_service

router = APIRouter(tags=["检索"])


@router.post("/workspaces/{workspace_id}/search", response_model=Response[SearchResponse],
             summary="在工作区内全文检索",
             description="范围固定为路径里的工作区；可检索记忆、会话摘要与已发布的文件片段")
async def search_workspace(workspace_id: str, request: SearchRequest,
                           retrieval: RetrievalService = Depends(get_retrieval_service),
                           style: WorkingStyleService = Depends(get_working_style_service)):
    await style.current(workspace_id)  # 工作区不存在或删除中时返回 404，而不是空结果
    hits = await retrieval.search(workspace_id, request.query, request.source_types, limit=request.limit)
    shown = await retrieval.present_hits(workspace_id, hits)
    return Response.success(SearchResponse(hits=[SearchHitView.of(hit) for hit in shown]))


@router.get("/workspaces/{workspace_id}/search/sources/{source_type}/{source_id}",
            response_model=Response[SearchHitView], summary="按版本读回检索来源")
async def read_source(workspace_id: str, source_type: SearchSourceType, source_id: str, source_version: int,
                      assembly: ContextAssembly = Depends(get_context_assembly)):
    hit = await assembly.source(workspace_id, KnowledgeReference(
        source_type=source_type, source_id=source_id, source_version=source_version))
    return Response.success(SearchHitView.of(hit))


@router.get("/runs/{run_id}/context-manifest", response_model=Response[ContextManifestView],
            summary="本次参考：一次运行实际使用的背景",
            description="工作方式版本、常驻记忆、初始召回与未采用的原因；独立对话的运行没有清单（404）")
async def run_context_manifest(run_id: str, assembly: ContextAssembly = Depends(get_context_assembly)):
    manifest = await assembly.manifest(run_id)
    if manifest is None:
        raise NotFoundError("该运行没有背景清单")
    sources = await assembly.readable_summary_sources(manifest)
    citations = await assembly.citation_sources(manifest)
    inactive = await assembly.inactive_document_hits(manifest)
    return Response.success(ContextManifestView.of(await assembly.readable_manifest(manifest), sources, citations, inactive))
