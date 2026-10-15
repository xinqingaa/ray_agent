"""技能管理 HTTP 适配，安装逻辑全部委托共享服务。"""
from typing import Literal
from fastapi import APIRouter, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import get_skill_service
from app.domain.services.skill_packages import SkillError

router = APIRouter(prefix='/skills', tags=['技能'])


class ImportRequest(BaseModel):
    operation_id: str
    kind: Literal['github', 'manual']
    url: str | None = Field(default=None, max_length=2048)
    text: str | None = Field(default=None, max_length=5 * 1024 * 1024)
    update_name: str | None = None
    expected_version: str | None = None


class PublishRequest(BaseModel):
    candidate_path: str
    fingerprint: str


class EditRequest(BaseModel):
    expected_version: str
    text: str = Field(max_length=5 * 1024 * 1024)


class StateRequest(BaseModel):
    expected_version: str
    enabled: bool


@router.get('')
async def list_skills(service=Depends(get_skill_service)):
    return Response.success(data=await service.list())


@router.post('/imports')
async def create_import(request: ImportRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.create_import(**request.model_dump()))


@router.post('/imports/zip')
async def upload_import(operation_id: str = Form(...), file: UploadFile = File(...),
                        update_name: str | None = Form(None), expected_version: str | None = Form(None),
                        service=Depends(get_skill_service)):
    raw = await file.read(service.settings.skill_download_bytes + 1)
    if len(raw) > service.settings.skill_download_bytes:
        raise SkillError('ZIP 上传大小超限')
    return Response.success(data=await service.create_import(operation_id, kind='zip', raw=raw,
                                                            update_name=update_name, expected_version=expected_version))


@router.get('/imports/{operation_id}')
async def get_import(operation_id: str, service=Depends(get_skill_service)):
    op = await service.operation(operation_id)
    if op.get('owner') is not None:
        raise SkillError('此导入属于聊天运行，请在原对话中续接', 403)
    return Response.success(data=op)


@router.post('/imports/{operation_id}/publish')
async def publish_import(operation_id: str, request: PublishRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.publish(operation_id, request.candidate_path, request.fingerprint))


@router.get('/{name}')
async def skill_detail(name: str, service=Depends(get_skill_service)):
    return Response.success(data=await service.detail(name))


@router.put('/{name}')
async def edit_skill(name: str, request: EditRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.edit(name, request.expected_version, request.text))


@router.patch('/{name}')
async def change_skill(name: str, request: StateRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.change(name, request.expected_version, enabled=request.enabled))


@router.delete('/{name}')
async def delete_skill(name: str, expected_version: str, service=Depends(get_skill_service)):
    await service.change(name, expected_version, delete=True)
    return Response.success(data={})
