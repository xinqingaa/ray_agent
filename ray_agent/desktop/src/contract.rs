//! 宿主使用的核心契约：启动参数、stdout 握手行与能力声明。
//! 来源是核心的 Pydantic 模型，导出在 ray_agent/contracts/generated；字段或枚举值不一致时对齐检查失败。
use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreLaunch {
    pub data_dir: PathBuf,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum CoreHandshake {
    Ready(CoreReady),
    Failed(CoreFailed),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreReady {
    pub protocol_version: u32,
    pub event_version: u32,
    pub instance: CoreInstance,
    pub build: BuildIdentity,
    pub storage: Option<StorageVersion>,
    pub capabilities: Vec<CapabilityStatus>,
    pub port: u16,
    pub instance_token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreFailed {
    pub protocol_version: u32,
    pub error: ErrorInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreInstance {
    pub instance_id: String,
    pub pid: u32,
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildIdentity {
    pub service: String,
    pub algorithm: Option<String>,
    pub fingerprint: Option<String>,
    pub revision: Option<String>,
    pub dirty: Option<bool>,
    pub built_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageVersion {
    pub schema_revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityStatus {
    pub capability: Capability,
    pub state: CapabilityState,
    pub reason: Option<UnavailableReason>,
    pub recoverable: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorInfo {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
    pub resource_version: Option<ResourceVersion>,
    pub details: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ResourceVersion {
    Number(i64),
    Text(String),
}

macro_rules! contract_enum {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            #[allow(dead_code)]
            pub const ALL: &'static [$name] = &[$($name::$variant),+];
        }
    };
}

contract_enum!(Capability {
    FileAccess,
    LocalCommand,
    Browser,
    FullTextSearch,
    SemanticIndex,
    Ocr,
    RemoteControl,
});

contract_enum!(CapabilityState { Available, Unavailable });

contract_enum!(UnavailableReason {
    NotImplemented,
    ComponentMissing,
    ComponentFailed,
    Disabled,
    PermissionDenied,
    DependencyUnavailable,
});

contract_enum!(ErrorCode {
    InvalidRequest,
    ValidationFailed,
    Unauthorized,
    Forbidden,
    NotFound,
    MethodNotAllowed,
    Conflict,
    Gone,
    PayloadTooLarge,
    RangeNotSatisfiable,
    ContextLimit,
    RateLimited,
    InternalError,
    UpstreamError,
    Unavailable,
    Timeout,
});

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use std::collections::BTreeSet;

    const SCHEMA: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/generated/core.schema.json"));
    const LAUNCH: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/generated/samples/core-launch.json"));
    const READY: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/generated/samples/core-ready.json"));
    const FAILED: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../contracts/generated/samples/core-failed.json"));

    fn schema() -> Value {
        serde_json::from_str(SCHEMA).unwrap()
    }

    fn definition<'a>(schema: &'a Value, name: &str) -> &'a Value {
        schema["$defs"].get(name).unwrap_or_else(|| panic!("契约中没有 {name}"))
    }

    /// 样例反序列化（未知字段即失败）后再序列化，必须与样例完全一致。
    fn round_trip<T: Serialize + DeserializeOwned>(sample: &str) -> (T, Value) {
        let expected: Value = serde_json::from_str(sample).unwrap();
        let parsed: T = serde_json::from_value(expected.clone()).expect("样例不符合宿主类型");
        assert_eq!(serde_json::to_value(&parsed).unwrap(), expected, "宿主类型与样例字段不一致");
        (parsed, expected)
    }

    fn assert_fields(value: &Value, schema: &Value, name: &str) {
        let actual: BTreeSet<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        let declared: BTreeSet<&str> = definition(schema, name)["properties"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(actual, declared, "{name} 的字段与契约不一致");
    }

    fn assert_variants<T: Serialize>(all: &[T], schema: &Value, name: &str) {
        let actual: Vec<Value> = all.iter().map(|item| serde_json::to_value(item).unwrap()).collect();
        assert_eq!(&Value::Array(actual), &definition(schema, name)["enum"], "{name} 的取值与契约不一致");
    }

    #[test]
    fn launch_matches_contract() {
        let schema = schema();
        let (_, value) = round_trip::<CoreLaunch>(LAUNCH);
        assert_fields(&value, &schema, "CoreLaunch");
        let minimal: CoreLaunch = serde_json::from_str(r#"{"data_dir": "/tmp/core"}"#).unwrap();
        assert!(minimal.env.is_empty());
    }

    #[test]
    fn host_supports_the_contract_versions() {
        let ready: Value = serde_json::from_str(READY).unwrap();
        assert_eq!(ready["protocol_version"], crate::sidecar::PROTOCOL_VERSION, "宿主支持的协议版本与核心契约不一致");
        assert_eq!(ready["event_version"], crate::sidecar::EVENT_VERSION, "宿主支持的事件版本与核心契约不一致");
    }

    #[test]
    fn ready_handshake_matches_contract() {
        let schema = schema();
        let (handshake, value) = round_trip::<CoreHandshake>(READY);
        let CoreHandshake::Ready(ready) = handshake else { panic!("样例应为就绪握手") };
        assert_fields(&value, &schema, "CoreReady");
        assert_fields(&value["instance"], &schema, "CoreInstance");
        assert_fields(&value["build"], &schema, "BuildIdentity");
        assert_fields(&value["storage"], &schema, "StorageVersion");
        for capability in value["capabilities"].as_array().unwrap() {
            assert_fields(capability, &schema, "CapabilityStatus");
        }
        assert_eq!(ready.capabilities.len(), Capability::ALL.len());
    }

    #[test]
    fn failed_handshake_matches_contract() {
        let schema = schema();
        let (handshake, value) = round_trip::<CoreHandshake>(FAILED);
        assert!(matches!(handshake, CoreHandshake::Failed(_)));
        assert_fields(&value, &schema, "CoreFailed");
        assert_fields(&value["error"], &schema, "ErrorInfo");
    }

    #[test]
    fn enum_values_match_contract() {
        let schema = schema();
        assert_variants(Capability::ALL, &schema, "Capability");
        assert_variants(CapabilityState::ALL, &schema, "CapabilityState");
        assert_variants(UnavailableReason::ALL, &schema, "UnavailableReason");
        assert_variants(ErrorCode::ALL, &schema, "ErrorCode");
    }

    #[test]
    fn unknown_handshake_field_is_rejected() {
        let mut value: Value = serde_json::from_str(READY).unwrap();
        value["unexpected"] = Value::Bool(true);
        assert!(serde_json::from_value::<CoreHandshake>(value).is_err());
    }
}
