"""工作区记忆：列表、新增、对单条的用户操作、来源与变更；会话是否参与记忆。"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.application.errors.exceptions import BadRequestError
from app.application.services.memory_service import MemoryService
from app.domain.models.workspace_memory import MemoryStatus
from app.interfaces.schemas import Response
from app.interfaces.schemas.memory import (
    CreateMemoryRequest, MemoryChangeView, MemoryItem, MemoryListResponse, MemorySourceView, MemorySourcesResponse,
    ParticipateInMemoryRequest, ParticipateInMemoryResponse, PatchMemoryRequest,
)
from app.interfaces.service_dependencies import get_memory_service

router = APIRouter(tags=["记忆"])


async def _item(service: MemoryService, workspace_id: str, entry) -> MemoryItem:
    resident = {item.id for item in await service.resident(workspace_id)}
    return MemoryItem.of(entry, frozenset(resident))


@router.get("/workspaces/{workspace_id}/memories", response_model=Response[MemoryListResponse],
            summary="工作区记忆列表",
            description="status 可重复指定；省略时返回活动与候选。常驻层条目带 resident=true")
async def list_memories(workspace_id: str, status: Optional[list[MemoryStatus]] = Query(default=None),
                        service: MemoryService = Depends(get_memory_service)):
    statuses = status or [MemoryStatus.ACTIVE, MemoryStatus.CANDIDATE]
    entries = await service.entries(workspace_id, statuses)
    resident = frozenset(item.id for item in await service.resident(workspace_id))
    return Response.success(MemoryListResponse(memories=[MemoryItem.of(entry, resident) for entry in entries]))


@router.post("/workspaces/{workspace_id}/memories", response_model=Response[MemoryItem], summary="新增记忆",
             description="用户操作：立即生效并标为用户确认")
async def create_memory(workspace_id: str, request: CreateMemoryRequest,
                        service: MemoryService = Depends(get_memory_service)):
    entry = await service.create(workspace_id, request.content, request.memory_type, pinned=request.pinned)
    return Response.success(await _item(service, workspace_id, entry))


@router.patch("/workspaces/{workspace_id}/memories/{memory_id}", response_model=Response[MemoryItem],
              summary="对一条记忆的用户操作",
              description="edit 修改内容或类型、pin／unpin 钉住、confirm 确认候选、retract 撤回、undo 撤销最近一次变更。"
                          "version 不符返回 409 并带最新值")
async def patch_memory(workspace_id: str, memory_id: str, request: PatchMemoryRequest,
                       service: MemoryService = Depends(get_memory_service)):
    if request.action == "edit":
        if request.content is None and request.memory_type is None:
            raise BadRequestError("edit 需要提供 content 或 memory_type")
        entry = await service.edit(workspace_id, memory_id, request.version, content=request.content,
                                   memory_type=request.memory_type)
    elif request.action in ("pin", "unpin"):
        entry = await service.set_pinned(workspace_id, memory_id, request.version, request.action == "pin")
    elif request.action == "confirm":
        entry = await service.confirm(workspace_id, memory_id, request.version)
    elif request.action == "retract":
        entry = await service.retract(workspace_id, memory_id, request.version)
    else:
        entry = await service.undo(workspace_id, memory_id, request.version)
    return Response.success(await _item(service, workspace_id, entry))


@router.get("/workspaces/{workspace_id}/memories/{memory_id}/sources", response_model=Response[MemorySourcesResponse],
            summary="记忆的来源与变更历史",
            description="来源会话已被删除时 available 为 false，界面如实标明，不指向别处")
async def memory_sources(workspace_id: str, memory_id: str, service: MemoryService = Depends(get_memory_service)):
    sources = await service.sources(workspace_id, memory_id)
    changes = await service.changes(workspace_id, memory_id)
    return Response.success(MemorySourcesResponse(
        sources=[MemorySourceView.of(item) for item in sources],
        changes=[MemoryChangeView.of(item) for item in changes]))


@router.post("/sessions/{session_id}/participate-in-memory", response_model=Response[ParticipateInMemoryResponse],
             summary="设置会话是否参与记忆",
             description="关闭后该会话不再提炼记忆、不再生成可检索的摘要，已索引的摘要撤出检索；独立对话返回 400")
async def participate_in_memory(session_id: str, request: ParticipateInMemoryRequest,
                                service: MemoryService = Depends(get_memory_service)):
    value = await service.set_session_participation(session_id, request.participate)
    return Response.success(ParticipateInMemoryResponse(session_id=session_id, participate_in_memory=value))
