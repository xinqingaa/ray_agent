"""读取与原子写回用户 TOML。业务库和公开状态不持有密钥。"""
import hashlib
import logging
import os
import re
import stat
import tempfile
import threading
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import tomlkit
from pydantic import ConfigDict, Field, HttpUrl, TypeAdapter, ValidationError

from app.domain.models.llm_endpoints import (
    ApiProtocol, ConnectionSource, CustomModel, LlmEndpoint, ModelId, ProviderDefinition, ProviderKind, ProviderStatus,
)

logger = logging.getLogger(__name__)
CONFIG_ENV = "RAYAGENT_CONFIG"
PROVIDER_NAME_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
_MODEL_ID = TypeAdapter(ModelId)
_URL = TypeAdapter(HttpUrl)
_MODEL_KEYS = ("models", "custom_models")


class ConnectionFileError(RuntimeError):
    pass


class ConnectionFileConflict(ConnectionFileError):
    def __init__(self, version: str):
        self.version = version
        super().__init__("配置文件已被修改，请重新读取后再保存")


class ModelClaimConflict(ConnectionFileError):
    """同一模型 ID 已由其他提供商提供；模型身份全局唯一，保存直接拒绝。clashes 为 {模型 ID: 占用的提供商}。"""

    def __init__(self, message: str, clashes: dict[str, str]):
        self.clashes = clashes
        super().__init__(message)


def config_path() -> Path:
    override = os.environ.get(CONFIG_ENV, "").strip()
    return Path(override).expanduser() if override else Path.home() / ".config" / "rayagent" / "config.toml"


class _ProviderHead(ProviderDefinition):
    """提供商的地址、协议与密钥。模型列表单独逐项校验，不让单个模型拖垮整个提供商。"""
    model_config = ConfigDict(extra="allow")
    api_key: str = Field(default="", repr=False)


@dataclass(frozen=True)
class ModelConnections:
    source: ConnectionSource
    endpoints: dict[str, LlmEndpoint | None] = field(default_factory=dict)
    model_endpoints: dict[str, str] = field(default_factory=dict)
    custom_models: dict[str, CustomModel] = field(default_factory=dict)


def key_hint(key: str) -> str:
    return "••••" + key[-4:] if len(key) >= 12 else "••••"


def provider_kind(entry: ProviderDefinition | _ProviderHead):
    if entry.kind is not None:
        return entry.kind
    return {"api.deepseek.com": "deepseek", "api.openai.com": "openai"}.get(entry.base_url.host, "compatible")


def _fields(error: ValidationError) -> str:
    """字段级错误列出字段名；跨字段规则没有字段名时列出规则本身的说明，不回显任何取值。"""
    names = dict.fromkeys(
        str(item["loc"][0]) if item["loc"] else str(item["msg"]).removeprefix("Value error, ") for item in error.errors())
    return "、".join(names)


def _valid_url(raw: Any) -> str | None:
    """只返回可以原样展示的地址，用于无效条目的编辑器保留原地址。"""
    if not isinstance(raw, str):
        return None
    try:
        url = _URL.validate_python(raw)
    except ValidationError:
        return None
    if url.username or url.password or url.query or url.fragment:
        return None
    return str(url)


