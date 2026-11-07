#!/usr/bin/env python
# -*- coding: utf-8 -*-
from fastapi.testclient import TestClient


def test_get_status(client: TestClient) -> None:
    """真实生命周期下读取核心状态：业务库健康，返回协议、实例、存储版本与能力声明"""
    response = client.get("/api/status")
    status = response.json()["data"]

    assert response.status_code == 200
    assert status["healthy"] is True and {item["service"] for item in status["services"]} == {"sqlite"}
    assert status["protocol_version"] >= 1 and status["instance"]["instance_id"]
    assert status["storage"] == {"schema_revision": "0007_semantic_index"}
    assert len(status["capabilities"]) == 7


def test_independent_chat_session_lifecycle_without_external_services(client: TestClient) -> None:
    """会话创建、详情、请求读回与删除只依赖本机业务库与数据根"""
    created = client.post("/api/sessions", json={}).json()["data"]["session_id"]
    detail = client.get(f"/api/sessions/{created}").json()["data"]
    assert detail["status"] == "pending" and detail["unconsumed_inputs"] == []
    missing = client.get(f"/api/sessions/{created}/requests/never-sent")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
    assert client.get("/api/data/preview").json()["data"]["counts"]["sessions"] >= 1
    assert client.post(f"/api/sessions/{created}/delete").status_code == 200
    assert client.get(f"/api/sessions/{created}").status_code == 404
