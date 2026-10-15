import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.interfaces.schemas.base import Response
from app.services.skill_resources import prepare_resources

router = APIRouter(prefix='/skills', tags=['技能材料'])


class ResourceFile(BaseModel):
    path: str = Field(max_length=4096)
    size: int = Field(ge=0)
    sha256: str = Field(pattern='^[a-f0-9]{64}$')
    content: str = Field(max_length=6990508)


class PrepareRequest(BaseModel):
    run_id: str = Field(max_length=36)
    name: str = Field(max_length=64)
    version: str = Field(max_length=64)
    files: list[ResourceFile] = Field(min_length=1, max_length=2000)


@router.post('/prepare')
async def prepare(request: PrepareRequest):
    try:
        data = await asyncio.to_thread(prepare_resources, request.run_id, request.name, request.version,
                                       [f.model_dump() for f in request.files])
        return Response.success(data=data)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
