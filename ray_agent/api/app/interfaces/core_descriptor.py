"""握手与状态接口共用的核心描述：同一进程只有一个实例身份，存储版本在业务库迁移完成后记录。"""
import os
import time
import uuid
from typing import Any, Optional

from app.domain.models.capability import CapabilityStatus
from app.interfaces.schemas.core import BuildIdentity, CoreInstance, StorageVersion

INSTANCE = CoreInstance(instance_id=str(uuid.uuid4()), pid=os.getpid(), started_at=int(time.time() * 1000))
_storage: Optional[StorageVersion] = None


def set_storage_revision(revision: Optional[str]) -> None:
    global _storage
    _storage = StorageVersion(schema_revision=revision) if revision else None


def build_identity() -> BuildIdentity:
    from build_identity import read_manifest
    return BuildIdentity.model_validate(read_manifest())


def describe_core(capabilities: list[CapabilityStatus]) -> dict[str, Any]:
    return dict(instance=INSTANCE, build=build_identity(), storage=_storage, capabilities=capabilities)
