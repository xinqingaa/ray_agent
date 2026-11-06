"""握手与状态接口共用的核心描述：同一进程只有一个实例身份。"""
import os
import time
import uuid
from typing import Any

from app.domain.models.capability import CapabilityStatus
from app.interfaces.schemas.core import BuildIdentity, CoreInstance

INSTANCE = CoreInstance(instance_id=str(uuid.uuid4()), pid=os.getpid(), started_at=int(time.time() * 1000))


def build_identity() -> BuildIdentity:
    from build_identity import read_manifest
    return BuildIdentity.model_validate(read_manifest())


def describe_core(capabilities: list[CapabilityStatus]) -> dict[str, Any]:
    """storage 为空：桌面业务库尚未建立。"""
    return dict(instance=INSTANCE, build=build_identity(), storage=None, capabilities=capabilities)
