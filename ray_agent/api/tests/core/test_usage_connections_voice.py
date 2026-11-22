"""在实际 API 与 SQLite 上验证用量和配置，只替换上游网络。"""
import io
import json
import os
import sqlite3
import wave
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from alembic import command
from fastapi import FastAPI
from sqlalchemy import select

from app.application.services.usage_service import UsageService
from app.domain.models.session import Session
from app.domain.services.usage_pricing import deepseek_asr_charge
from app.infrastructure.external.llm import openai_llm
from app.infrastructure.models.usage import UsageModel
from app.infrastructure.storage.sqlite import _alembic_config, get_database, set_database
from app.interfaces.endpoints import app_config_routes, model_connection_routes, usage_routes
from app.interfaces.errors.exception_handlers import register_exception_handlers
from tests.support.sqlite_db import with_database


def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        audio.writeframes(bytes(32000))
    return buffer.getvalue()


@pytest.mark.parametrize("already_has_total", [False, True])
def test_upgrade_both_0012_usage_schemas(tmp_path, already_has_total):
    path = tmp_path / "rayagent.db"
    command.upgrade(_alembic_config(path), "0012_model_usage")
    session = Session()
    timestamp = "2026-11-20 09:00:00"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """INSERT INTO sessions (id, title, title_source, status, unread_message_count, latest_message,
            next_event_seq, memories, files, created_at, updated_at)
            VALUES (?, '', 'manual', 'pending', 0, '', 1, '{}', '[]', ?, ?)""",
            (session.id, timestamp, timestamp),
        )
        if already_has_total:
            connection.execute("ALTER TABLE model_usage ADD COLUMN total_tokens INTEGER")
        connection.executemany(
            """INSERT INTO model_usage
            (started_at, session_id, purpose, provider, model, failed, input_tokens, output_tokens, cost_nano_usd)
            VALUES (?, ?, 'main', 'deepseek', 'deepseek-flash', ?, ?, ?, ?)""",
            [(timestamp, session.id, False, 10, 20, 800), (timestamp, session.id, True, None, None, None)],
        )
        if already_has_total:
            connection.execute("UPDATE model_usage SET total_tokens=50 WHERE failed=0")

    async def scenario(write, read, _database):
        service = UsageService(write, read)
        totals = await service.session(session.id)
        report = await service.report("24h", None, None, None, now=datetime(2026, 11, 20, 10, tzinfo=timezone.utc),
                                      zone=timezone.utc)
        assert totals == report.totals
        assert totals.requests == 2 and totals.failed_requests == 1
        assert totals.total_tokens == (50 if already_has_total else 30)
        assert totals.cost_nano_usd == 800
        friday_nine = report.hours[4 * 24 + 9]
        assert friday_nine.deepseek_peak and friday_nine.top_model_counts == {"deepseek-flash": 2}
        assert report.hours[4 * 24 + 6].deepseek_peak and not report.hours[4 * 24 + 6].requests
        assert not report.hours[5 * 24 + 9].deepseek_peak
        assert report.calendar[-1].top_model_counts == {"deepseek-flash": 2}
        async with read() as uow:
            rows = (await uow.db_session.scalars(select(UsageModel).order_by(UsageModel.id))).all()
            assert rows[1].total_tokens is None

    with_database(tmp_path, scenario)
    backup, = (tmp_path / "upgrades").glob("rayagent.db.before-0012_model_usage-to-0014_file_change_entries-*")
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == ("0012_model_usage",)
        assert connection.execute("SELECT count(*) FROM model_usage").fetchone() == (2,)


