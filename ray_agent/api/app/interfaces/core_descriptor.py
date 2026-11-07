"""握手与状态接口共用的核心描述：同一进程只有一个实例身份，存储版本在业务库迁移完成后记录。"""
import os
import time
import uuid
from typing import Any, Optional

from app.domain.models.capability import CapabilityStatus
from app.domain.models.error import ErrorCode, ErrorInfo
from app.interfaces.schemas.core import BuildIdentity, CoreInstance, StorageVersion

INSTANCE = CoreInstance(instance_id=str(uuid.uuid4()), pid=os.getpid(), started_at=int(time.time() * 1000))
_storage: Optional[StorageVersion] = None
_startup_failure: Optional[ErrorInfo] = None


def record_startup_failure(error: BaseException) -> None:
    """启动失败时留下可读原因，供握手返回；具体异常只进 stderr 日志。"""
    global _startup_failure
    from app.infrastructure.storage.sqlite import DataRootLocked, SchemaTooNew
    if isinstance(error, DataRootLocked):
        _startup_failure = ErrorInfo.of(ErrorCode.CONFLICT, "数据目录已被另一个 RayAgent 核心占用，请先退出另一个实例",
                                        details={"reason": "data_root_locked"})
    elif isinstance(error, SchemaTooNew):
        _startup_failure = ErrorInfo.of(ErrorCode.CONFLICT, "数据来自更新版本的 RayAgent，当前程序不能打开",
                                        details={"reason": "schema_too_new"})
    else:
        _startup_failure = ErrorInfo.of(ErrorCode.INTERNAL_ERROR, "核心初始化失败，详见 stderr 日志",
                                        details={"reason": "startup_failed"})


def startup_failure() -> ErrorInfo:
    return _startup_failure or ErrorInfo.of(ErrorCode.INTERNAL_ERROR, "核心初始化失败，详见 stderr 日志",
                                            details={"reason": "startup_failed"})


def set_storage_revision(revision: Optional[str]) -> None:
    global _storage
    _storage = StorageVersion(schema_revision=revision) if revision else None


def build_identity() -> BuildIdentity:
    from build_identity import read_manifest
    return BuildIdentity.model_validate(read_manifest())


def describe_core(capabilities: list[CapabilityStatus]) -> dict[str, Any]:
    return dict(instance=INSTANCE, build=build_identity(), storage=_storage, capabilities=capabilities)
