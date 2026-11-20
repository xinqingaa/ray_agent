"""协调模型配置写回、上游模型读取与草稿测试。"""
import asyncio
import time

import httpx

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.domain.models.app_config import LLMConfig
from app.domain.models.error import ErrorCode
from app.domain.models.llm_endpoints import LlmEndpoint, ProviderDefinition
from app.domain.models.model_catalog import bind_endpoint, find_model
from app.domain.models.usage import usage_scope
from app.domain.external.llm import LLMRequestError
from app.infrastructure.external.llm.model_connections import (
    ConnectionFileConflict, ConnectionFileError, load_model_connections, provider_kind, write_provider,
)
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.llm.upstream_errors import upstream_message

PROBE_TIMEOUT_SECONDS = 20


class ModelConnectionService:
    @staticmethod
    def get():
        return load_model_connections().source

    @staticmethod
    def write(name: str, version: str, definition: ProviderDefinition | None, key: str | None = None):
        if definition is not None:
            if not (definition.models or definition.custom_models):
                raise BadRequestError("请至少选择或声明一个模型")
            if any(find_model(model) is None for model in definition.models):
                raise BadRequestError("目录外的模型需要声明窗口、输出上限和能力")
            if any(find_model(model) is not None for model in definition.custom_models):
                raise BadRequestError("目录模型不能重复声明")
        try:
            return write_provider(name, version, definition, key)
        except ConnectionFileConflict as exc:
            raise ConflictError(str(exc), resource_version=exc.version) from None
        except ConnectionFileError as exc:
            raise BadRequestError(str(exc)) from None
        except KeyError:
            raise NotFoundError("提供商不存在") from None

    async def probe(self, definition: ProviderDefinition, *, name: str | None, key: str | None, model: str | None):
        saved = load_model_connections().endpoints.get(name) if key is None and name is not None else None
        key = (key if key is not None else saved.api_key if saved is not None else "").strip()
        if definition.requires_key and not key:
            raise BadRequestError("请填写 API Key")
        started = time.monotonic()
        if model is None:
            ids, status = await self._models(definition, key)
            return dict(elapsed_ms=int((time.monotonic() - started) * 1000), method="models", models=ids, status=status)
        endpoint = LlmEndpoint(base_url=definition.base_url, api_protocol=definition.protocol, api_key=key,
                               provider=name, kind=provider_kind(definition), requires_key=definition.requires_key)
        config = bind_endpoint(LLMConfig(model_name=model, max_tokens=32, streaming=False,
                                        request_timeout=PROBE_TIMEOUT_SECONDS, custom_models=definition.custom_models), endpoint)
        try:
            with usage_scope(purpose="connection_test"):
                async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
                    await OpenAILLM(config).invoke([{"role": "user", "content": "Hi"}])
        except LLMRequestError as exc:
            raise AppException(ErrorCode.UPSTREAM_ERROR, str(exc),
                               details={"upstream_status": exc.status_code,
                                        "elapsed_ms": int((time.monotonic() - started) * 1000)}) from None
        except TimeoutError:
            raise AppException(ErrorCode.TIMEOUT, "测试连接超时",
                               details={"elapsed_ms": int((time.monotonic() - started) * 1000)}) from None
        return dict(elapsed_ms=int((time.monotonic() - started) * 1000), method="request", status=200)

    @staticmethod
    async def _models(definition: ProviderDefinition, key: str) -> tuple[list[str], int]:
        started = time.monotonic()
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
                async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
                    response = await client.get(str(definition.base_url).rstrip("/") + "/models", headers=headers)
        except (TimeoutError, httpx.TimeoutException):
            raise AppException(ErrorCode.TIMEOUT, "读取上游模型列表超时",
                               details={"elapsed_ms": int((time.monotonic() - started) * 1000)}) from None
        except httpx.RequestError:
            raise AppException(ErrorCode.UPSTREAM_ERROR, "无法连接上游读取模型列表",
                               details={"elapsed_ms": int((time.monotonic() - started) * 1000)}) from None
        if not response.is_success:
            raise AppException(ErrorCode.UPSTREAM_ERROR, upstream_message(response, key),
                               details={"upstream_status": response.status_code,
                                        "elapsed_ms": int((time.monotonic() - started) * 1000)})
        try:
            entries = response.json()["data"]
            if not isinstance(entries, list):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise AppException(ErrorCode.UPSTREAM_ERROR, "上游返回的模型列表格式无效") from None
        ids = sorted({item["id"] for item in entries if isinstance(item, dict)
                      and isinstance(item.get("id"), str) and item["id"] and (not key or key not in item["id"])})
        return ids, response.status_code