def test_provider_toml_usage_and_deepseek_voice(tmp_path, isolated_model_connections, monkeypatch):
    secret = "fake-model-key-1234"
    upstream_ok = True
    voice_ok = True
    voice_requests = 0
    model_requests = 0

    def upstream(request):
        nonlocal voice_requests, model_requests
        assert request.headers["authorization"] == f"Bearer {secret}"
        if request.url.path == "/v1/tools/asr":
            assert request.url.host == "api.deepseek.com"
            assert b'name="file"; filename="recording.wav"' in request.content
            assert wav_bytes() in request.content
            voice_requests += 1
            return httpx.Response(200, json={"request_id": "asr-1", "text": "中文转写", "duration_ms": 1001}) if voice_ok else (
                httpx.Response(429, json={"error": {"message": "限流 " + secret}}))
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "test/custom"}]})
        assert request.url.path == "/v1/chat/completions"
        body = json.loads(request.content)
        assert body["model"] == "test/custom"
        assert "parallel_tool_calls" not in body and "thinking" not in body
        model_requests += 1
        if not upstream_ok:
            return httpx.Response(400, json={"error": {"message": "unsupported protocol " + secret}})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
                                        "usage": {"prompt_tokens": 100, "completion_tokens": 40,
                                                  "prompt_tokens_details": {"cached_tokens": 25}}})

    client_class = httpx.AsyncClient

    original_init = client_class.__init__

    def routed_client(self, *args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(upstream))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(client_class, "__init__", routed_client)
    shared_transport = httpx.MockTransport(upstream)
    source = isolated_model_connections
    source.write_text("# keep top\nexternal = 'keep'\n[providers.my-deepseek]\nunknown = 'future value' # preserve\n")

    async def scenario(write, read, database):
        nonlocal upstream_ok, voice_ok
        set_database(database)
        app = FastAPI()
        for router in (app_config_routes.router, model_connection_routes.router, usage_routes.router):
            app.include_router(router, prefix="/api")
        register_exception_handlers(app)
        session = Session()
        async with write() as uow:
            await uow.session.save(session)

        async with client_class(transport=httpx.ASGITransport(app=app), base_url="http://test") as client, \
                client_class(transport=shared_transport) as model_http:
            monkeypatch.setattr(openai_llm, "_http_client", lambda: model_http)
            base = "/api/app-config/llm/providers"
            state = (await client.get(base)).json()["data"]
            draft = {"base_url": "https://api.deepseek.com/v1", "api_key": secret, "kind": "deepseek",
                     "protocol": "chat_completions", "custom_models": {"test/custom": {
                         "context_window": 16000, "max_output": 2000, "rates": {"input": "1", "cached_input": "0.5", "output": "2"},
                     }}}
            saved = await client.put(base + "/my-deepseek", json={**draft, "version": state["version"]})
            assert saved.status_code == 200, saved.text
            current = saved.json()["data"]
            assert current["providers"][0]["key_hint"] == "••••1234" and secret not in saved.text
            assert os.stat(source).st_mode & 0o777 == 0o600
            assert "# keep top" in source.read_text() and "external = 'keep'" in source.read_text()
            with source.open("a") as file:
                file.write("\n# external edit\n")
            keyless = {key: value for key, value in draft.items() if key != "api_key"}
            conflict = await client.put(base + "/my-deepseek", json={**keyless, "version": current["version"]})
            assert conflict.status_code == 409
            latest = conflict.json()["error"]["resource_version"]
            saved = await client.put(base + "/my-deepseek", json={**keyless, "version": latest})
            assert saved.status_code == 200, saved.text
            assert "# external edit" in source.read_text() and secret in source.read_text()
            assert "unknown = 'future value' # preserve" in source.read_text()
            model = (await client.get("/api/app-config/models")).json()["data"]["models"][0]
            assert model["id"] == "test/custom" and model["context_window"] == 16000 and model["max_output"] == 2000

            invalid = await client.put(base + "/my-deepseek", json={**draft, "version": "invalid"})
            assert invalid.status_code == 422 and secret not in invalid.text
            probe = {**keyless, "name": "my-deepseek", "model": "test/custom"}
            models = await client.post(base + "/models", json=probe)
            assert models.json()["data"]["models"] == ["test/custom"]
            ok = await client.post(base + "/test", json=probe)
            assert ok.status_code == 200, ok.text
            upstream_ok = False
            failed = await client.post(base + "/test", json=probe)
            assert failed.status_code == 502 and failed.json()["error"]["details"]["upstream_status"] == 400
            assert "unsupported protocol" in failed.text and secret not in failed.text
            assert model_requests == 2

            url = f"/api/voice/transcriptions?session_id={session.id}"
            headers = {"Content-Type": "audio/wav"}
            assert (await client.post(url, content=wav_bytes(), headers=headers)).status_code == 400
            assert voice_requests == 0
            # 未选择时 voice 为 null；只改其他偏好不会把它写成 off。
            assert (await client.get("/api/usage/preferences")).json()["data"]["voice"] is None
            assert (await client.patch("/api/usage/preferences", json={"show_conversation_cost": False})).json()["data"]["voice"] is None
            assert (await client.patch("/api/usage/preferences", json={"show_conversation_cost": True})).status_code == 200
            assert (await client.patch("/api/usage/preferences", json={"voice": "deepseek"})).status_code == 200
            assert (await client.post(url, content=b"invalid", headers=headers)).status_code == 400
            voice_ok = False
            assert (await client.post(url, content=wav_bytes(), headers=headers)).status_code == 429
            voice_ok = True
            transcript = await client.post(url, content=wav_bytes(), headers=headers)
            assert transcript.json()["data"] == {"request_id": "asr-1", "text": "中文转写", "duration_ms": 1001}
            assert voice_requests == 2
            cost = deepseek_asr_charge(1001).cost_nano_usd
            for range_id in ("today", "24h", "3d", "7d", "30d", "90d"):
                report = (await client.get("/api/usage", params={"range_id": range_id, "provider": "my-deepseek"})).json()["data"]
                assert report["totals"]["requests"] == 4 and report["totals"]["failed_requests"] == 2
                assert report["totals"]["cost_nano_usd"] == cost + 167500
                assert sum(bucket["requests"] for bucket in report["buckets"]) == 4
                assert len(report["hours"]) == 168 and len(report["calendar"]) == 91
            session_usage = (await client.get(f"/api/usage/sessions/{session.id}")).json()["data"]
            assert session_usage["requests"] == 2 and session_usage["cost_nano_usd"] == cost
            async with write() as uow:
                await uow.session.delete_by_id(session.id)
            async with read() as uow:
                rows = (await uow.db_session.scalars(select(UsageModel))).all()
                assert len(rows) == 4 and all(row.session_id is None for row in rows)
            async with write() as uow:
                await uow.usage.clear()
            assert (await client.get("/api/usage")).json()["data"]["totals"]["requests"] == 0
            delete_version = (await client.get(base)).json()["data"]["version"]
            assert (await client.delete(base + "/my-deepseek", params={"version": delete_version})).status_code == 200
            assert (await client.get("/api/app-config/models")).json()["data"]["models"] == []

    try:
        previous = get_database()
    except RuntimeError:
        previous = None
    try:
        with_database(tmp_path / "db", scenario)
    finally:
        set_database(previous)


