"""skill 管理 HTTP 适配，安装与多来源发现委托共享服务。"""
from typing import Annotated, Literal
from urllib.parse import quote
from fastapi.responses import Response as FileResponse
from fastapi import APIRouter, Depends, UploadFile, File, Form, Query
from pydantic import BaseModel, Field
from app.interfaces.schemas import Response
from app.interfaces.service_dependencies import (
    get_skill_service, get_app_config_service, get_skill_market, native_skill_target, publish_native_skill,
)
from app.domain.services.skill_packages import SkillError
from app.domain.models.app_config import SkillConfig
from app.application.services.folder_grants import folder_grants

router = APIRouter(prefix='/skills', tags=['skill'])


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
    enabled: bool | None = None
    included: bool | None = None


class ExtraDirRequest(BaseModel):
    grant_id: str


class PreferRequest(BaseModel):
    name: str
    skill_id: str | None = None
    workspace_id: str | None = None


class MarketItem(BaseModel):
    id: str
    repository: str
    slug: str
    name: str
    installs: int
    count_label: str | None
    description: str | None = None


class MarketCatalog(BaseModel):
    items: list[MarketItem]
    has_more: bool
    updated_at: int
    stale: bool


class MarketTarget(BaseModel):
    workspace_id: str | None
    target_id: str
    directory: str


class MarketDescriptionsRequest(BaseModel):
    ids: list[Annotated[str, Field(max_length=270)]] = Field(min_length=1, max_length=12)


class MarketInstallRequest(BaseModel):
    operation_id: str
    repository: str = Field(max_length=140)
    slug: str = Field(max_length=128)
    workspace_id: str | None = None
    target_id: str = Field(pattern=r'^[a-f0-9]{64}$')


@router.get('/market')
async def market_catalog(q: str = Query(default='', max_length=200),
                         offset: int = Query(default=0, ge=0),
                         limit: int = Query(default=25, ge=1, le=100),
                         market=Depends(get_skill_market)) -> Response[MarketCatalog]:
    return Response.success(data=await market.catalog(q, offset, limit))


@router.post('/market/descriptions')
async def market_descriptions(body: MarketDescriptionsRequest,
                              market=Depends(get_skill_market)) -> Response[dict[str, str | None]]:
    return Response.success(data=await market.descriptions(body.ids))


@router.get('/market/targets')
async def market_targets(workspace_id: str | None = Query(default=None),
                         service=Depends(get_skill_service)) -> Response[list[MarketTarget]]:
    available = []
    for scope in (workspace_id, None) if workspace_id else (None,):
        if target := await native_skill_target(service, scope):
            available.append(MarketTarget(workspace_id=scope, target_id=target.id,
                                          directory=str(target.destination(''))))
    return Response.success(data=available)


@router.post('/market/install')
async def market_install(request: MarketInstallRequest, service=Depends(get_skill_service)):
    async def publish(workspace_id, target_id, name, bundle):
        return await publish_native_skill(service, workspace_id, target_id, name, bundle)

    return Response.success(data=await service.install_from_market(**request.model_dump(), publish=publish))


@router.get('')
async def list_skills(workspace_id: str | None = Query(default=None),
                      refresh: bool = Query(default=True),
                      service=Depends(get_skill_service)):
    return Response.success(data=await service.list(workspace_id=workspace_id, refresh=refresh))


@router.get('/sources')
async def list_sources(workspace_id: str | None = Query(default=None),
                       service=Depends(get_skill_service)):
    return Response.success(data=await service.sources(workspace_id=workspace_id))


@router.post('/scan')
async def scan_skills(workspace_id: str | None = Query(default=None),
                      service=Depends(get_skill_service)):
    await service.refresh_catalog(workspace_id=workspace_id, force=True)
    return Response.success(data=await service.list(workspace_id=workspace_id, refresh=False))


@router.get('/config')
async def get_skill_config(config_service=Depends(get_app_config_service)):
    return Response.success(data=(await config_service.get_skill_config()).model_dump())


@router.put('/config')
async def update_skill_config(body: SkillConfig, config_service=Depends(get_app_config_service),
                              service=Depends(get_skill_service)):
    saved = await config_service.update_skill_config(body)
    return Response.success(data=saved.model_dump())


@router.post('/extra-dirs')
async def add_extra_dir(body: ExtraDirRequest, config_service=Depends(get_app_config_service),
                        service=Depends(get_skill_service)):
    path = folder_grants().redeem(body.grant_id)
    config = await config_service.get_skill_config()
    dirs = list(config.extra_dirs)
    if path not in dirs:
        dirs.append(path)
    saved = await config_service.update_skill_config(config.model_copy(update={'extra_dirs': dirs}))
    await service.refresh_catalog()
    return Response.success(data=saved.model_dump())


