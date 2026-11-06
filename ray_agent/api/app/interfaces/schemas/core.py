"""核心启动协议与状态接口的契约。

宿主经 stdin 写一行 CoreLaunch 并保持管道打开；核心在回环随机端口就绪后经 stdout 写一行 CoreHandshake。
握手与 GET /api/status 返回同一组协议版本、构建与实例身份、存储版本和能力声明。
"""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models.capability import CapabilityStatus
from app.domain.models.error import ErrorInfo
from app.domain.models.health_status import HealthStatus
from app.domain.models.identity import InstanceId
from app.interfaces.schemas.event import EVENT_VERSION, EventVersion

# HTTP、SSE 与启动协议整体不兼容地变化时递增；宿主与客户端按它判断能否继续连接。
PROTOCOL_VERSION = 1

type ProtocolVersion = Annotated[int, Field(ge=1, description="核心协议版本")]

_RESPONSE_SCHEMA = ConfigDict(json_schema_serialization_defaults_required=True)


class CoreLaunch(BaseModel):
    """宿主写入核心 stdin 的启动参数；凭据只经这条私有管道或环境文件传递，不进命令行。"""
    data_dir: str = Field(description="可写数据目录")
    env_files: list[str] = Field(default_factory=list, description="依次叠加的环境文件，后者覆盖前者")
    env: dict[str, str] = Field(default_factory=dict, description="最后叠加的显式环境")


class BuildIdentity(BaseModel):
    """构建身份；fingerprint 为空表示未知，不能用 Git 提交代替内容依据。"""
    model_config = _RESPONSE_SCHEMA

    service: str
    algorithm: str | None = None
    fingerprint: str | None = None
    revision: str | None = None
    dirty: bool | None = None
    built_at: str | None = None


class StorageVersion(BaseModel):
    model_config = _RESPONSE_SCHEMA

    schema_revision: str = Field(description="业务库当前迁移版本")


class CoreInstance(BaseModel):
    model_config = _RESPONSE_SCHEMA

    instance_id: InstanceId
    pid: int
    started_at: int = Field(description="核心进程启动时间，毫秒时间戳")


class CoreDescriptor(BaseModel):
    """握手与状态共有的身份与能力。"""
    model_config = _RESPONSE_SCHEMA

    protocol_version: ProtocolVersion = PROTOCOL_VERSION
    event_version: EventVersion = EVENT_VERSION
    instance: CoreInstance
    build: BuildIdentity
    storage: StorageVersion | None = Field(default=None, description="桌面业务库版本；尚未建立桌面业务库时为空")
    capabilities: list[CapabilityStatus]


class CoreReady(CoreDescriptor):
    event: Literal["ready"] = "ready"
    port: int = Field(ge=1, le=65535)
    instance_token: str | None = Field(default=None, description="实例令牌；尚未启用实例认证，目前为空")


class CoreFailed(BaseModel):
    model_config = _RESPONSE_SCHEMA

    event: Literal["failed"] = "failed"
    protocol_version: ProtocolVersion = PROTOCOL_VERSION
    error: ErrorInfo


type CoreHandshake = Annotated[CoreReady | CoreFailed, Field(discriminator="event")]


class CoreStatus(CoreDescriptor):
    healthy: bool = Field(description="全部依赖服务检查通过")
    services: list[HealthStatus]
