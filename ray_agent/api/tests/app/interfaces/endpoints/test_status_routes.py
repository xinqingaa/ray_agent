#!/usr/bin/env python
# -*- coding: utf-8 -*-
from fastapi.testclient import TestClient


def test_get_status(client: TestClient) -> None:
    """真实生命周期下读取核心状态：依赖服务全部正常，返回协议、实例与能力声明"""
    response = client.get("/api/status")
    status = response.json()["data"]

    assert response.status_code == 200
    assert status["healthy"] is True and {item["service"] for item in status["services"]} == {"postgres", "redis"}
    assert status["protocol_version"] >= 1 and status["instance"]["instance_id"]
    assert len(status["capabilities"]) == 7
