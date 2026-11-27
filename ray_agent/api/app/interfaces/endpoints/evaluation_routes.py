"""桌面开发者评测的实例内接口。"""
from functools import cache
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, UploadFile

from app.application.errors.exceptions import BadRequestError
from app.application.services.evaluation_service import EvaluationService
from app.domain.models.evaluation import EvaluationBatch, EvaluationOverview, EvaluationStart
from app.domain.models.model_catalog import active_models, configured_sampling, connection_issue
from app.interfaces.schemas.base import Response
from app.interfaces.service_dependencies import get_app_config_service, get_file_service
from core.paths import data_root

router = APIRouter(prefix="/evaluation", tags=["评测"])


async def _save_artifact(filename: str, content: bytes):
    with BytesIO(content) as stream:
        return await get_file_service().upload_file(UploadFile(stream, size=len(content), filename=filename))


async def _get_sampling(model: str) -> dict:
    config = await get_app_config_service().get_llm_config()
    entry = next((item for item in active_models(config) if item.id == model), None)
    if entry is None or connection_issue(config, model):
        raise BadRequestError("请选择当前可用的模型")
    return configured_sampling(config, model).model_dump(mode="json")


@cache
def _service(root):
    return EvaluationService(root / "evaluation", _save_artifact, _get_sampling)


def service() -> EvaluationService:
    return _service(data_root().root)


@router.get("", response_model=Response[EvaluationOverview])
async def overview():
    return Response.success(service().overview())


@router.post("", response_model=Response[EvaluationBatch])
async def start(body: EvaluationStart):
    await _get_sampling(body.model)
    return Response.success(service().start(body))


@router.get("/{batch_id}", response_model=Response[EvaluationBatch])
async def batch(batch_id: UUID):
    return Response.success(service().get(batch_id))


@router.post("/{batch_id}/cancel", response_model=Response[EvaluationBatch])
async def cancel(batch_id: UUID):
    return Response.success(await service().cancel(batch_id))
