from fastapi import APIRouter

from app.application.services.model_connection_service import ModelConnectionService
from app.domain.models.llm_endpoints import ConnectionSource, ProviderDefinition
from app.interfaces.schemas.base import Response
from app.interfaces.schemas.model_connections import FileVersion, ProviderName, ProviderProbe, ProviderProbeResult, ProviderSave

router = APIRouter(prefix="/app-config/llm/providers", tags=["模型连接"])
service = ModelConnectionService()


def _draft(payload):
    definition = ProviderDefinition.model_validate(payload.model_dump(exclude={"api_key", "version", "model", "name"}))
    return definition, payload.api_key.get_secret_value() if payload.api_key is not None else None


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