def test_custom_buckets_and_previous_period_at_half_hour_offset(tmp_path):
    zone = ZoneInfo("Asia/Kolkata")
    start = datetime(2026, 11, 20, 14, tzinfo=zone)
    end = start + timedelta(hours=2)

    async def scenario(write, read, _database):
        async with write() as uow:
            for stamp, amount in [(start - timedelta(hours=1), 200), (start, 300),
                                  (start + timedelta(hours=1), None), (end, 400)]:
                await uow.usage.add(started_at=stamp, session_id=None, run_id=None, workspace_id=None,
                                    purpose="compact", provider="test", model="model", failed=False, cost_nano_usd=amount)
        service = UsageService(write, read)
        report = await service.report("custom", start.astimezone(timezone.utc), end.astimezone(timezone.utc), None,
                                      now=end + timedelta(hours=2), zone=zone)
        assert report.end == end and report.previous_start == start - timedelta(hours=2)
        assert report.previous.cost_nano_usd == 200 and report.totals.cost_nano_usd == 300
        assert report.totals.requests == 2 and report.totals.unpriced_requests == 1
        assert [bucket.start.hour for bucket in report.buckets] == [14, 15]
        assert [bucket.cost_nano_usd for bucket in report.buckets] == [300, None]
        assert report.hours[4 * 24 + 14].top_models == ["model"]
        assert report.calendar[-1].cost_nano_usd == 900

    with_database(tmp_path, scenario)


def test_waiting_run_keeps_connection_until_restart(tmp_path, isolated_model_connections):
    from pytest import raises

    from app.application.errors.exceptions import ConflictError
    from app.application.services.agent_service import AgentService
    from app.domain.models.session import SessionStatus
    from app.domain.services.run_connections import run_connections
    from app.domain.services.run_ledger import RunLedger
    from app.infrastructure.repositories.db_app_config_repository import DBAppConfigRepository

    config_file = isolated_model_connections
    original = """[providers.gateway]
base_url = "https://original.test/v1"
api_key = "test-original-secret"
protocol = "responses"

[providers.gateway.custom_models.worker]
context_window = 32000
max_output = 1024
"""
    config_file.write_text(original)

    async def scenario(write, read, _database):
        session = Session(model_id="worker", reasoning="disabled")
        async with write() as uow:
            await uow.session.save(session)
        ledger = RunLedger(write)
        run = await ledger.start(session.id)
        repository = DBAppConfigRepository(write, read)
        service = AgentService.__new__(AgentService)
        service._uow = write()
        service._install_id = "fixture"
        service._llm_config = (await repository.load()).llm_config
        try:
            llm = await service._llm_for_run(session, None, run.id)
            snapshot = {
                "model_name": llm.model_name, "api_protocol": llm.api_protocol,
                "context_window": llm.context_window, "max_tokens": llm.max_tokens,
                "model_connection": llm.connection_snapshot,
            }
            assert "test-original-secret" not in json.dumps(snapshot)
            async with write() as uow:
                await uow.run.save_snapshot(run.id, snapshot)
            updated = original.replace("original.test", "updated.test").replace(
                "test-original-secret", "test-replaced-secret").replace("1024", "2048")
            config_file.write_text(updated)
            service._llm_config = (await repository.load()).llm_config
            resumed = await service._llm_for_run(session, SessionStatus.WAITING, run.id)
            assert resumed.connection_endpoint.base_url.host == "original.test"
            assert resumed.max_tokens == 1024 and resumed.connection_endpoint.api_key == "test-original-secret"

            run_connections.pop(run.id)
            with raises(ConflictError, match="原运行的模型连接凭据已不可用"):
                await service._llm_for_run(session, SessionStatus.WAITING, run.id)

            config_file.write_text(updated.replace("test-replaced-secret", "test-original-secret"))
            service._llm_config = (await repository.load()).llm_config
            restarted = await service._llm_for_run(session, SessionStatus.WAITING, run.id)
            assert restarted.connection_endpoint.base_url.host == "original.test"
            assert restarted.max_tokens == 1024
        finally:
            run_connections.pop(run.id, None)

    with_database(tmp_path / "db", scenario)
