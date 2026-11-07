"""文件夹工作区：列表、新建、打开已有文件夹、识别复制冲突、重命名、归档、删除、可用性核对与默认位置。"""
from fastapi import APIRouter, Depends

from app.application.services.workspace_changes import WorkspaceChangeFeed
from app.application.services.workspace_service import WorkspaceService
from app.interfaces.schemas import Response
from app.interfaces.schemas.operation import OperationView
from app.interfaces.schemas.workspace import (
    CreateWorkspaceRequest, DefaultLocationRequest, DefaultLocationResponse, OpenWorkspaceRequest,
    OpenWorkspaceResult, RelocateWorkspaceRequest, RenameWorkspaceRequest, ResolveConflictRequest, WorkspaceItem,
    WorkspaceListResponse, WorkspaceVersionRequest, workspace_item,
)
from app.interfaces.service_dependencies import get_change_feed, get_workspace_service

router = APIRouter(prefix="/workspaces", tags=["工作区"])


def _opened(result) -> OpenWorkspaceResult:
    return OpenWorkspaceResult(
        status=result.status, workspace=workspace_item(result.view) if result.view is not None else None,
        scan=result.scan, recognized=result.recognized, conflict=result.conflict)


@router.get("", response_model=Response[WorkspaceListResponse], summary="工作区列表",
            description="按需核对每个文件夹的可用性：路径缺失或文件系统身份不符为 unavailable，会话仍可用")
async def list_workspaces(service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(WorkspaceListResponse(workspaces=[workspace_item(view) for view in await service.list()]))


@router.post("", response_model=Response[WorkspaceItem], summary="新建工作区",
             description="在默认工作区位置下按名称新建文件夹（重名加序号，不复用已有目录）")
async def create_workspace(request: CreateWorkspaceRequest, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.create(request.name)))


@router.post("/open", response_model=Response[OpenWorkspaceResult], summary="打开已有文件夹为工作区",
             description="需要宿主选择器产生的一次性 grant_id。打开新文件夹会写入身份标记；"
                         "识别出移动则改绑；复制出的文件夹返回 conflict，用 /workspaces/open/resolve 选择")
async def open_workspace(request: OpenWorkspaceRequest, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(_opened(await service.open_folder(request.grant_id, request.name)))


@router.post("/open/resolve", response_model=Response[OpenWorkspaceResult], summary="处理复制文件夹的冲突",
             description="as_new：在此文件夹重写本机标记条目并成为新工作区；rebind：原工作区改绑到这里，原文件夹解除绑定")
async def resolve_conflict(request: ResolveConflictRequest, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(_opened(await service.resolve_conflict(request.conflict_id, request.resolution)))


@router.get("/default-location", response_model=Response[DefaultLocationResponse], summary="默认工作区位置")
async def get_default_location(service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(DefaultLocationResponse(path=await service.default_location()))


@router.post("/default-location", response_model=Response[DefaultLocationResponse], summary="更改默认工作区位置",
             description="需要宿主选择器产生的一次性 grant_id")
async def set_default_location(request: DefaultLocationRequest,
                               service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(DefaultLocationResponse(path=await service.set_default_location(request.grant_id)))


@router.get("/{workspace_id}", response_model=Response[WorkspaceItem], summary="工作区详情")
async def get_workspace(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.get(workspace_id)))


@router.post("/{workspace_id}/rename", response_model=Response[WorkspaceItem], summary="重命名工作区",
             description="只改名称，不改文件夹名；version 不符返回 409")
async def rename_workspace(workspace_id: str, request: RenameWorkspaceRequest,
                           service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.rename(workspace_id, request.name, request.version)))


@router.post("/{workspace_id}/archive", response_model=Response[WorkspaceItem], summary="归档工作区",
             description="归档后不能新建会话，也不会写入文件夹；已有会话可读")
async def archive_workspace(workspace_id: str, request: WorkspaceVersionRequest,
                            service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.archive(workspace_id, request.version)))


@router.post("/{workspace_id}/unarchive", response_model=Response[WorkspaceItem], summary="取消归档")
async def unarchive_workspace(workspace_id: str, request: WorkspaceVersionRequest,
                              service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.unarchive(workspace_id, request.version)))


@router.post("/{workspace_id}/relocate", response_model=Response[WorkspaceItem], summary="重新定位工作区的文件夹",
             description="用宿主选择器产生的 grant_id 把工作区改绑到另一个文件夹，不依赖身份标记；校验同打开。"
                         "version 不符、目标已绑定其他工作区（details.reason=already_bound）、目标标记属于本机另一个工作区"
                         "（marker_other_workspace）、有未释放的写入租约（details.lease）或活动运行（details.run_id）时返回 409；"
                         "嵌套、数据根与系统目录返回 400/403 同打开。成功后外部变更订阅自动切到新位置")
async def relocate_workspace(workspace_id: str, request: RelocateWorkspaceRequest,
                             service: WorkspaceService = Depends(get_workspace_service),
                             feed: WorkspaceChangeFeed = Depends(get_change_feed)):
    view = await service.relocate(workspace_id, request.grant_id, request.version)
    await feed.restart(workspace_id)
    return Response.success(workspace_item(view))


@router.post("/{workspace_id}/recheck", response_model=Response[WorkspaceItem], summary="重新核对文件夹可用性")
async def recheck_workspace(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(workspace_item(await service.recheck(workspace_id)))


@router.post("/{workspace_id}/delete", response_model=Response[OperationView], summary="删除工作区",
             description="删除工作区记录与它的全部会话，后台回收会话文件并尽力移除文件夹里的本机标记条目；"
                         "不删除文件夹和其中的任何用户文件。返回长操作，用 /operations/{id} 读回")
async def delete_workspace(workspace_id: str, service: WorkspaceService = Depends(get_workspace_service)):
    return Response.success(OperationView.from_operation(await service.delete(workspace_id)))
