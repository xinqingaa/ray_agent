"""组件状态与持久安装操作的线上视图。"""
from app.domain.external.runtime_components import ComponentStatus
from app.domain.models.identity import RequestId
from app.interfaces.schemas.operation import OperationView
from pydantic import BaseModel


class ComponentInstallRequest(BaseModel):
    request_id: RequestId


class ComponentView(ComponentStatus):
    target_version: str
    update_available: bool
    platform: str
    size: int
    operation: OperationView | None = None
