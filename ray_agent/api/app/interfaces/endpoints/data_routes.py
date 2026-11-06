from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.application.services.data_service import CleanupPreview, CleanupTask
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_data_service

router = APIRouter(prefix='/data', tags=['数据管理'])


class CleanupRequest(BaseModel):
    confirmation: str = Field(default='', max_length=160)


@router.get('/preview', response_model=Response[CleanupPreview], summary='读取清空范围')
async def preview(service=Depends(get_data_service)):
    return Response.success(data=await service.preview())


@router.get('/tasks/latest', response_model=Response[CleanupTask | None], summary='读取最近一次清空')
async def latest(service=Depends(get_data_service)):
    return Response[CleanupTask | None](data=await service.latest())


@router.get('/tasks/{identifier}', response_model=Response[CleanupTask], summary='读取清空进度')
async def read(identifier: str, service=Depends(get_data_service)):
    return Response.success(data=await service.get(identifier))


@router.post('/reset', response_model=Response[CleanupTask], summary='清空所有对话与附件',
             description='删除全部会话与文件记录并登记持久清理任务回收字节；有运行中或等待中的对话时返回 409')
async def reset(request: CleanupRequest, service=Depends(get_data_service)):
    return Response.success(data=await service.start(request.confirmation))


@router.post('/tasks/{identifier}/retry', response_model=Response[CleanupTask], summary='按原清单重试回收')
async def retry(identifier: str, service=Depends(get_data_service)):
    return Response.success(data=await service.retry(identifier))
