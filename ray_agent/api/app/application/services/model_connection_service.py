"""协调模型配置写回、上游模型读取、工具能力检测与草稿测试。"""
import asyncio
import time

import httpx

from app.application.errors.exceptions import AppException, BadRequestError, ConflictError, NotFoundError
from app.domain.models.app_config import LLMConfig
from app.domain.models.error import ErrorCode
from app.domain.models.llm_endpoints import LlmEndpoint, ProviderDefinition
from app.domain.models.model_catalog import (
    bind_endpoint, catalog_models, custom_declaration, find_model, normalize_provider_models, public_capabilities,
)
from app.domain.models.usage import usage_scope
from app.domain.external.llm import LLMRequestError
from app.domain.services.model_discovery import probe_model
from app.domain.services.usage_pricing import PRICE_VERSION, builtin_token_rates
from app.infrastructure.external.llm.model_connections import (
    ConnectionFileConflict, ConnectionFileError, ModelClaimConflict, load_model_connections, provider_kind, write_provider,
)
from app.infrastructure.external.llm.openai_llm import OpenAILLM
from app.infrastructure.external.llm.upstream_errors import upstream_message
from app.infrastructure.external.llm.upstream_models import parse_model_list

PROBE_TIMEOUT_SECONDS = 20
TOOL_CHECK_TIMEOUT_SECONDS = 20
# 工具检测只关心上游是否接受工具定义；模型不必真的调用它。
TOOL_CHECK_NAME = "rayagent_connection_check"
TOOL_CHECK_TOOLS = [{"type": "function", "function": {
    "name": TOOL_CHECK_NAME, "description": "连接检测，不需要执行任何动作。",
    "parameters": {"type": "object", "properties": {}},
}}]


# 请求体被上游拒绝时才说明工具定义本身不被接受；其他 4xx 与此无关，不作为结论。
TOOL_REJECTED_STATUSES = frozenset({400, 422})


def _probe_config(definition: ProviderDefinition, model: str, endpoint: LlmEndpoint, timeout: float) -> LLMConfig:
    """探测用的配置。模型既不在目录也没有声明时，使用与保存相同的保守默认声明，而不是让适配层各自兜底。"""
    custom = dict(definition.custom_models)
    if model not in custom and find_model(model) is None:
        custom[model] = custom_declaration()
    return bind_endpoint(LLMConfig(model_name=model, max_tokens=32, streaming=False, request_timeout=timeout,
                                   custom_models=custom), endpoint)


