"""DeepSeek 独立语音转写接口。音频仅随请求发送。"""
import asyncio

import httpx
from pydantic import ValidationError

from app.application.errors.exceptions import AppException
from app.domain.models.error import ErrorCode
from app.domain.models.voice import ASRResult
from app.infrastructure.external.llm.model_connections import load_model_connections
from app.infrastructure.external.llm.upstream_errors import redact_credentials, upstream_message

ASR_URL = "https://api.deepseek.com/v1/tools/asr"
ASR_TIMEOUT_SECONDS = 135
MODEL_ID = "deepseek-asr"


def configured_endpoint():
    for endpoint in load_model_connections().endpoints.values():
        if (endpoint is not None and endpoint.base_url.host == "api.deepseek.com"
                and endpoint.base_url.scheme == "https" and endpoint.base_url.port == 443
                and endpoint.api_key and endpoint.api_key != "xxxx"):
            return endpoint
    raise AppException(ErrorCode.UNAVAILABLE, "请先在「设置 → 模型提供商」配置官方 DeepSeek 连接及 API Key")


async def transcribe(audio: bytes, key: str) -> ASRResult:
    try:
        async with asyncio.timeout(ASR_TIMEOUT_SECONDS):
            async with httpx.AsyncClient(timeout=ASR_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    ASR_URL, headers={"Authorization": f"Bearer {key}"},
                    files={"file": ("recording.wav", audio, "audio/wav")},
                )
    except (TimeoutError, httpx.TimeoutException):
        raise AppException(ErrorCode.TIMEOUT, "DeepSeek 转写请求超时") from None
    except httpx.RequestError:
        raise AppException(ErrorCode.UPSTREAM_ERROR, "无法连接 DeepSeek 语音识别服务") from None
    if not response.is_success:
        code = {429: ErrorCode.RATE_LIMITED, 503: ErrorCode.UNAVAILABLE, 504: ErrorCode.TIMEOUT}.get(
            response.status_code, ErrorCode.UPSTREAM_ERROR)
        raise AppException(code, upstream_message(response, key), details={"upstream_status": response.status_code})
    try:
        result = ASRResult.model_validate_json(response.content)
    except ValidationError:
        raise AppException(ErrorCode.UPSTREAM_ERROR, "DeepSeek 返回的转写结果格式无效") from None
    return result.model_copy(update={"text": redact_credentials(result.text, key),
                                     "request_id": redact_credentials(result.request_id, key)})
