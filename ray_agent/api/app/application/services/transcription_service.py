"""语音请求校验、授权选择及用量归属。"""
import asyncio
import io
import wave

from app.application.errors.exceptions import AppException, BadRequestError, NotFoundError
from app.domain.models.clock import utc_now
from app.domain.models.error import ErrorCode
from app.domain.models.usage import usage_scope
from app.domain.services.usage_pricing import deepseek_asr_charge
from app.infrastructure.external.llm import deepseek_asr
from app.infrastructure.external.llm.model_connections import load_model_connections
from app.infrastructure.external.llm.usage_recording import record_usage

WAV_SAMPLE_RATE = 16_000


def validate_wav(audio: bytes) -> None:
    if len(audio) > deepseek_asr.MAX_AUDIO_BYTES:
        raise AppException(ErrorCode.PAYLOAD_TOO_LARGE, "录音最大 8 MiB")
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            if (source.getsampwidth(), source.getnchannels(), source.getframerate()) != (2, 1, WAV_SAMPLE_RATE):
                raise BadRequestError("录音需为 16 kHz 单声道 16 位 PCM WAV")
            frames = source.getnframes()
            if frames <= 0 or frames > deepseek_asr.MAX_AUDIO_SECONDS * WAV_SAMPLE_RATE:
                raise BadRequestError("录音时长须大于零且不超过 120 秒")
            if len(source.readframes(frames)) != frames * 2:
                raise BadRequestError("录音数据不完整")
    except (EOFError, wave.Error):
        raise BadRequestError("无法读取 WAV 录音") from None


class TranscriptionService:
    def __init__(self, read_factory):
        self._read = read_factory

    async def transcribe(self, audio: bytes, session_id: str | None) -> deepseek_asr.ASRResult:
        async with self._read() as uow:
            preferences = await uow.usage.preferences()
            if preferences.voice != "deepseek":
                raise BadRequestError("请先在「设置 → 通用」启用 DeepSeek 语音转写")
            session = await uow.session.get_by_id(session_id) if session_id else None
            if session_id and session is None:
                raise NotFoundError("会话不存在")
        validate_wav(audio)
        configured = load_model_connections()
        endpoint = next((item for item in configured.endpoints.values()
                         if item is not None and item.base_url.host == "api.deepseek.com"
                         and item.base_url.scheme == "https" and item.base_url.port == 443
                         and item.api_key and item.api_key != "xxxx"), None)
        if endpoint is None:
            raise AppException(ErrorCode.UNAVAILABLE, "请先在「设置 → 模型提供商」配置官方 DeepSeek 连接及 API Key")
        started = utc_now()
        with usage_scope(purpose="transcribe", session_id=session_id, workspace_id=session.workspace_id if session else None):
            try:
                result = await deepseek_asr.transcribe(audio, endpoint.api_key)
            except (Exception, asyncio.CancelledError):
                await record_usage(started, endpoint.provider, "deepseek-asr", failed=True)
                raise
            await record_usage(started, endpoint.provider, "deepseek-asr", audio_duration_ms=result.duration_ms,
                               charge=deepseek_asr_charge(result.duration_ms))
        return result
