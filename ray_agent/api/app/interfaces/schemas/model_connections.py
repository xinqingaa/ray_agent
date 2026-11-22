from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, SecretStr

from app.domain.models.llm_endpoints import ModelId, ProbedModel, ProviderDefinition, TokenRates

ProviderName = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
FileVersion = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ProviderDraft(ProviderDefinition):
    api_key: SecretStr | None = None


class ProviderSave(ProviderDraft):
    version: FileVersion


class ProviderProbe(ProviderDraft):
    name: ProviderName | None = None
    model: ModelId | None = None


class ProviderProbeResult(BaseModel):
    elapsed_ms: int
    status: int
    method: Literal["models", "request"]
    models: list[str] = Field(default_factory=list, description="上游返回的模型 ID，按字母排序")
    model_details: list[ProbedModel] = Field(
        default_factory=list, description="与 models 一一对应的能力、来源与占用情况；只有读取模型列表时有")


class ToolCheckResult(BaseModel):
    """工具能力检测结果。上游以 4xx 拒绝工具定义时 supported 为 false 并给出原因；超时与上游故障作为错误返回。"""
    supported: bool
    elapsed_ms: int
    upstream_status: Optional[int] = None
    reason: Optional[str] = None
    suggestion: Optional[str] = None


class CatalogModelItem(BaseModel):
    """内置目录的一个模型：能力摘要与标准单价（美元／百万 Token）。"""
    id: str
    vendor: str
    vendor_label: str
    vision: bool = False
    tools: bool = True
    context_window: int
    max_output: int
    choices: list[str]
    default_choice: str
    reasoning_options: list[dict[str, object]] = Field(default_factory=list)
    reasoning_ordered: bool = False
    reasoning_family: Optional[str] = None
    temperature_when: Literal["always", "disabled", "never"] = "always"
    temperature_max: Optional[float] = None
    rates: Optional[TokenRates] = None
    has_builtin_pricing: bool = False


class CatalogResponse(BaseModel):
    price_version: str
    models: list[CatalogModelItem] = Field(default_factory=list)