def _read_provider(name: str, value: Any, loaded: ModelConnections) -> ProviderStatus:
    """读取一个提供商。提供商级字段无效时整个提供商不可用；模型级字段无效只忽略该模型。"""
    from app.domain.models.model_catalog import find_model
    loaded.endpoints[name] = None
    if not isinstance(value, dict):
        return ProviderStatus(name=name, issue="提供商配置需为表")
    key_raw = value.get("api_key")
    key = key_raw.strip() if isinstance(key_raw, str) else ""
    provider_issues: list[str] = []
    try:
        head = _ProviderHead.model_validate({k: v for k, v in value.items() if k not in _MODEL_KEYS})
    except ValidationError as exc:
        head = None
        provider_issues.append(f"{_fields(exc)} 无效")

    listed: list[str] = []
    raw_models = value.get("models", [])
    if isinstance(raw_models, list):
        try:
            listed = [_MODEL_ID.validate_python(item) for item in raw_models]
        except ValidationError:
            provider_issues.append("models 无效")
    else:
        provider_issues.append("models 无效")

    raw_custom = value.get("custom_models", {})
    custom_ok = isinstance(raw_custom, dict)
    if not custom_ok:
        provider_issues.append("custom_models 无效")
    declared: dict[str, CustomModel] = {}
    invalid: set[str] = set()
    model_problems: list[str] = []
    for model_id, raw in (raw_custom.items() if custom_ok else ()):
        if find_model(model_id) is not None:
            continue  # 目录模型以内置目录为准，同名的自定义声明不生效
        try:
            _MODEL_ID.validate_python(model_id)
            declared[model_id] = CustomModel.model_validate(raw)
        except ValidationError as exc:
            invalid.add(model_id)
            model_problems.append(f"{model_id} 无效（{_fields(exc)}）")

    candidates = list(dict.fromkeys([*listed, *(raw_custom if custom_ok else ())]))
    if not candidates:
        provider_issues.append("models 或 custom_models 至少声明一个模型")
    usable = head is not None and not provider_issues

    served: list[str] = []
    for model_id in candidates:
        if find_model(model_id) is None and model_id not in declared:
            if model_id not in invalid:
                model_problems.append(f"未知模型 {model_id}")
            continue
        if model_id in loaded.model_endpoints:
            model_problems.append(f"{model_id} 已由 {loaded.model_endpoints[model_id]} 提供")
            continue
        served.append(model_id)
        if usable:
            loaded.model_endpoints[model_id] = name
            if model_id in declared:
                loaded.custom_models[model_id] = declared[model_id]

    if usable:
        loaded.endpoints[name] = LlmEndpoint(base_url=head.base_url, api_key=key, api_protocol=head.protocol,
                                              kind=provider_kind(head), provider=name, requires_key=head.requires_key)
    issues = list(provider_issues)
    if model_problems:
        issues.append("已忽略：" + "、".join(model_problems))
    return ProviderStatus(
        name=name, base_url=str(head.base_url) if head is not None else _valid_url(value.get("base_url")),
        api_protocol=head.protocol if head is not None else "responses",
        models=served, configured_models=[model for model in listed], custom_models=declared,
        kind=provider_kind(head) if head is not None else "compatible",
        requires_key=head.requires_key if head is not None else True,
        has_key=bool(key), key_hint=key_hint(key) if key else None, issue="；".join(issues) or None,
    )


def parse_connections(path: Path, text: str, version: str | None = None) -> ModelConnections:
    source = ConnectionSource(path=str(path), exists=True, version=version)
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        source.issue = "配置文件格式错误，请检查 TOML"
        return ModelConnections(source)
    source.notices = [f"不认识的配置项 {key}，已忽略" for key in raw if key != "providers"]
    providers = raw.get("providers", {})
    if not isinstance(providers, dict):
        source.issue = "providers 需为表"
        return ModelConnections(source)
    loaded = ModelConnections(source)
    for name, value in providers.items():
        if not re.fullmatch(PROVIDER_NAME_PATTERN, name):
            source.notices.append("提供商名称只能包含字母、数字、下划线与连字符，已忽略一项")
            continue
        source.providers.append(_read_provider(name, value, loaded))
    return loaded


_lock = threading.Lock()
_cached: tuple[tuple, ModelConnections] | None = None


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode


def _version(path: Path, info, content: bytes) -> str:
    digest = hashlib.sha256(repr((str(path), _identity(info) if info else None)).encode())
    digest.update(content)
    return digest.hexdigest()


def _read(path: Path) -> tuple[bytes, os.stat_result | None]:
    try:
        with path.open("rb") as stream:
            return stream.read(), os.fstat(stream.fileno())
    except FileNotFoundError:
        return b"", None


def load_model_connections() -> ModelConnections:
    global _cached
    path = config_path()
    try:
        with _lock:
            try:
                cached_key = (path, _identity(path.stat()))
            except FileNotFoundError:
                return ModelConnections(ConnectionSource(path=str(path), version=_version(path, None, b"")))
            if _cached is not None and _cached[0] == cached_key:
                return _cached[1]
            content, info = _read(path)
            if info is None:
                return ModelConnections(ConnectionSource(path=str(path), version=_version(path, None, b"")))
            version = _version(path, info, content)
            loaded = parse_connections(path, content.decode("utf-8"), version)
            if stat.S_IMODE(info.st_mode) & 0o077:
                loaded.source.notices.append("配置文件可被其他用户读取，建议执行 chmod 600")
                logger.warning("模型连接配置文件可被其他用户读取：%s", path)
            _cached = ((path, _identity(info)), loaded)
            return loaded
    except (OSError, UnicodeDecodeError):
        return ModelConnections(ConnectionSource(path=str(path), exists=True, issue="无法以 UTF-8 读取配置文件"))


