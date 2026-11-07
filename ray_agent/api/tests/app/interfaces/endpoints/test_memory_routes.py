"""工作方式、记忆、检索与“本次参考”接口：真实应用生命周期与临时数据根，不调用模型。"""
import pytest
from fastapi.testclient import TestClient

from app.interfaces.host_access import HOST_SECRET_HEADER, set_host_secret

SECRET = "host-secret-for-tests-0123456789"


@pytest.fixture()
def host(client: TestClient, tmp_path, monkeypatch):
    from core.config import get_settings
    monkeypatch.setattr(get_settings(), "workspace_blocked_paths", [])
    set_host_secret(SECRET)
    location = tmp_path / "workspaces"
    location.mkdir()
    grant = client.post("/api/host/folder-grants", json={"path": str(location)},
                        headers={HOST_SECRET_HEADER: SECRET}).json()["data"]["grant_id"]
    assert client.post("/api/workspaces/default-location", json={"grant_id": grant}).status_code == 200
    yield client
    set_host_secret(None)


def data(response, status=200):
    assert response.status_code == status, response.text
    return response.json()["data"] if status < 300 else response.json()["error"]


def test_instruction_memory_search_and_manifest_over_http(host: TestClient):
    created = data(host.post("/api/workspaces", json={"name": "记忆接口", "instruction": "只用简体中文回答"}))
    wid = created["id"]
    assert created["instruction_version"] == 1 and created["instruction_preview"] == "只用简体中文回答"
    assert created["auto_memory_enabled"] is True

    current = data(host.get(f"/api/workspaces/{wid}/instruction"))
    assert current["body"] == "只用简体中文回答" and current["source"] == "user_edit"
    updated = data(host.put(f"/api/workspaces/{wid}/instruction",
                            json={"body": "回答要简洁", "version": current["workspace_version"]}))
    assert updated["instruction_version"] == 2
    stale = data(host.put(f"/api/workspaces/{wid}/instruction",
                          json={"body": "过期", "version": current["workspace_version"]}), 409)
    assert stale["code"] == "conflict" and stale["resource_version"] == updated["workspace_version"]
    assert host.put(f"/api/workspaces/{wid}/instruction",
                    json={"body": "x" * 4001, "version": updated["workspace_version"]}).status_code == 422
    assert data(host.get(f"/api/workspaces/{wid}/instruction/proposals"))["proposals"] == []

    # 记忆：新增、钉住、编辑、撤回、撤销；版本不符返回 409
    memory = data(host.post(f"/api/workspaces/{wid}/memories", json={"content": "季度评审在周四", "memory_type": "decision"}))
    assert memory["certainty"] == "user_confirmed" and memory["origin"] == "user" and memory["resident"] is True
    pinned = data(host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                             json={"action": "pin", "version": memory["version"]}))
    assert pinned["pinned"] is True and pinned["version"] == memory["version"] + 1
    assert data(host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                           json={"action": "unpin", "version": memory["version"]}), 409)["resource_version"] == 2
    edited = data(host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                             json={"action": "edit", "version": 2, "content": "季度评审在周五"}))
    assert edited["content"] == "季度评审在周五"
    assert host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                      json={"action": "edit", "version": 3}).status_code == 400
    sources = data(host.get(f"/api/workspaces/{wid}/memories/{memory['id']}/sources"))
    assert sources["sources"] == [] and [c["action"] for c in sources["changes"]] == ["create", "pin", "update"]

    found = data(host.post(f"/api/workspaces/{wid}/search", json={"query": "季度评审"}))["hits"]
    assert [hit["source_id"] for hit in found] == [memory["id"]] and found[0]["certainty"] == "user_confirmed"
    assert host.post(f"/api/workspaces/{wid}/search", json={"query": "x", "source_types": ["document_chunk"]}
                     ).status_code == 422
    retracted = data(host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                                json={"action": "retract", "version": edited["version"]}))
    assert retracted["status"] == "retracted"
    assert data(host.post(f"/api/workspaces/{wid}/search", json={"query": "季度评审"}))["hits"] == []
    restored = data(host.patch(f"/api/workspaces/{wid}/memories/{memory['id']}",
                               json={"action": "undo", "version": retracted["version"]}))
    assert restored["status"] == "active"
    listed = data(host.get(f"/api/workspaces/{wid}/memories"))
    assert [m["id"] for m in listed["memories"]] == [memory["id"]] and listed["resident_limit"] == 12

    # 会话：工作区会话默认参与记忆，可关闭；独立对话不可设置；运行没有清单时 404
    session = data(host.post("/api/sessions", json={"workspace_id": wid}))["session_id"]
    off = data(host.post(f"/api/sessions/{session}/participate-in-memory", json={"participate": False}))
    assert off["participate_in_memory"] is False
    standalone = data(host.post("/api/sessions", json={}))["session_id"]
    assert host.post(f"/api/sessions/{standalone}/participate-in-memory", json={"participate": True}).status_code == 400
    assert host.get("/api/runs/no-such-run/context-manifest").status_code == 404

    # 自动记忆开关与模板
    version = data(host.get(f"/api/workspaces/{wid}"))["version"]
    switched = data(host.post(f"/api/workspaces/{wid}/auto-memory", json={"enabled": False, "version": version}))
    assert switched["auto_memory_enabled"] is False
    template = data(host.post("/api/templates", json={"workspace_id": wid, "name": "简洁模板"}))
    assert template["body"] == "回答要简洁" and template["tool_suggestions"] == {}
    other = data(host.post("/api/workspaces", json={"name": "模板应用", "template_id": template["id"]}))
    assert other["instruction_preview"] == "回答要简洁"
    assert data(host.get(f"/api/workspaces/{other['id']}/memories"))["memories"] == []  # 模板不带记忆
    assert [t["id"] for t in data(host.get("/api/templates"))["templates"]] == [template["id"]]
    assert host.post(f"/api/templates/{template['id']}/delete").status_code == 200

    # 删除工作区：记忆与检索不再可见
    assert host.post(f"/api/workspaces/{wid}/delete").status_code == 200
    assert host.get(f"/api/workspaces/{wid}/memories").status_code == 404
    assert host.post(f"/api/workspaces/{wid}/search", json={"query": "季度评审"}).status_code == 404
