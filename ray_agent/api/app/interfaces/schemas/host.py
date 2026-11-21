"""桌面宿主专用接口的契约：只供宿主调用，界面不使用。"""
from pydantic import BaseModel, ConfigDict, Field

_STRICT = ConfigDict(json_schema_serialization_defaults_required=True)


class HostActivityResponse(BaseModel):
    model_config = _STRICT

    active_runs: int = Field(ge=0, description="活动运行数（运行中、等待回复或审批，以及已受理但尚未开始的启动）；只读")
