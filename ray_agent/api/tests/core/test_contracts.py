"""共享契约：生成结果是否过期、身份与路径校验、结构化错误、事件信封、能力声明、长操作与握手。"""
import asyncio
import json
from datetime import datetime, timedelta
from typing import get_args

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.application.errors.exceptions import ConflictError, NotFoundError, AppException
from app.application.services.capability_service import CapabilityService
from app.domain.external.browser_session import BrowserProfile
from app.domain.external.process_executor import ProcessOwner, ProcessSpec
from app.domain.external.event_notifier import OutputDelta
from app.domain.models.capability import Capability, CapabilityState, CapabilityStatus, UnavailableReason
from app.domain.models.error import ErrorCode, ErrorInfo
from app.domain.models.event import Event, MessageEvent, ToolEvent
from app.domain.models.health_status import HealthStatus
from app.domain.models.identity import RelativePath, RootKind, RootRef, RootedPath, relative_parts
from app.domain.models.operation import Operation, OperationKind, OperationScope, OperationStatus
from app.infrastructure.storage.sqlite import DatabaseBusyError
from app.domain.services.skill_packages import SkillError
from app.interfaces.endpoints.session_routes import to_session_sse
from app.interfaces.errors.exception_handlers import HTTP_STATUS, register_exception_handlers
from app.interfaces.schemas.core import CoreHandshake, CoreLaunch, CoreReady, PROTOCOL_VERSION
from app.interfaces.schemas.event import EVENT_VERSION, EventMapper, SessionEvent, StreamEvent
from app.interfaces.schemas.operation import OperationView
from scripts.contracts import artifacts, stale


def test_generated_contracts_are_current():
    outdated = stale(artifacts())
    assert not outdated, f"契约生成结果已过期：{outdated}；在 ray_agent/contracts 运行 npm run generate"


@pytest.mark.parametrize("path", ["", "a", "a/b.txt", "中文/文件 名.md", "notes:v2.md", ".rayagent/workspace.json"])
def test_relative_path_accepts_positions_inside_a_root(path):
    assert TypeAdapter(RelativePath).validate_python(path) == path
    assert RootedPath(root_id="root-1", relative_path=path).relative_path == path


@pytest.mark.parametrize("path", ["/etc/passwd", "C:/Windows", "c:file", "a\\b", "a//b", "a/./b", "../x", "a/..",
                                  "a/", ".", "a\x00b", "a/\x7f", "x" * 4097])
def test_relative_path_rejects_absolute_traversal_and_ambiguous_forms(path):
    with pytest.raises(ValidationError):
        TypeAdapter(RelativePath).validate_python(path)


def test_relative_parts_and_root_owner():
    assert relative_parts("") == () and relative_parts("a/b") == ("a", "b")
    assert RootRef(root_id="r1", kind=RootKind.WORKSPACE_FOLDER, workspace_id="w1").workspace_id == "w1"
    assert RootRef(root_id="r2", kind=RootKind.SESSION_WORKDIR, session_id="s1", workspace_id="w1").session_id == "s1"
    with pytest.raises(ValidationError):
        RootRef(root_id="r1", kind=RootKind.WORKSPACE_FOLDER, session_id="s1")
    with pytest.raises(ValidationError):
        RootRef(root_id="r2", kind=RootKind.SESSION_WORKDIR)
    with pytest.raises(ValidationError):
        RootedPath(root_id="has space", relative_path="a")


def error_app() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    class Body(BaseModel):
        count: int

    @app.get("/missing")
    async def missing():
        raise NotFoundError("会话不存在")

    @app.get("/stale")
    async def stale_version():
        raise ConflictError("版本已变化", resource_version=4, details={"content": "最新"})

    @app.get("/busy")
    async def busy():
        raise AppException(ErrorCode.RATE_LIMITED, "稍后再试", retry_after_ms=1500)

    @app.get("/skill")
    async def skill():
        raise SkillError("上传过大", 413)

    @app.get("/database-busy")
    async def database_busy():
        raise DatabaseBusyError("业务库被其他连接占用，请稍后重试")

    @app.post("/body")
    async def body(payload: Body):
        return payload

    @app.get("/boom")
    async def boom():
        raise RuntimeError("内部细节")

    return TestClient(app, raise_server_exceptions=False)


