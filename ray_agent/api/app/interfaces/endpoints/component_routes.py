"""固定清单内的组件安装；操作查询、取消和重试复用通用长操作接口。"""
from fastapi import APIRouter, Depends
from app.interfaces.schemas import Response
from app.interfaces.schemas.component import ComponentInstallRequest, ComponentView
from app.interfaces.schemas.operation import OperationView
from app.interfaces.service_dependencies import get_component_service

router = APIRouter(prefix='/components', tags=['运行组件'])


@router.get('', response_model=Response[list[ComponentView]])
async def list_components(service=Depends(get_component_service)):
    rows = await service.list()
    for row in rows:
        if row["operation"] is not None:
            row["operation"] = OperationView.from_operation(row["operation"])
    return Response.success(data=rows)


@router.post('/{component_id}/install', response_model=Response[OperationView])
async def install(component_id: str, body: ComponentInstallRequest, service=Depends(get_component_service)):
    return Response.success(data=OperationView.from_operation(await service.accept(component_id, body.request_id)))
