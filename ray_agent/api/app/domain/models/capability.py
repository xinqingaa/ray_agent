"""能力声明：核心告诉宿主与界面哪些能力现在可用；不可用时给出原因代码，界面据此决定是否提供入口。"""
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator


class Capability(StrEnum):
    FILE_ACCESS = "file_access"  # 读写工作区文件夹与会话工作目录
    LOCAL_COMMAND = "local_command"  # 执行 Shell 与脚本
    BROWSER = "browser"  # 自动化浏览器
    FULL_TEXT_SEARCH = "full_text_search"  # 工作区全文检索
    SEMANTIC_INDEX = "semantic_index"  # 工作区语义索引
    OCR = "ocr"
    REMOTE_CONTROL = "remote_control"  # 已配对设备远程访问


class CapabilityState(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


class UnavailableReason(StrEnum):
    NOT_IMPLEMENTED = "not_implemented"  # 当前版本没有这项能力
    COMPONENT_MISSING = "component_missing"  # 受管组件未安装，可安装
    COMPONENT_FAILED = "component_failed"  # 受管组件损坏或校验失败，可重装
    DISABLED = "disabled"  # 设置关闭，可在设置中启用
    PERMISSION_DENIED = "permission_denied"  # 缺少系统授权，可授权后重试
    DEPENDENCY_UNAVAILABLE = "dependency_unavailable"  # 依赖的服务或运行环境不可达，恢复后重试


RECOVERABLE_REASONS = frozenset(set(UnavailableReason) - {UnavailableReason.NOT_IMPLEMENTED})


class CapabilityStatus(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    capability: Capability
    state: CapabilityState
    reason: UnavailableReason | None = None
    recoverable: bool = False  # 用户处理 reason 指出的问题后能否变为可用
    detail: str | None = None  # 给用户看的说明

    @model_validator(mode="after")
    def _reason_matches_state(self) -> Self:
        if self.state is CapabilityState.AVAILABLE and (self.reason is not None or self.recoverable):
            raise ValueError("可用的能力没有不可用原因")
        if self.state is CapabilityState.UNAVAILABLE:
            if self.reason is None:
                raise ValueError("不可用的能力必须给出原因")
            if self.recoverable != (self.reason in RECOVERABLE_REASONS):
                raise ValueError("recoverable 与原因代码不一致")
        return self

    @classmethod
    def available(cls, capability: Capability, detail: str | None = None) -> "CapabilityStatus":
        return cls(capability=capability, state=CapabilityState.AVAILABLE, detail=detail)

    @classmethod
    def unavailable(cls, capability: Capability, reason: UnavailableReason, detail: str | None = None) -> "CapabilityStatus":
        return cls(capability=capability, state=CapabilityState.UNAVAILABLE, reason=reason,
                   recoverable=reason in RECOVERABLE_REASONS, detail=detail)
