import asyncio
from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.responses import Response as HTTPResponse

from app.application.errors.exceptions import AppException, BadRequestError
from app.application.services.transcription_service import TranscriptionService
from app.application.services.usage_service import UsageService
from app.domain.models.error import ErrorCode
from app.domain.models.usage import UsagePreferences, UsageRange, UsageReport, UsageTotals
from app.domain.models.voice import ASRResult, MAX_AUDIO_BYTES, VoiceEngine, VoicePreference
from app.infrastructure.external.execution.runtime import get_components
from app.infrastructure.storage.sqlite import get_read_uow, get_uow
from app.interfaces.schemas.base import Response

router = APIRouter(tags=["用量与语音"])
service = UsageService(get_uow, get_read_uow)
transcription = TranscriptionService(get_read_uow, get_components)


class PreferencesUpdate(BaseModel):
    show_conversation_cost: bool | None = None
    voice: VoicePreference | None = None


@router.get("/usage", response_model=Response[UsageReport])
async def get_usage(range_id: UsageRange = "today", start: datetime | None = None,
                    end: datetime | None = None, provider: str | None = None):
    return Response.success(data=await service.report(range_id, start, end, provider))


@router.get("/usage/providers", response_model=Response[list[str]])
async def get_usage_providers():
    return Response.success(data=await service.providers())


@router.get("/usage/sessions/{session_id}", response_model=Response[UsageTotals])
async def get_session_usage(session_id: str):
    return Response.success(data=await service.session(session_id))


@router.get("/usage/preferences", response_model=Response[UsagePreferences])
async def get_usage_preferences():
    return Response.success(data=await service.preferences())


@router.patch("/usage/preferences", response_model=Response[UsagePreferences])
async def update_usage_preferences(body: PreferencesUpdate):
    return Response.success(data=await service.set_preferences(**body.model_dump()))


@router.post("/voice/transcriptions", response_model=Response[ASRResult], openapi_extra={
    "requestBody": {"required": True, "content": {"audio/wav": {"schema": {"type": "string", "format": "binary"}}}},
})
async def transcribe(request: Request, session_id: str | None = None, engine: VoiceEngine = "deepseek"):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "audio/wav":
        raise BadRequestError("录音的 Content-Type 必须为 audio/wav")
    audio = bytearray()
    async for chunk in request.stream():
        if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
            raise AppException(ErrorCode.PAYLOAD_TOO_LARGE, "录音最大 8 MiB")
        audio.extend(chunk)
    work = asyncio.create_task(transcription.transcribe(bytes(audio), session_id, engine))
    # 录音正文已读完，继续读取 ASGI 消息以感知客户端断开。
    disconnect = asyncio.create_task(request.receive())
    try:
        done, _ = await asyncio.wait((work, disconnect), return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return Response.success(data=work.result())
        return HTTPResponse(status_code=499)
    finally:
        if not work.done():
            work.cancel()
        disconnect.cancel()
        await asyncio.gather(work, disconnect, return_exceptions=True)
