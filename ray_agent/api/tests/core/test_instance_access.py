"""实例令牌、资源票据、worker 子命令与启动失败原因。"""
import sys

import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.interfaces import instance_access
from app.interfaces.errors.exception_handlers import register_exception_handlers


@pytest.fixture
def access_app():
    app = FastAPI()
    register_exception_handlers(app)
    app.add_middleware(instance_access.InstanceAccessMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/ping")
    async def ping():
        return {"ok": True}

    @app.api_route("/api/files/{file_id}/preview/content", methods=["GET", "HEAD", "POST"], name="content")
    async def content(file_id: str):
        return {"file": file_id}

    @app.post("/api/files/{file_id}/ticket")
    async def ticket(file_id: str, request: Request):
        value, expires = instance_access.issue_ticket(request.app.url_path_for("content", file_id=file_id))
        return {"ticket": value, "expires_at": expires}

    @app.get("/outside")
    async def outside():
        return {"ok": True}

    yield TestClient(app)
    instance_access.disable_instance_token()


def test_without_token_everything_passes(access_app):
    assert access_app.get("/api/ping").status_code == 200


def test_token_is_required_for_api_and_rejections_are_structured(access_app):
    token = instance_access.enable_instance_token()
    rejected = access_app.get("/api/ping", headers={"Origin": "tauri://localhost"})
    assert rejected.status_code == 401 and rejected.json()["error"]["code"] == "unauthorized"
    assert rejected.headers["access-control-allow-origin"] == "*"
    assert access_app.get("/api/ping", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert access_app.get("/api/ping", headers={"Authorization": f"Basic {token}"}).status_code == 401
    assert access_app.get("/api/ping", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    preflight = access_app.options("/api/ping", headers={
        "Origin": "tauri://localhost", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization"})
    assert preflight.status_code == 200
    assert access_app.get("/outside").status_code == 200


def test_ticket_only_opens_its_path_for_reads_until_it_expires(access_app, monkeypatch):
    token = instance_access.enable_instance_token()
    auth = {"Authorization": f"Bearer {token}"}
    assert access_app.post("/api/files/f1/ticket").status_code == 401
    ticket = access_app.post("/api/files/f1/ticket", headers=auth).json()["ticket"]
    url = f"/api/files/f1/preview/content?ticket={ticket}"
    assert access_app.get(url).json() == {"file": "f1"}
    assert access_app.get(url).status_code == 200
    assert access_app.head(url).status_code == 200
    assert access_app.post(url).status_code == 401
    assert access_app.get(f"/api/files/f2/preview/content?ticket={ticket}").status_code == 401
    assert access_app.get(f"/api/ping?ticket={ticket}").status_code == 401
    clock = instance_access.time.monotonic() + 10_000
    monkeypatch.setattr(instance_access.time, "monotonic", lambda: clock)
    assert access_app.get(url).status_code == 401


def test_new_token_revokes_old_token_and_tickets(access_app):
    first = instance_access.enable_instance_token()
    ticket = access_app.post("/api/files/f1/ticket", headers={"Authorization": f"Bearer {first}"}).json()["ticket"]
    instance_access.enable_instance_token()
    assert access_app.get("/api/ping", headers={"Authorization": f"Bearer {first}"}).status_code == 401
    assert access_app.get(f"/api/files/f1/preview/content?ticket={ticket}").status_code == 401


def test_worker_command_uses_explicit_subcommand_when_frozen(monkeypatch):
    from core.workers import worker_command
    assert worker_command("preview-parse", "a") == [
        sys.executable, "-m", "app.infrastructure.external.file_preview.worker", "a"]
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert worker_command("preview-parse", "a", "b") == [sys.executable, "worker", "preview-parse", "a", "b"]
    import sidecar
    with pytest.raises(SystemExit, match="不支持的 worker"):
        sidecar.run_worker("app.main", [])


def test_startup_failures_carry_a_readable_reason(monkeypatch):
    from app.interfaces import core_descriptor
    from app.infrastructure.storage.sqlite import DataRootLocked, SchemaTooNew
    monkeypatch.setattr(core_descriptor, "_startup_failure", None)
    assert core_descriptor.startup_failure().details == {"reason": "startup_failed"}
    for error, reason in ((DataRootLocked("x"), "data_root_locked"), (SchemaTooNew("x"), "schema_too_new"),
                          (RuntimeError("内部细节"), "startup_failed")):
        core_descriptor.record_startup_failure(error)
        failure = core_descriptor.startup_failure()
        assert failure.details == {"reason": reason} and "内部细节" not in failure.message