def _check_claims(name: str, raw: bytes, path: Path, definition: ProviderDefinition) -> None:
    """同一模型只能属于一个提供商：以写入时读到的文件为准拒绝重复，不静默忽略。"""
    owners = parse_connections(path, raw.decode("utf-8")).model_endpoints
    wanted = [*definition.models, *definition.custom_models]
    clashes = {model: owners[model] for model in dict.fromkeys(wanted) if owners.get(model) not in (None, name)}
    if clashes:
        text = "；".join(f"{model} 已由 {owner} 提供" for model, owner in clashes.items())
        raise ModelClaimConflict(text + "。同一模型只能属于一个提供商，请先从原提供商取消勾选", clashes)


def write_provider(name: str, version: str, definition: ProviderDefinition | None, key: str | None = None) -> ConnectionSource:
    """只更新目标提供商的已知字段，替换前再次核对源文件身份和内容。"""
    path = config_path().resolve()
    try:
        with _lock:
            # 版本令牌使用配置入口路径；写到解析后的文件以保留用户创建的符号链接。
            source_path = config_path()
            raw, info = _read(path)
            current = _version(source_path, info, raw)
            if current != version:
                raise ConnectionFileConflict(current)
            if definition is not None:
                _check_claims(name, raw, source_path, definition)
            doc = tomlkit.parse(raw.decode("utf-8"))
            if "providers" not in doc:
                doc["providers"] = tomlkit.table()
            providers = doc["providers"]
            if not isinstance(providers, dict):
                raise ConnectionFileError("providers 需为表")
            if definition is None:
                if name not in providers:
                    raise KeyError(name)
                del providers[name]
            else:
                if not isinstance(providers.get(name), dict):
                    providers[name] = tomlkit.table()
                entry = providers[name]
                values = definition.model_dump(mode="json", exclude_none=True, exclude={"custom_models"})
                for field_name, value in values.items():
                    entry[field_name] = value
                if key is not None:
                    entry["api_key"] = key
                custom = entry.get("custom_models")
                if definition.custom_models or isinstance(custom, dict):
                    if not isinstance(custom, dict):
                        entry["custom_models"] = custom = tomlkit.table()
                    for obsolete in set(custom) - set(definition.custom_models):
                        del custom[obsolete]
                    for model, declaration in definition.custom_models.items():
                        if not isinstance(custom.get(model), dict):
                            custom[model] = tomlkit.table()
                        stored = custom[model]
                        values = declaration.model_dump(mode="json", exclude={"rates"})
                        for optional in ("reasoning_efforts", "unconfirmed"):
                            if not values[optional]:
                                values.pop(optional)
                                stored.pop(optional, None)
                        for field_name, value in values.items():
                            stored[field_name] = value
                        if declaration.rates is not None:
                            if not isinstance(stored.get("rates"), dict):
                                stored["rates"] = tomlkit.table()
                            for field_name, value in declaration.rates.model_dump(mode="json").items():
                                stored["rates"][field_name] = value
                        else:
                            stored.pop("rates", None)

            path.parent.mkdir(parents=True, exist_ok=True)
            fd, name_tmp = tempfile.mkstemp(dir=path.parent, prefix=".rayagent-config-")
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(tomlkit.dumps(doc).encode())
                    stream.flush()
                    os.fsync(stream.fileno())
                actual_raw, actual_info = _read(path)
                actual = _version(source_path, actual_info, actual_raw)
                if actual != current or source_path.resolve() != path:
                    raise ConnectionFileConflict(actual)
                os.replace(name_tmp, path)
            finally:
                Path(name_tmp).unlink(missing_ok=True)
    except (OSError, UnicodeDecodeError, tomlkit.exceptions.ParseError) as exc:
        raise ConnectionFileError("无法写入模型配置文件，请检查格式与文件权限") from exc
    return load_model_connections().source
