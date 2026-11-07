"""从用户配置文件读取模型连接。

文件默认在 ~/.config/rayagent/config.toml，环境变量 RAYAGENT_CONFIG 可另指。按修改时间重新读取，改完即对新运行生效；
单个提供商写错只让它的模型不可用。原因与提醒只描述字段，不带原始取值，避免误填的密钥进入日志或界面。
"""
import logging
import os
import re
import stat
import threading
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError

from app.domain.models.llm_endpoints import ApiProtocol, ConnectionSource, LlmEndpoint, ProviderStatus

logger = logging.getLogger(__name__)

CONFIG_ENV = "RAYAGENT_CONFIG"
_PROVIDER_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_FIELD_ISSUES = {
    "base_url": "base_url 不是合法的 http(s) 地址",
    "api_key": "api_key 需为字符串",
    "protocol": "protocol 只能是 responses 或 chat_completions",
    "models": "models 需为非空的模型 id 列表",
}


def config_path() -> Path:
    override = os.environ.get(CONFIG_ENV, "").strip()
    return Path(override).expanduser() if override else Path.home() / ".config" / "rayagent" / "config.toml"


class _ProviderEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: HttpUrl
    api_key: str = ""
    protocol: ApiProtocol = "responses"
    models: list[str] = Field(min_length=1)


@dataclass(frozen=True)
class ModelConnections:
    source: ConnectionSource
    endpoints: dict[str, Optional[LlmEndpoint]] = field(default_factory=dict)
    model_endpoints: dict[str, str] = field(default_factory=dict)


def key_hint(key: str) -> str:
    return "••••" + key[-4:] if len(key) >= 12 else "••••"


def _entry_issue(error: ValidationError) -> str:
    issues = []
    for item in error.errors():
        name = str(item["loc"][0]) if item["loc"] else ""
        text = f"不认识的字段 {name}" if item["type"] == "extra_forbidden" else \
            _FIELD_ISSUES.get(name, f"{name} 无效")
        if text not in issues:
            issues.append(text)
    return "；".join(issues)


def parse_connections(path: Path, text: str) -> ModelConnections:
    from app.domain.models.model_catalog import find_model
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        return ModelConnections(ConnectionSource(path=str(path), exists=True, issue=f"配置文件格式错误：{exc}"))
    notices = [f"不认识的配置项 {key}，已忽略" for key in raw if key != "providers"]
    providers = raw.get("providers", {})
    if not isinstance(providers, dict):
        return ModelConnections(ConnectionSource(path=str(path), exists=True, issue="providers 需为表"))
    statuses: list[ProviderStatus] = []
    endpoints: dict[str, Optional[LlmEndpoint]] = {}
    mapping: dict[str, str] = {}
    for name, value in providers.items():
        if not _PROVIDER_NAME.match(name):
            notices.append("提供商名称只能包含字母、数字、下划线与连字符，已忽略一项")
            continue
        try:
            entry = _ProviderEntry.model_validate(value if isinstance(value, dict) else {})
        except ValidationError as exc:
            endpoints[name] = None
            statuses.append(ProviderStatus(name=name, issue=_entry_issue(exc)))
            continue
        problems, served = [], []
        for model_id in dict.fromkeys(entry.models):
            if find_model(model_id) is None:
                problems.append(f"未知模型 {model_id}")
            elif model_id in mapping:
                problems.append(f"{model_id} 已由 {mapping[model_id]} 提供")
            else:
                mapping[model_id] = name
                served.append(model_id)
        key = entry.api_key.strip()
        endpoints[name] = LlmEndpoint(base_url=entry.base_url, api_key=key, api_protocol=entry.protocol)
        statuses.append(ProviderStatus(
            name=name, base_url=str(entry.base_url), api_protocol=entry.protocol, models=served, has_key=bool(key),
            key_hint=key_hint(key) if key else None, issue="已忽略：" + "、".join(problems) if problems else None))
    return ModelConnections(ConnectionSource(path=str(path), exists=True, notices=notices, providers=statuses),
                            endpoints, mapping)


_lock = threading.Lock()
_cached: Optional[tuple[tuple, ModelConnections]] = None


def load_model_connections() -> ModelConnections:
    """文件身份（路径、inode、大小、修改时间）不变时复用上次结果。"""
    global _cached
    path = config_path()
    try:
        info = path.stat()
    except FileNotFoundError:
        return ModelConnections(ConnectionSource(path=str(path)))
    except OSError:
        return ModelConnections(ConnectionSource(path=str(path), issue="无法读取配置文件"))
    identity = (str(path), info.st_ino, info.st_size, info.st_mtime_ns, info.st_mode)
    with _lock:
        if _cached is not None and _cached[0] == identity:
            return _cached[1]
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ModelConnections(ConnectionSource(path=str(path), exists=True, issue="无法以 UTF-8 读取配置文件"))
    loaded = parse_connections(path, text)
    if stat.S_IMODE(info.st_mode) & 0o077:
        loaded.source.notices.append("配置文件可被其他用户读取，建议执行 chmod 600")
        logger.warning("模型连接配置文件可被其他用户读取：%s", path)
    with _lock:
        _cached = (identity, loaded)
    return loaded
