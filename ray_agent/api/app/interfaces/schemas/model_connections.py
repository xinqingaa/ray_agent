from typing import Annotated, Literal

from pydantic import BaseModel, Field, SecretStr

from app.domain.models.llm_endpoints import ModelId, ProviderDefinition

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
    models: list[str] = Field(default_factory=list)
