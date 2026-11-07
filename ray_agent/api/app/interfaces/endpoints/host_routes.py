"""只供桌面宿主调用的接口：登记用户在系统选择器里选中的文件夹，以及把根内路径解析成本机绝对路径。

调用方必须同时带实例令牌与宿主密钥；界面只有实例令牌，因此不能自行登记桌面路径。
"""
from fastapi import APIRouter, Depends

from app.application.services.root_access import RootFileService
from app.application.services.folder_grants import folder_grants, validate_grant_path
from app.interfaces.host_access import require_host
from app.interfaces.schemas import Response
from app.interfaces.schemas.workspace import (
    FolderGrantRequest, FolderGrantResponse, ResolveRootPathRequest, ResolveRootPathResponse,
)
from app.interfaces.service_dependencies import get_root_file_service

router = APIRouter(prefix="/host", tags=["宿主接口"], dependencies=[Depends(require_host)])


@router.post("/folder-grants", response_model=Response[FolderGrantResponse], summary="登记宿主选中的文件夹",
             description="返回一次性、短期有效的 grant_id；界面凭它打开工作区或更改默认位置。需要宿主密钥头 X-RayAgent-Host-Secret")
async def create_folder_grant(request: FolderGrantRequest) -> Response[FolderGrantResponse]:
    grant = folder_grants().issue(validate_grant_path(request.path))
    return Response.success(FolderGrantResponse(grant_id=grant.grant_id, path=grant.path,
                                                expires_at=int(grant.expires_at * 1000)))


@router.post("/roots/{root_id}/resolve", response_model=Response[ResolveRootPathResponse],
             summary="解析根内路径的本机绝对位置",
             description="供宿主「在文件管理器中显示」：按根身份与路径规则核对（不越出根、拒绝 .rayagent、版本控制内部与凭据文件，"
                         "目标必须存在），返回绝对路径；会话工作目录与工作区文件夹都适用。需要宿主密钥头 X-RayAgent-Host-Secret")
async def resolve_root_path(root_id: str, request: ResolveRootPathRequest,
                            service: RootFileService = Depends(get_root_file_service)) -> Response[ResolveRootPathResponse]:
    return Response.success(ResolveRootPathResponse(path=await service.locate(root_id, request.relative_path)))
