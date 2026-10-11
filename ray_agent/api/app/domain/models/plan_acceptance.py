"""用户确认的具体计划版本；请求标识随承接事件持久化。"""
from pydantic import BaseModel, Field


class PlanAcceptance(BaseModel):
    source_run_id: str = Field(min_length=1, max_length=128)
    plan_id: str = Field(min_length=1, max_length=128)
    source_seq: int = Field(gt=0)
    request_id: str = Field(min_length=1, max_length=128)


class PlanAlreadyAccepted(Exception):
    def __init__(self, run, seq):
        self.run, self.seq = run, seq


class PlanAcceptanceConflict(ValueError):
    pass