@router.delete('/extra-dirs')
async def remove_extra_dir(path: str = Query(...), config_service=Depends(get_app_config_service),
                           service=Depends(get_skill_service)):
    config = await config_service.get_skill_config()
    dirs = [item for item in config.extra_dirs if item != path]
    saved = await config_service.update_skill_config(config.model_copy(update={'extra_dirs': dirs}))
    await service.refresh_catalog()
    return Response.success(data=saved.model_dump())


@router.post('/prefer')
async def prefer_skill(body: PreferRequest, config_service=Depends(get_app_config_service),
                       service=Depends(get_skill_service)):
    if body.skill_id:
        entries = await service.list(workspace_id=body.workspace_id, refresh=False)
        if not any(entry['id'] == body.skill_id and entry['name'] == body.name and entry['enabled'] for entry in entries):
            raise SkillError('此 Skill 在当前范围不可用，请刷新目录', 409)
    config = await config_service.get_skill_config()
    by_workspace = dict(config.workspace_preferred)
    preferred = dict(by_workspace.get(body.workspace_id, {}) if body.workspace_id else config.preferred)
    if body.skill_id:
        preferred[body.name] = body.skill_id
    else:
        preferred.pop(body.name, None)
    if body.workspace_id:
        if preferred:
            by_workspace[body.workspace_id] = preferred
        else:
            by_workspace.pop(body.workspace_id, None)
        update = {'workspace_preferred': by_workspace}
    else:
        update = {'preferred': preferred}
    saved = await config_service.update_skill_config(config.model_copy(update=update))
    return Response.success(data=saved.model_dump())


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


@router.post('/imports/local')
async def upload_local(paths: Annotated[list[str], Form()], files: Annotated[list[UploadFile], File()],
                       operation_id: str = Form(...), unpack_zip: str = Form('0'),
                       update_name: str | None = Form(None), expected_version: str | None = Form(None),
                       service=Depends(get_skill_service)):
    if not files or len(paths) != len(files):
        raise SkillError('请选择 Skill 文件')
    payload, total = {}, 0
    ceiling = max(service.settings.skill_download_bytes, service.settings.skill_package_bytes)
    for path, upload in zip(paths, files):
        if path in payload:
            raise SkillError(f'重复路径：{path}')
        data = await upload.read(service.settings.skill_download_bytes + 1)
        if len(data) > service.settings.skill_download_bytes or total + len(data) > ceiling:
            raise SkillError('上传大小超限')
        payload[path] = data
        total += len(data)
    return Response.success(data=await service.create_import(
        operation_id, kind='local', files=payload, unpack_zip=unpack_zip == '1',
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


class ReviseRequest(PublishRequest):
    text: str = Field(max_length=5 * 1024 * 1024)
    revision_id: str


def file_response(raw, path, download):
    headers = {'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
               'Content-Security-Policy': "default-src 'none'; sandbox"}
    if download:
        headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + quote(path.rsplit('/', 1)[-1], safe='')
    return FileResponse(raw, media_type='application/octet-stream', headers=headers)


@router.get('/imports/{operation_id}/file')
async def import_file(operation_id: str, candidate_path: str, fingerprint: str, path: str,
                      download: bool = False, service=Depends(get_skill_service)):
    raw = await service.import_file(operation_id, candidate_path, fingerprint, path)
    return file_response(raw, path, download)


@router.put('/imports/{operation_id}/content')
async def revise_import(operation_id: str, request: ReviseRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.revise_import(operation_id, **request.model_dump()))


@router.get('/{skill_id}/file')
async def skill_file(skill_id: str, expected_version: str, path: str, download: bool = False,
                     workspace_id: str | None = None, run_id: str | None = None, service=Depends(get_skill_service)):
    return file_response(await service.file(skill_id, expected_version, path, workspace_id=workspace_id, run_id=run_id),
                         path, download)


@router.get('/{skill_id}')
async def skill_detail(skill_id: str, workspace_id: str | None = None,
                       expected_version: str | None = None, run_id: str | None = None,
                       service=Depends(get_skill_service)):
    return Response.success(data=await service.detail(skill_id, workspace_id=workspace_id,
                                                      expected_version=expected_version, run_id=run_id))


@router.put('/{skill_id}')
async def edit_skill(skill_id: str, request: EditRequest, service=Depends(get_skill_service)):
    return Response.success(data=await service.edit(skill_id, request.expected_version, request.text))


@router.patch('/{skill_id}')
async def change_skill(skill_id: str, request: StateRequest, workspace_id: str | None = None,
                       service=Depends(get_skill_service)):
    return Response.success(data=await service.change(
        skill_id, request.expected_version, enabled=request.enabled, included=request.included, workspace_id=workspace_id))


@router.delete('/{skill_id}')
async def delete_skill(skill_id: str, expected_version: str, workspace_id: str | None = None,
                       service=Depends(get_skill_service)):
    await service.change(skill_id, expected_version, delete=True, workspace_id=workspace_id)
    return Response.success(data={})
