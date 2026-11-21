"""语音请求校验、授权选择及用量归属。"""
import asyncio
import io
import wave
from functools import partial

from app.application.errors.exceptions import AppException, BadRequestError, NotFoundError
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorCode
from app.domain.models.usage import UsageCharge, usage_scope
from app.domain.models.voice import ASRResult, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, WAV_SAMPLE_RATE, VoiceEngine
from app.domain.services.usage_pricing import deepseek_asr_charge
from app.infrastructure.external.components.local_components import ComponentError
from app.infrastructure.external.llm import deepseek_asr
from app.infrastructure.external.llm.usage_recording import record_usage
from app.infrastructure.external.voice import whisper


def validate_wav(audio: bytes) -> tuple[bytes, int]:
    if len(audio) > MAX_AUDIO_BYTES:
        raise AppException(ErrorCode.PAYLOAD_TOO_LARGE, "录音最大 8 MiB")
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            if (source.getsampwidth(), source.getnchannels(), source.getframerate()) != (2, 1, WAV_SAMPLE_RATE):
                raise BadRequestError("录音需为 16 kHz 单声道 16 位 PCM WAV")
            frames = source.getnframes()
            if frames <= 0 or frames > MAX_AUDIO_SECONDS * WAV_SAMPLE_RATE:
                raise BadRequestError("录音时长须大于零且不超过 120 秒")
            pcm = source.readframes(frames)
            if len(pcm) != frames * 2:
                raise BadRequestError("录音数据不完整")
            return pcm, (frames * 1000 + WAV_SAMPLE_RATE - 1) // WAV_SAMPLE_RATE
    except (EOFError, wave.Error):
        raise BadRequestError("无法读取 WAV 录音") from None


class TranscriptionService:
    def __init__(self, read_factory, components_factory):
        self._read = read_factory
        self._components = components_factory

    async def transcribe(self, audio: bytes, session_id: str | None, engine: VoiceEngine) -> ASRResult:
        async with self._read() as uow:
            preferences = await uow.usage.preferences()
            if preferences.voice != engine:
                raise BadRequestError("录音的转写方式与当前设置不一致，请确认转写方式后重新录音")
            session = await uow.session.get_by_id(session_id) if session_id else None
            if session_id and session is None:
                raise NotFoundError("会话不存在")
        pcm, duration_ms = validate_wav(audio)
        if engine == "local":
            reason = whisper.unavailable_reason()
            if reason:
                raise AppException(ErrorCode.UNAVAILABLE, reason)
            try:
                directory = await self._components().locate(whisper.COMPONENT_ID)
            except ComponentError:
                raise AppException(ErrorCode.UNAVAILABLE, "请先下载本机语音模型") from None
            provider, model = "local", whisper.MODEL_ID
            invoke = partial(whisper.transcribe, directory, pcm, duration_ms)
        else:
            endpoint = deepseek_asr.configured_endpoint()
            provider, model = endpoint.provider, deepseek_asr.MODEL_ID
            invoke = partial(deepseek_asr.transcribe, audio, endpoint.api_key)
        started = utc_now()
        with usage_scope(purpose="transcribe", session_id=session_id, workspace_id=session.workspace_id if session else None):
            try:
                result = await invoke()
            except (Exception, asyncio.CancelledError):
                await record_usage(started, provider, model, failed=True)
                raise
            charge = UsageCharge(cost_nano_usd=0) if engine == "local" else deepseek_asr_charge(result.duration_ms)
            await record_usage(started, provider, model, audio_duration_ms=result.duration_ms, charge=charge)
        return result