def test_every_failure_is_one_structured_error_shape():
    client = error_app()
    cases = {
        ("get", "/missing"): (404, "not_found"),
        ("get", "/stale"): (409, "conflict"),
        ("get", "/busy"): (429, "rate_limited"),
        ("get", "/skill"): (413, "payload_too_large"),
        ("get", "/database-busy"): (503, "unavailable"),
        ("post", "/body"): (422, "validation_failed"),
        ("get", "/no-such-route"): (404, "not_found"),
        ("post", "/missing"): (405, "method_not_allowed"),
        ("get", "/boom"): (500, "internal_error"),
    }
    for (method, path), (status, code) in cases.items():
        response = client.post(path, json={"count": "x"}) if method == "post" else client.get(path)
        body = response.json()
        assert response.status_code == status and set(body) == {"error"}, (path, body)
        error = ErrorInfo.model_validate(body["error"])
        assert error.code == code and error.message, (path, body)
    assert client.get("/boom").json()["error"]["message"] == "服务器出现异常请稍后重试"
    stale_error = client.get("/stale").json()["error"]
    assert stale_error["resource_version"] == 4 and stale_error["details"] == {"content": "最新"}
    assert stale_error["retryable"] is False
    busy = client.get("/busy")
    assert busy.json()["error"]["retryable"] is True and busy.headers["retry-after"] == "2"
    database_busy = client.get("/database-busy")
    assert database_busy.json()["error"]["retryable"] is True and database_busy.headers["retry-after"] == "1"
    assert client.post("/body", json={"count": "x"}).json()["error"]["details"]["errors"][0]["loc"] == ["body", "count"]


def test_every_error_code_has_an_http_status():
    assert set(HTTP_STATUS) == set(ErrorCode)


def test_every_domain_event_has_an_envelope_in_the_closed_union():
    domain_types = {model.model_fields["type"].default for model in get_args(get_args(Event)[0])}
    session_types = {cls.model_fields["event"].default for cls in get_args(SessionEvent.__value__.__origin__)}
    assert domain_types == set(EventMapper._mapping) == session_types
    stream_types = {cls.model_fields["event"].default for cls in get_args(StreamEvent.__value__.__origin__)}
    assert stream_types == session_types | {"delta"}
    with pytest.raises(ValidationError):
        TypeAdapter(SessionEvent).validate_python({"event": "unknown", "data": {}})


def test_sse_frames_are_the_envelope_with_version_and_sequence():
    message = MessageEvent(role="assistant", message="好", seq=7, run_id="run-1")
    frame = to_session_sse(message)
    data = json.loads(frame.data)
    assert (frame.event, frame.id) == ("message", "7")
    assert data["seq"] == 7 and data["run_id"] == "run-1" and data["event_version"] == EVENT_VERSION
    envelope = TypeAdapter(StreamEvent).validate_python({"event": frame.event, "data": data})
    assert envelope.data.message == "好"
    delta = to_session_sse(OutputDelta("session-1", "run-1", 2, 1, "片"))
    assert delta.event == "delta" and not delta.id and json.loads(delta.data)["event_version"] == EVENT_VERSION
    tool = ToolEvent(tool_call_id="c1", tool_name="file", function_name="read_file", function_args={}, seq=8)
    detail = EventMapper.events_to_sse_events([message, tool])
    assert [item.event for item in detail] == ["message", "tool"]
    assert TypeAdapter(list[SessionEvent]).validate_python([item.model_dump() for item in detail])[1].data.seq == 8


def test_capabilities_report_files_available_and_execution_closed_until_ports():
    current = asyncio.run(CapabilityService().current())
    assert [item.capability for item in current] == list(Capability)
    by_name = {item.capability: item for item in current}
    assert by_name[Capability.FILE_ACCESS].state is CapabilityState.AVAILABLE and by_name[Capability.FILE_ACCESS].detail
    # 未装配 probe 时：本机命令与浏览器给出可恢复依赖原因，其余仍是未实现
    assert by_name[Capability.LOCAL_COMMAND].reason is UnavailableReason.DEPENDENCY_UNAVAILABLE
    assert by_name[Capability.LOCAL_COMMAND].recoverable is True
    assert by_name[Capability.BROWSER].reason is UnavailableReason.COMPONENT_MISSING
    assert by_name[Capability.BROWSER].recoverable is True
    # 全文检索始终可用；语义／OCR 缺组件时可恢复；远程控制尚未实现
    assert by_name[Capability.FULL_TEXT_SEARCH].state is CapabilityState.AVAILABLE
    assert by_name[Capability.FULL_TEXT_SEARCH].reason is None and by_name[Capability.FULL_TEXT_SEARCH].detail
    for name in (Capability.SEMANTIC_INDEX, Capability.OCR):
        assert by_name[name].state is CapabilityState.UNAVAILABLE and by_name[name].detail
        assert by_name[name].reason is UnavailableReason.COMPONENT_MISSING and by_name[name].recoverable is True
    assert by_name[Capability.REMOTE_CONTROL].state is CapabilityState.UNAVAILABLE
    assert by_name[Capability.REMOTE_CONTROL].reason is UnavailableReason.NOT_IMPLEMENTED
    assert by_name[Capability.REMOTE_CONTROL].recoverable is False
    with pytest.raises(ValidationError):
        CapabilityStatus(capability=Capability.OCR, state=CapabilityState.UNAVAILABLE)
    with pytest.raises(ValidationError):
        CapabilityStatus(capability=Capability.OCR, state=CapabilityState.UNAVAILABLE,
                         reason=UnavailableReason.NOT_IMPLEMENTED, recoverable=True)


