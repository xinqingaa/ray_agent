from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_data_cleanup_service
from app.domain.models.data_cleanup import CleanupTask, CleanupPreview

router = APIRouter(prefix='/data', tags=['数据管理'])


class CleanupRequest(BaseModel):
    confirmation: str = Field(default='', max_length=160)


@router.get('/preview', response_model=Response[CleanupPreview])
async def preview(project_id: str | None = None, service=Depends(get_data_cleanup_service)):
    return Response.success(data=await service.preview(project_id))


@router.get('/tasks/latest', response_model=Response[CleanupTask | None])
async def latest(project_id: str | None = None, service=Depends(get_data_cleanup_service)):
    return Response[CleanupTask | None](data=await service.repository.latest(project_id))


@router.get('/tasks/{identifier}', response_model=Response[CleanupTask])
async def read(identifier: str, service=Depends(get_data_cleanup_service)):
    return Response.success(data=await service.repository.get(identifier))


@router.post('/projects/{project_id}/delete', response_model=Response[CleanupTask])
async def delete_project(project_id: str, request: CleanupRequest, service=Depends(get_data_cleanup_service)):
    return Response.success(data=await service.start(project_id, request.confirmation))


@router.post('/reset', response_model=Response[CleanupTask])
async def reset(request: CleanupRequest, service=Depends(get_data_cleanup_service)):
    return Response.success(data=await service.start(None, request.confirmation))


@router.post('/tasks/{identifier}/retry', response_model=Response[CleanupTask])
async def retry(identifier: str, service=Depends(get_data_cleanup_service)):
    return Response.success(data=await service.retry(identifier))
