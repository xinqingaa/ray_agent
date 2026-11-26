"""模型连接：提供商的地址、密钥与协议，以及模型到提供商的映射。连接来自用户配置文件，不进业务库。"""
from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

ApiProtocol = Literal['responses', 'chat_completions']
ProviderKind = Literal["deepseek", "openai", "compatible"]
Currency = Literal["USD", "CNY"]
ModelId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^\S+$")]
EffortId = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")]
Rate = Annotated[Decimal, Field(ge=0, le=1_000_000, decimal_places=8)]
# 能力的来源：目录、上游报告，或没有依据而采用的默认值（标为未确认）
CapabilitySource = Literal["catalog", "upstream", "unconfirmed"]
# 目录外模型可以标记为未确认的能力；未确认的能力只提示，不改变请求形状
UnconfirmedCapability = Literal["context_window", "max_output", "tools", "vision", "thinking"]
RESERVED_EFFORTS = frozenset({"enabled", "disabled"})
MAX_REASONING_EFFORTS = 8


class TokenRates(BaseModel):
    """每百万 Token 单价。"""
    currency: Currency = "USD"
    input: Rate
    cached_input: Rate
    output: Rate


class CustomModel(BaseModel):
    context_window: int = Field(gt=1, le=10_000_000)
    max_output: int = Field(gt=0)
    tools: bool = False  # 文件中缺省视为关闭，保证旧配置行为不变；界面新增时未报告的工具默认开启并标未确认
    vision: bool = False
    thinking: bool = False
    # 思考档位的原词，运行时作为 reasoning_effort 发送；声明档位即等于开启思考
    reasoning_efforts: list[EffortId] = Field(default_factory=list, max_length=MAX_REASONING_EFFORTS)
    # 保存时仍未确认的能力，供选择器标注；核心不据此改变请求
    unconfirmed: list[UnconfirmedCapability] = Field(default_factory=list)
    rates: TokenRates | None = None

    @model_validator(mode="after")
    def check_window(self):
        if self.max_output >= self.context_window * 0.95:
            raise ValueError("输出上限须为输入保留上下文空间")
        if len(set(self.reasoning_efforts)) != len(self.reasoning_efforts):
            raise ValueError("思考档位不能重复")
        if RESERVED_EFFORTS.intersection(self.reasoning_efforts):
            raise ValueError("思考档位不能使用 enabled 或 disabled")
        if self.reasoning_efforts:
            self.thinking = True
        return self


class ProviderDefinition(BaseModel):
    kind: ProviderKind | None = None
    base_url: HttpUrl
    protocol: ApiProtocol = "responses"
    # 启用的模型。目录模型与目录外模型都放这里；保存时由核心按目录归类，目录外模型的声明放入 custom_models
    models: list[ModelId] = Field(default_factory=list)
    custom_models: dict[ModelId, CustomModel] = Field(default_factory=dict)
    requires_key: bool = True

    @field_validator("base_url")
    @classmethod
    def safe_url(cls, value: HttpUrl) -> HttpUrl:
        if value.username or value.password or value.query or value.fragment:
            raise ValueError("接口地址不得包含登录信息、查询参数或片段")
        return value


class LlmEndpoint(BaseModel):
    api_protocol: ApiProtocol = 'responses'
    base_url: HttpUrl
    api_key: str = Field(default="", repr=False, exclude=True)
    provider: str | None = None
    kind: ProviderKind | None = None
    requires_key: bool = True


class ProviderStatus(BaseModel):
    """设置页可见的提供商状态；密钥只给掩码。无效条目也保留可解析的地址，编辑时不回落到预设。"""
    name: str
    base_url: Optional[str] = None
    api_protocol: ApiProtocol = 'responses'
    models: list[str] = Field(default_factory=list, description="由它提供的已知模型")
    configured_models: list[ModelId] = Field(default_factory=list)
    custom_models: dict[ModelId, CustomModel] = Field(default_factory=dict)
    kind: ProviderKind = "compatible"
    requires_key: bool = True
    has_key: bool = False
    key_hint: Optional[str] = None
    issue: Optional[str] = Field(default=None, description="不可用或部分忽略的原因")


class ConnectionSource(BaseModel):
    """模型连接配置文件的读取结果。"""
    path: str
    exists: bool = False
    version: str | None = None
    issue: Optional[str] = Field(default=None, description="整份文件无法使用的原因")
    notices: list[str] = Field(default_factory=list, description="不影响使用的提醒")
    providers: list[ProviderStatus] = Field(default_factory=list)


class ProbedModel(BaseModel):
    """上游模型列表中的一项，附解析后的能力与每项的来源。claimed_by 为其他提供商已提供该模型时的名称。"""
    id: str
    catalog: bool = Field(description="是否为内置目录模型")
    claimed_by: Optional[str] = Field(default=None, description="其他提供商已提供，保存会被拒绝")
    context_window: int
    max_output: int
    tools: bool
    vision: bool
    thinking: bool
    reasoning_efforts: list[str] = Field(default_factory=list)
    rates: Optional[TokenRates] = Field(default=None, description="美元／百万 Token；没有依据时为空")
    sources: dict[str, CapabilitySource] = Field(
        description="context_window、max_output、tools、vision、thinking、reasoning_efforts、rates 各自的来源")


@dataclass(frozen=True)
class UpstreamModelReport:
    """上游模型列表里一项已解析出的字段；None 表示上游没有报告，由领域按目录或默认值补齐。"""
    id: str
    context_window: int | None = None
    max_output: int | None = None
    tools: bool | None = None
    vision: bool | None = None
    thinking: bool | None = None
    reasoning_efforts: tuple[str, ...] | None = None
    rates: TokenRates | None = None


def default_model_endpoints() -> dict[str, str]:
    """未读取配置文件时的映射，只用于直接构造的配置。"""
    return {
        "deepseek-flash": "deepseek", "deepseek-v4-pro": "deepseek",
        "gpt-6.2-sol": "gpt", "gpt-6.2-astra": "gpt",
        "gpt-6.1-sol": "gpt", "gpt-6-luna": "gpt", "gpt-6-astra": "gpt",
    }