def test_operation_states_cancel_and_retry():
    start = datetime(2026, 11, 6, 12, 0, 0)
    scope = OperationScope(kind="workspace", workspace_id="w1")
    queued = Operation(operation_id="op-1", kind=OperationKind.DOCUMENT_INDEX, scope=scope, created_at=start,
                       updated_at=start)
    assert queued.can_cancel and not queued.can_retry and not queued.status.terminal
    cancelling = queued.model_copy(update={"status": OperationStatus.RUNNING, "phase": "parsing",
                                           "cancel_requested_at": start + timedelta(seconds=1)})
    assert not cancelling.can_cancel and not cancelling.status.terminal
    failed = Operation.model_validate({**queued.model_dump(), "status": "failed", "retry_supported": True,
                                       "finished_at": start + timedelta(seconds=2),
                                       "error": ErrorInfo.of(ErrorCode.UPSTREAM_ERROR, "解析失败")})
    assert failed.can_retry and not failed.can_cancel
    view = OperationView.from_operation(failed).model_dump(mode="json")
    assert view["status"] == "failed" and view["error"]["code"] == "upstream_error"
    assert view["finished_at"] - view["created_at"] == 2000 and view["can_retry"] is True
    with pytest.raises(ValidationError):
        Operation.model_validate({**queued.model_dump(), "status": "failed"})
    with pytest.raises(ValidationError):
        OperationScope(kind="app", workspace_id="w1")
    with pytest.raises(ValidationError):
        OperationScope(kind="session")


def test_execution_port_values_are_platform_neutral():
    owner = ProcessOwner(run_id="run-1")
    cwd = RootedPath(root_id="workspace-root")
    assert ProcessSpec(shell_command="ls", cwd=cwd, owner=owner).argv is None
    assert ProcessSpec(argv=["python3", "-V"], cwd=cwd, owner=owner).shell_command is None
    for invalid in ({}, {"argv": ["a"], "shell_command": "a"}, {"argv": []}):
        with pytest.raises(ValidationError):
            ProcessSpec(cwd=cwd, owner=owner, **invalid)
    with pytest.raises(ValidationError):
        ProcessOwner(session_id="s1")
    with pytest.raises(ValidationError):
        BrowserProfile(workspace_id="w1", session_id="s1")


def test_handshake_is_discriminated_and_launch_is_validated():
    sample = json.loads(artifacts()["samples/core-ready.json"])
    ready = TypeAdapter(CoreHandshake).validate_python(sample)
    assert isinstance(ready, CoreReady) and ready.protocol_version == PROTOCOL_VERSION
    failed = TypeAdapter(CoreHandshake).validate_json(artifacts()["samples/core-failed.json"])
    assert failed.event == "failed" and failed.error.code is ErrorCode.UNAVAILABLE
    launch = CoreLaunch.model_validate_json('{"data_dir": "/tmp/core", "host_secret": "0123456789abcdef"}')
    assert launch.env == {}
    with pytest.raises(ValidationError):
        CoreLaunch.model_validate_json('{"env": {}, "host_secret": "0123456789abcdef"}')
    with pytest.raises(ValidationError):
        CoreLaunch.model_validate_json('{"data_dir": "/tmp/core"}')
    with pytest.raises(ValidationError):
        CoreLaunch.model_validate_json('{"data_dir": "/tmp/core", "host_secret": "short"}')
    with pytest.raises(ValidationError):
        TypeAdapter(CoreHandshake).validate_python({**sample, "instance_token": None})


def test_status_route_reports_degraded_services_without_failing(monkeypatch):
    from app.interfaces import core_descriptor
    from app.interfaces.endpoints import status_routes
    monkeypatch.setattr(core_descriptor, "_storage", None)
    from app.interfaces.service_dependencies import get_capability_service, get_status_service

    class Checks:
        async def check_all(self):
            return [HealthStatus(service="sqlite", status="error", details="业务库未初始化")]

    app = FastAPI()
    app.include_router(status_routes.router, prefix="/api")
    app.dependency_overrides[get_status_service] = lambda: Checks()
    app.dependency_overrides[get_capability_service] = lambda: CapabilityService()
    response = TestClient(app).get("/api/status")
    status = response.json()["data"]
    assert response.status_code == 200 and status["healthy"] is False
    assert status["protocol_version"] == PROTOCOL_VERSION and status["event_version"] == EVENT_VERSION
    assert status["storage"] is None and status["instance"]["instance_id"]
    assert [item["capability"] for item in status["capabilities"]] == [item.value for item in Capability]
