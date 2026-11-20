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

import tomlkit
from pydantic import ConfigDict, Field, ValidationError

from app.domain.models.llm_endpoints import ConnectionSource, CustomModel, LlmEndpoint, ProviderDefinition, ProviderStatus

logger = logging.getLogger(__name__)
CONFIG_ENV = "RAYAGENT_CONFIG"
PROVIDER_NAME_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


class ConnectionFileError(RuntimeError):
    pass


class ConnectionFileConflict(ConnectionFileError):
    def __init__(self, version: str):
        self.version = version
        super().__init__("配置文件已被修改，请重新读取后再保存")


def config_path() -> Path:
    override = os.environ.get(CONFIG_ENV, "").strip()
    return Path(override).expanduser() if override else Path.home() / ".config" / "rayagent" / "config.toml"


class _ProviderEntry(ProviderDefinition):
    model_config = ConfigDict(extra="allow")
    api_key: str = Field(default="", repr=False)

    def model_post_init(self, _context) -> None:
        if not (self.models or self.custom_models):
            raise ValueError("models 或 custom_models 至少声明一个模型")


@dataclass(frozen=True)
class ModelConnections:
    source: ConnectionSource
    endpoints: dict[str, LlmEndpoint | None] = field(default_factory=dict)
    model_endpoints: dict[str, str] = field(default_factory=dict)
    custom_models: dict[str, CustomModel] = field(default_factory=dict)


def key_hint(key: str) -> str:
    return "••••" + key[-4:] if len(key) >= 12 else "••••"


def provider_kind(entry: ProviderDefinition):
    if entry.kind is not None:
        return entry.kind
    return {"api.deepseek.com": "deepseek", "api.openai.com": "openai"}.get(entry.base_url.host, "compatible")


def _entry_issue(error: ValidationError) -> str:
    fields = dict.fromkeys(str(item["loc"][0]) if item["loc"] else "models 或 custom_models" for item in error.errors())
    return "；".join(f"{name} 无效" for name in fields)


def parse_connections(path: Path, text: str, version: str | None = None) -> ModelConnections:
    from app.domain.models.model_catalog import find_model
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
        try:
            entry = _ProviderEntry.model_validate(value)
        except ValidationError as exc:
            loaded.endpoints[name] = None
            source.providers.append(ProviderStatus(name=name, issue=_entry_issue(exc)))
            continue
        served, problems = [], []
        key, kind = entry.api_key.strip(), provider_kind(entry)
        for model_id in dict.fromkeys([*entry.models, *entry.custom_models]):
            if find_model(model_id) is not None and model_id in entry.custom_models:
                problems.append(f"{model_id} 是目录模型，不能重复声明")
            elif find_model(model_id) is None and model_id not in entry.custom_models:
                problems.append(f"未知模型 {model_id}")
            elif model_id in loaded.model_endpoints:
                problems.append(f"{model_id} 已由 {loaded.model_endpoints[model_id]} 提供")
            else:
                loaded.model_endpoints[model_id] = name
                if model_id in entry.custom_models:
                    loaded.custom_models[model_id] = entry.custom_models[model_id]
                served.append(model_id)
        loaded.endpoints[name] = LlmEndpoint(base_url=entry.base_url, api_key=key, api_protocol=entry.protocol,
                                              kind=kind, provider=name, requires_key=entry.requires_key)
        source.providers.append(ProviderStatus(
            name=name, base_url=str(entry.base_url), api_protocol=entry.protocol, models=served,
            configured_models=entry.models, custom_models=entry.custom_models, kind=kind, requires_key=entry.requires_key,
            has_key=bool(key), key_hint=key_hint(key) if key else None,
            issue="已忽略：" + "、".join(problems) if problems else None,
        ))
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
                        for field_name, value in declaration.model_dump(exclude={"rates"}).items():
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
