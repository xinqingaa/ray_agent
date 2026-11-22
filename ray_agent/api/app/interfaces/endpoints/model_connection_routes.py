from fastapi import APIRouter

from app.application.errors.exceptions import BadRequestError
from app.application.services.model_connection_service import ModelConnectionService
from app.domain.models.llm_endpoints import ConnectionSource, ProviderDefinition
from app.interfaces.schemas.base import Response
from app.interfaces.schemas.model_connections import (
    CatalogResponse, FileVersion, ProviderName, ProviderProbe, ProviderProbeResult, ProviderSave, ToolCheckResult,
)

router = APIRouter(prefix="/app-config/llm/providers", tags=["模型连接"])
catalog_router = APIRouter(prefix="/app-config/llm", tags=["模型连接"])
service = ModelConnectionService()


def _draft(payload):
    definition = ProviderDefinition.model_validate(payload.model_dump(exclude={"api_key", "version", "model", "name"}))
    return definition, payload.api_key.get_secret_value() if payload.api_key is not None else None


@catalog_router.get("/catalog", response_model=Response[CatalogResponse])
def model_catalog():
    """内置目录的模型能力与标准单价；界面据此展示目录模型，不再维护本地目录。"""
    return Response.success(data=service.catalog())


@router.get("", response_model=Response[ConnectionSource])
def list_providers():
    return Response.success(data=service.get())


@router.put("/{name}", response_model=Response[ConnectionSource])
def save_provider(name: ProviderName, body: ProviderSave):
    definition, key = _draft(body)
    return Response.success(data=service.write(name, body.version, definition, key))


@router.delete("/{name}", response_model=Response[ConnectionSource])
def delete_provider(name: ProviderName, version: FileVersion):
    return Response.success(data=service.write(name, version, None))


@router.post("/test", response_model=Response[ProviderProbeResult])
async def test_provider(body: ProviderProbe):
    definition, key = _draft(body)
    return Response.success(data=await service.probe(definition, name=body.name, key=key, model=body.model))


@router.post("/models", response_model=Response[ProviderProbeResult])
async def provider_models(body: ProviderProbe):
    definition, key = _draft(body)
    return Response.success(data=await service.probe(definition, name=body.name, key=key, model=None))


@router.post("/tool-check", response_model=Response[ToolCheckResult])
async def check_tools(body: ProviderProbe):
    """用一次带工具定义的最小请求确认单个模型是否接受工具；超时有期限，结果不写入配置。"""
    if body.model is None:
        raise BadRequestError("请选择要检测工具的模型")
    definition, key = _draft(body)
    return Response.success(data=await service.tool_check(definition, name=body.name, key=key, model=body.model))