class ModelConnectionService:
    @staticmethod
    def get():
        return load_model_connections().source

    @staticmethod
    def catalog() -> dict:
        """内置目录的能力与标准单价，供设置页展示。不含端点与密钥。"""
        models = []
        for spec in catalog_models():
            rates = builtin_token_rates(spec.provider, spec.id)
            models.append({**public_capabilities(spec), "rates": rates, "has_builtin_pricing": rates is not None})
        return {"price_version": PRICE_VERSION, "models": models}

    @staticmethod
    def write(name: str, version: str, definition: ProviderDefinition | None, key: str | None = None):
        if definition is not None:
            try:
                definition = normalize_provider_models(definition)
            except ValueError as exc:
                raise BadRequestError(str(exc)) from None
        try:
            return write_provider(name, version, definition, key)
        except ConnectionFileConflict as exc:
            raise ConflictError(str(exc), resource_version=exc.version) from None
        except ModelClaimConflict as exc:
            details = {"models": {model: f"已由 {owner} 提供" for model, owner in exc.clashes.items()}}
            raise BadRequestError(str(exc), details=details) from None
        except ConnectionFileError as exc:
            raise BadRequestError(str(exc)) from None
        except KeyError:
            raise NotFoundError("提供商不存在") from None

    async def probe(self, definition: ProviderDefinition, *, name: str | None, key: str | None, model: str | None):
        key = self._key(definition, name, key)
        started = time.monotonic()
        if model is None:
            reports, status = await self._models(definition, key)
            owners = load_model_connections().model_endpoints
            details = [probe_model(report, claimed_by=self._claimed_by(owners.get(report.id), name)) for report in reports]
            return dict(elapsed_ms=int((time.monotonic() - started) * 1000), method="models",
                        models=[item.id for item in details], model_details=details, status=status)
        endpoint = self._endpoint(definition, name, key)
        config = _probe_config(definition, model, endpoint, PROBE_TIMEOUT_SECONDS)
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

    async def tool_check(self, definition: ProviderDefinition, *, name: str | None, key: str | None, model: str):
        """用一次带工具定义的最小请求判断单个模型是否接受工具。只有 400、422 表示上游拒绝了请求体，
        才给出「不支持」结论；401／403（密钥或权限）、404（模型或地址）、其他 4xx、限流、5xx、超时与连接失败
        都无法判断工具能力，作为失败返回：可重试的给出重试提示，不可重试的说明需要先修正的原因。"""
        key = self._key(definition, name, key)
        endpoint = self._endpoint(definition, name, key)
        started = time.monotonic()
        config = _probe_config(definition, model, endpoint, TOOL_CHECK_TIMEOUT_SECONDS)
        try:
            with usage_scope(purpose="connection_test"):
                async with asyncio.timeout(TOOL_CHECK_TIMEOUT_SECONDS):
                    await OpenAILLM(config).invoke(
                        [{"role": "user", "content": "如需要，调用一次 rayagent_connection_check；否则回复 ok。"}],
                        tools=TOOL_CHECK_TOOLS,
                    )
        except LLMRequestError as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            status = exc.status_code
            if status in TOOL_REJECTED_STATUSES:
                return dict(supported=False, elapsed_ms=elapsed, upstream_status=status, reason=str(exc),
                            suggestion="上游不接受工具定义，建议关闭该模型的工具后再使用")
            if status in (401, 403):
                hint, retryable = "密钥无效或没有该模型的权限，请检查 API Key 后重试", False
            elif status == 404:
                hint, retryable = "上游找不到该模型或接口地址不正确，请检查模型 ID 与地址", False
            elif status is not None and 400 <= status < 500 and status != 429:
                hint, retryable = "上游拒绝了检测请求，无法判断工具能力", False
            else:
                hint, retryable = "上游暂时不可用或限流，请稍后重试", True
            raise AppException(ErrorCode.UPSTREAM_ERROR, f"工具能力检测未能完成：{hint}（{exc}）",
                               retryable=retryable,
                               details={"upstream_status": status, "elapsed_ms": elapsed, "reason": hint}) from None
        except TimeoutError:
            raise AppException(ErrorCode.TIMEOUT, "工具能力检测超时",
                               details={"elapsed_ms": int((time.monotonic() - started) * 1000)}) from None
        return dict(supported=True, elapsed_ms=int((time.monotonic() - started) * 1000), upstream_status=200,
                    reason=None, suggestion=None)

    @staticmethod
    def _key(definition: ProviderDefinition, name: str | None, key: str | None) -> str:
        saved = load_model_connections().endpoints.get(name) if key is None and name is not None else None
        resolved = (key if key is not None else saved.api_key if saved is not None else "").strip()
        if definition.requires_key and not resolved:
            raise BadRequestError("请填写 API Key")
        return resolved

    @staticmethod
    def _endpoint(definition: ProviderDefinition, name: str | None, key: str) -> LlmEndpoint:
        return LlmEndpoint(base_url=definition.base_url, api_protocol=definition.protocol, api_key=key,
                           provider=name, kind=provider_kind(definition), requires_key=definition.requires_key)

    @staticmethod
    def _claimed_by(owner: str | None, name: str | None) -> str | None:
        return owner if owner is not None and owner != name else None

    @staticmethod
    async def _models(definition: ProviderDefinition, key: str):
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
            reports = parse_model_list(response.json(), secret=key)
        except ValueError:
            raise AppException(ErrorCode.UPSTREAM_ERROR, "上游返回的模型列表格式无效") from None
        return reports, response.status_code
