"""从 Pydantic 契约导出 OpenAPI、JSON Schema 与样例，写入 ray_agent/contracts/generated。

不启动服务、不连接数据库：OpenAPI 由 FastAPI 应用对象直接生成，事件与核心握手由 TypeAdapter 导出。
在 ray_agent/api 下运行：

    uv run --locked python scripts/contracts.py          # 重新生成
    uv run --locked python scripts/contracts.py --check  # 只比对，过期时退出码为 1
"""
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter
from pydantic.json_schema import GenerateJsonSchema

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))
OUTPUT = API_ROOT.parent / "contracts" / "generated"
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


class ContractSchema(GenerateJsonSchema):
    """字段不带标题，类型生成器只按模型与别名命名，不为每个字段生成同名类型。"""

    def field_title_should_be_set(self, schema) -> bool:
        return False


def openapi() -> dict[str, Any]:
    from app.main import app
    return app.openapi()


def _bundle(title: str, description: str, inputs: list[tuple[str, str, Any]]) -> dict[str, Any]:
    refs, schema = TypeAdapter.json_schemas(
        [(key, mode, TypeAdapter(target)) for key, mode, target in inputs], schema_generator=ContractSchema)
    return {"$schema": JSON_SCHEMA_DIALECT, "title": title, "description": description,
            "anyOf": [refs[(key, mode)] for key, mode, _ in inputs], "$defs": schema["$defs"]}


def event_schema() -> dict[str, Any]:
    from app.interfaces.schemas.event import SessionEvent, StreamEvent
    return _bundle("RayAgentEvents", "会话事件信封：SessionEvent 为落库事件，StreamEvent 另含文本增量", [
        ("stream", "serialization", StreamEvent),
        ("session", "serialization", SessionEvent),
    ])


def core_schema() -> dict[str, Any]:
    from app.interfaces.schemas.core import CoreHandshake, CoreLaunch, CoreStatus
    return _bundle("RayAgentCore", "核心启动参数、stdout 握手行与状态接口数据", [
        ("launch", "validation", CoreLaunch),
        ("handshake", "serialization", CoreHandshake),
        ("status", "serialization", CoreStatus),
    ])


def samples() -> dict[str, Any]:
    """每个字段都有取值的样例，供宿主的对齐检查读取。"""
    from app.domain.models.capability import Capability, CapabilityStatus, UnavailableReason
    from app.domain.models.error import ErrorCode, ErrorInfo
    from app.interfaces.schemas.core import BuildIdentity, CoreFailed, CoreInstance, CoreLaunch, CoreReady, \
        StorageVersion

    launch = CoreLaunch(data_dir="/Users/example/Library/Application Support/com.rayagent.desktop/core",
                        env_files=["/Users/example/rayagent/.env"], env={"LOG_LEVEL": "INFO"})
    ready = CoreReady(
        port=53117,
        instance=CoreInstance(instance_id="7f3c2a9e-5b1d-4e8f-9a6c-2d4b8e1f0a35", pid=48213, started_at=1762400000000),
        build=BuildIdentity(service="api", algorithm="sha256-path-content-v1", fingerprint="0" * 64,
                            revision="1" * 40, dirty=False, built_at="2026-11-06T00:00:00+00:00"),
        storage=StorageVersion(schema_revision="0001_baseline"),
        capabilities=[
            CapabilityStatus.available(Capability.FILE_ACCESS, "由 Docker 沙箱提供"),
            CapabilityStatus.unavailable(Capability.LOCAL_COMMAND, UnavailableReason.DISABLED, "本机执行未启用"),
            CapabilityStatus.unavailable(Capability.BROWSER, UnavailableReason.COMPONENT_MISSING, "浏览器组件未安装"),
            CapabilityStatus.unavailable(Capability.FULL_TEXT_SEARCH, UnavailableReason.DEPENDENCY_UNAVAILABLE,
                                         "索引服务不可用"),
            CapabilityStatus.unavailable(Capability.SEMANTIC_INDEX, UnavailableReason.COMPONENT_FAILED, "组件校验失败"),
            CapabilityStatus.unavailable(Capability.OCR, UnavailableReason.PERMISSION_DENIED, "缺少系统授权"),
            CapabilityStatus.unavailable(Capability.REMOTE_CONTROL, UnavailableReason.NOT_IMPLEMENTED, "尚未实现"),
        ],
        instance_token="example-token",
    )
    failed = CoreFailed(error=ErrorInfo(code=ErrorCode.UNAVAILABLE, message="核心初始化失败，详见 stderr 日志",
                                        retryable=True, retry_after_ms=1000, resource_version=3,
                                        details={"stage": "lifespan"}))
    return {"samples/core-launch.json": launch.model_dump(mode="json"),
            "samples/core-ready.json": ready.model_dump(mode="json"),
            "samples/core-failed.json": failed.model_dump(mode="json")}


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def artifacts() -> dict[str, str]:
    files = {"openapi.json": openapi(), "events.schema.json": event_schema(), "core.schema.json": core_schema(),
             **samples()}
    return {name: _dump(value) for name, value in files.items()}


def stale(expected: dict[str, str], output: Path = OUTPUT) -> list[str]:
    """与磁盘不一致的文件；JSON 产物只由本脚本维护，多出的旧文件同样算过期。"""
    present = {path.relative_to(output).as_posix() for path in output.rglob("*.json")} if output.exists() else set()
    changed = [name for name, text in expected.items()
               if not (output / name).is_file() or (output / name).read_text(encoding="utf-8") != text]
    return sorted(changed + sorted(present - expected.keys()))


def write(expected: dict[str, str], output: Path = OUTPUT) -> None:
    for name in sorted({path.relative_to(output).as_posix() for path in output.rglob("*.json")} - expected.keys()
                       if output.exists() else ()):
        (output / name).unlink()
    for name, text in expected.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")


def main(argv: list[str]) -> int:
    expected = artifacts()
    if "--check" in argv:
        outdated = stale(expected)
        if outdated:
            print("契约生成结果已过期：" + "、".join(outdated), file=sys.stderr)
            print("在 ray_agent/contracts 运行 npm run generate 后提交生成结果", file=sys.stderr)
            return 1
        print("契约生成结果与 Pydantic 定义一致")
        return 0
    write(expected)
    print(f"已写入 {len(expected)} 个契约文件到 {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
