"""工作区接口：宿主授权流程、工作区生命周期、会话归属与按根的文件接口。真实应用生命周期，临时数据根与真实文件夹。"""
import io
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.interfaces.host_access import HOST_SECRET_HEADER, set_host_secret

SECRET = "host-secret-for-tests-0123456789"


@pytest.fixture()
def host(client: TestClient, tmp_path, monkeypatch):
    """宿主密钥已设置；临时目录所在的系统目录不再被黑名单拦截，默认工作区位置指向临时目录。"""
    from core.config import get_settings
    monkeypatch.setattr(get_settings(), "workspace_blocked_paths", [])
    set_host_secret(SECRET)
    yield client
    set_host_secret(None)


def grant(client: TestClient, path: Path) -> str:
    response = client.post("/api/host/folder-grants", json={"path": str(path)}, headers={HOST_SECRET_HEADER: SECRET})
    assert response.status_code == 200, response.text
    return response.json()["data"]["grant_id"]


def test_folder_grants_are_host_only_and_single_use(host: TestClient, tmp_path):
    body = {"path": str(tmp_path)}
    assert host.post("/api/host/folder-grants", json=body).status_code == 403
    assert host.post("/api/host/folder-grants", json=body, headers={HOST_SECRET_HEADER: "wrong"}).status_code == 403
    assert host.post("/api/host/folder-grants", json={"path": "relative/dir"},
                     headers={HOST_SECRET_HEADER: SECRET}).status_code == 400
    # 界面不能直接提交路径：打开接口只认 grant_id
    assert host.post("/api/workspaces/open", json={"path": str(tmp_path)}).status_code == 422
    assert host.post("/api/workspaces/open", json={"grant_id": "unknown"}).status_code == 410
    ok = grant(host, tmp_path)
    assert host.post("/api/workspaces/default-location", json={"grant_id": ok}).status_code == 200
    assert host.post("/api/workspaces/default-location", json={"grant_id": ok}).status_code == 410
    set_host_secret(None)
    assert host.post("/api/host/folder-grants", json=body, headers={HOST_SECRET_HEADER: SECRET}).status_code == 403


def test_workspace_lifecycle_sessions_and_root_files(host: TestClient, tmp_path):
    location = tmp_path / "workspaces"
    location.mkdir()
    changed = host.post("/api/workspaces/default-location", json={"grant_id": grant(host, location)})
    assert changed.json()["data"]["path"] == str(location.resolve())
    assert host.get("/api/workspaces/default-location").json()["data"]["path"] == str(location.resolve())

    created = host.post("/api/workspaces", json={"name": "接口测试"}).json()["data"]
    root_id, folder = created["folder"]["root_id"], Path(created["folder"]["path"])
    assert folder == location.resolve() / "接口测试" and created["status"] == "active" and created["version"] >= 1
    assert created["folder"]["status"] == "available" and created["folder"]["marker_writable"] is True
    assert host.get(f"/api/workspaces/{created['id']}").json()["data"]["id"] == created["id"]
    assert created["id"] in [w["id"] for w in host.get("/api/workspaces").json()["data"]["workspaces"]]

    # 会话归属：创建时指定、列表可按工作区过滤，独立对话没有归属
    inside = host.post("/api/sessions", json={"workspace_id": created["id"]}).json()["data"]["session_id"]
    alone = host.post("/api/sessions", json={}).json()["data"]["session_id"]
    listed = host.get("/api/sessions", params={"workspace_id": created["id"], "limit": 100}).json()["data"]["sessions"]
    assert [(item["session_id"], item["workspace_id"]) for item in listed] == [(inside, created["id"])]
    everything = {item["session_id"]: item["workspace_id"]
                  for item in host.get("/api/sessions", params={"limit": 100}).json()["data"]["sessions"]}
    assert everything[inside] == created["id"] and everything[alone] is None
    assert host.post("/api/sessions", json={"workspace_id": "missing"}).status_code == 404

    # 根内文件：按 root_id 加相对路径，越界与保留目录被拒绝
    (folder / "docs").mkdir()
    (folder / "docs" / "note.txt").write_text("你好", encoding="utf-8")
    (folder / "page.html").write_text("<p>hi</p>")
    entries = host.get(f"/api/roots/{root_id}/entries").json()["data"]
    assert {entry["name"]: entry["kind"] for entry in entries["entries"]} == {"docs": "directory", "page.html": "file"}
    nested = host.get(f"/api/roots/{root_id}/entries", params={"path": "docs"}).json()["data"]["entries"]
    assert nested[0]["path"]["root_id"] == root_id and nested[0]["path"]["relative_path"] == "docs/note.txt"
    assert host.get(f"/api/roots/{root_id}/entry", params={"path": "docs/note.txt"}).json()["data"]["entry"]["size"] == 6
    content = host.get(f"/api/roots/{root_id}/content", params={"path": "docs/note.txt"})
    assert content.content == "你好".encode() and content.headers["content-disposition"] == "attachment"
    for bad in ("../x", "/etc/passwd", "docs/../../x", ".rayagent/workspace.json", "a\x00b"):
        assert host.get(f"/api/roots/{root_id}/content", params={"path": bad}).status_code in (400, 403), bad
    assert host.get(f"/api/roots/{root_id}/content", params={"path": "docs/none.txt"}).status_code == 404
    assert host.get("/api/roots/missing/entries").status_code == 404
    preview = host.get(f"/api/roots/{root_id}/preview", params={"path": "docs/note.txt"})
    assert preview.status_code == 200 and preview.json()["data"]["size"] == 6
    ticket = host.post(f"/api/roots/{root_id}/preview/ticket", params={"path": "page.html"}).json()["data"]
    page = host.get(f"/api/roots/{root_id}/preview/content/page.html", params={"ticket": ticket["ticket"]})
    assert page.status_code == 200 and "sandbox" in page.headers["content-security-policy"]

    # 上传：复制进文件夹，同名不覆盖
    first = host.post(f"/api/roots/{root_id}/upload", files={"file": ("a.txt", io.BytesIO(b"1"))})
    second = host.post(f"/api/roots/{root_id}/upload", files={"file": ("a.txt", io.BytesIO(b"2"))},
                       data={"directory": "docs"})
    third = host.post(f"/api/roots/{root_id}/upload", files={"file": ("a.txt", io.BytesIO(b"3"))})
    assert first.json()["data"]["entry"]["name"] == "a.txt" and third.json()["data"]["entry"]["name"] == "a (2).txt"
    assert (folder / "a.txt").read_bytes() == b"1" and (folder / "a (2).txt").read_bytes() == b"3"
    assert (folder / "docs" / "a.txt").read_bytes() == b"2"
    assert host.post(f"/api/roots/{root_id}/upload", files={"file": ("../evil", io.BytesIO(b"x"))}).json()[
        "data"]["entry"]["name"] == "evil"
    assert not (folder.parent / "evil").exists()
    # 禁止规则同样适用：不能在版本控制内部建文件，凭据文件名不放进文件夹（模型读不到）
    refused = [host.post(f"/api/roots/{root_id}/upload", files={"file": ("x.txt", io.BytesIO(b"x"))},
                         data={"directory": ".git/hooks"}),
               host.post(f"/api/roots/{root_id}/upload", files={"file": (".env", io.BytesIO(b"K=1"))}),
               host.post(f"/api/roots/{root_id}/upload", files={"file": ("x.txt", io.BytesIO(b"x"))},
                         data={"directory": ".r\u0061yagent"})]
    assert [response.status_code for response in refused] == [403, 403, 403]
    assert not (folder / ".git").exists() and not (folder / ".env").exists()

    # 改名、归档（归档后不能新建会话）、取消归档；版本不符返回 409
    renamed = host.post(f"/api/workspaces/{created['id']}/rename", json={"name": "新名称", "version": created["version"]})
    assert renamed.json()["data"]["name"] == "新名称"
    stale = host.post(f"/api/workspaces/{created['id']}/rename", json={"name": "x", "version": created["version"]})
    assert stale.status_code == 409 and stale.json()["error"]["resource_version"] is not None
    version = renamed.json()["data"]["version"]
    archived = host.post(f"/api/workspaces/{created['id']}/archive", json={"version": version}).json()["data"]
    assert archived["status"] == "archived"
    assert host.post("/api/sessions", json={"workspace_id": created["id"]}).status_code == 409
    assert host.post(f"/api/roots/{root_id}/upload", files={"file": ("b.txt", io.BytesIO(b"x"))}).status_code == 403
    host.post(f"/api/workspaces/{created['id']}/unarchive", json={"version": archived["version"]})

    # 删除：返回长操作，会话被回收，文件夹与用户文件仍在
    operation = host.post(f"/api/workspaces/{created['id']}/delete").json()["data"]
    assert operation["kind"] == "workspace_delete"
    for _ in range(200):
        state = host.get(f"/api/operations/{operation['operation_id']}").json()["data"]
        if state["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.05)
    assert state["status"] == "succeeded", state
    assert host.get(f"/api/workspaces/{created['id']}").status_code == 404
    assert host.get(f"/api/sessions/{inside}").status_code == 404
    assert (folder / "docs" / "note.txt").read_text(encoding="utf-8") == "你好"
    host.post(f"/api/sessions/{alone}/delete")


def test_open_existing_folder_reports_scan_and_copy_conflict_shape(host: TestClient, tmp_path):
    source = tmp_path / "已有资料"
    source.mkdir()
    (source / "a.md").write_text("12345")
    opened = host.post("/api/workspaces/open", json={"grant_id": grant(host, source)}).json()["data"]
    assert opened["status"] == "opened" and opened["recognized"] == "new" and opened["conflict"] is None
    assert opened["scan"] == {"files": 1, "directories": 0, "bytes": 5, "truncated": False}
    assert opened["workspace"]["name"] == "已有资料" and opened["workspace"]["folder"]["path"] == str(source.resolve())

    duplicate = tmp_path / "已有资料副本"
    shutil.copytree(source, duplicate)
    conflict = host.post("/api/workspaces/open", json={"grant_id": grant(host, duplicate)}).json()["data"]
    assert conflict["status"] == "conflict" and conflict["workspace"] is None
    shape = conflict["conflict"]
    assert shape["workspace_id"] == opened["workspace"]["id"] and shape["bound_path"] == str(source.resolve())
    assert shape["path"] == str(duplicate.resolve()) and shape["options"] == ["as_new", "rebind"]
    resolved = host.post("/api/workspaces/open/resolve",
                         json={"conflict_id": shape["conflict_id"], "resolution": "as_new"}).json()["data"]
    assert resolved["status"] == "opened" and resolved["workspace"]["id"] != opened["workspace"]["id"]
    assert host.post("/api/workspaces/open/resolve",
                     json={"conflict_id": shape["conflict_id"], "resolution": "as_new"}).status_code == 404
    (source / "inner").mkdir()
    nested = host.post("/api/workspaces/open", json={"grant_id": grant(host, source / "inner")})
    assert nested.status_code == 400 and nested.json()["error"]["details"]["reason"] == "nested"
    for workspace in (opened["workspace"], resolved["workspace"]):
        host.post(f"/api/workspaces/{workspace['id']}/delete")


def test_write_protection_endpoints_report_empty_state_and_structured_errors(host: TestClient, tmp_path):
    location = tmp_path / "workspaces"
    location.mkdir()
    host.post("/api/workspaces/default-location", json={"grant_id": grant(host, location)})
    created = host.post("/api/workspaces", json={"name": "写保护"}).json()["data"]
    base = f"/api/workspaces/{created['id']}"

    assert created["write_lease"] is None
    assert host.get(f"{base}/write-lease").json()["data"] == {"lease": None}
    assert host.post(f"{base}/write-lease/retry-settle").json()["data"] == {"lease": None}
    assert host.get(f"{base}/modified-runs").json()["data"] == {"runs": []}
    for response in (host.get(f"{base}/runs/none/changes"), host.get(f"{base}/runs/none/changes/preview",
                                                                     params={"path": "a.txt"}),
                     host.post(f"{base}/runs/none/undo", json={"items": [{"relative_path": "a.txt"}]}),
                     host.get("/api/workspaces/missing/write-lease"), host.get("/api/workspaces/missing/modified-runs"),
                     host.get("/api/workspaces/missing/changes/stream")):
        assert response.status_code == 404, response.text
    assert host.post(f"{base}/runs/none/undo", json={"items": []}).status_code == 422


def test_independent_filter_relocate_and_host_resolve_over_http(host: TestClient, tmp_path):
    location = tmp_path / "workspaces"
    location.mkdir()
    host.post("/api/workspaces/default-location", json={"grant_id": grant(host, location)})
    created = host.post("/api/workspaces", json={"name": "原位置"}).json()["data"]
    ws, root_id, folder = created["id"], created["folder"]["root_id"], Path(created["folder"]["path"])
    inside = host.post("/api/sessions", json={"workspace_id": ws}).json()["data"]["session_id"]
    alone = host.post("/api/sessions", json={}).json()["data"]["session_id"]

    # 只看独立对话：服务端过滤后再分页，且不能与 workspace_id 同用
    page = host.get("/api/sessions", params={"independent": "true", "limit": 100}).json()["data"]
    assert alone in {item["session_id"] for item in page["sessions"]} and inside not in {
        item["session_id"] for item in page["sessions"]}
    assert all(item["workspace_id"] is None for item in page["sessions"]) and page["total"] == len(page["sessions"])
    assert host.get("/api/sessions", params={"independent": "true", "workspace_id": ws}).status_code == 400
    assert host.post("/api/sessions/stream", params={"independent": "true", "workspace_id": ws}).status_code == 400

    # 宿主解析：只认宿主密钥；保留目录、凭据文件与越界被拒绝，目标必须存在；中文文件名可用票据预览
    (folder / "报告").mkdir()
    (folder / "报告" / "结论.md").write_text("# 结论", encoding="utf-8")
    (folder / ".env").write_text("K=1", encoding="utf-8")
    resolve = f"/api/host/roots/{root_id}/resolve"
    headers = {HOST_SECRET_HEADER: SECRET}
    assert host.post(resolve, json={"relative_path": "报告/结论.md"}).status_code == 403
    ok = host.post(resolve, json={"relative_path": "报告/结论.md"}, headers=headers)
    assert ok.status_code == 200 and ok.json()["data"]["path"] == str(folder / "报告" / "结论.md")
    assert host.post(resolve, json={}, headers=headers).json()["data"]["path"] == str(folder)
    for relative, status in (("报告/没有.md", 404), (".rayagent", 403), (".env", 403), ("../x", 400), ("/etc/passwd", 400)):
        assert host.post(resolve, json={"relative_path": relative}, headers=headers).status_code == status, relative
    assert host.post("/api/host/roots/missing/resolve", json={}, headers=headers).status_code == 404
    (folder / "报告" / "页面.html").write_text("<p>你好</p>", encoding="utf-8")
    ticket = host.post(f"/api/roots/{root_id}/preview/ticket", params={"path": "报告/页面.html"}).json()["data"]
    shown = host.get(f"/api/roots/{root_id}/preview/content/报告/页面.html", params={"ticket": ticket["ticket"]})
    assert shown.status_code == 200 and "你好" in shown.text

    # 重新定位：版本不符 409；成功后位置、可用性更新且旧位置不再被绑定
    target = tmp_path / "搬走后"
    target.mkdir()
    base = f"/api/workspaces/{ws}/relocate"
    assert host.post(base, json={"grant_id": grant(host, target), "version": created["version"] + 5}).status_code == 409
    relocated = host.post(base, json={"grant_id": grant(host, target), "version": created["version"]})
    assert relocated.status_code == 200, relocated.text
    data = relocated.json()["data"]
    assert data["folder"]["path"] == str(target.resolve()) and data["folder"]["status"] == "available"
    assert data["folder"]["root_id"] == root_id and data["version"] > created["version"]
    assert host.post(base, json={"grant_id": "unknown", "version": data["version"]}).status_code == 410
    other = host.post("/api/workspaces", json={"name": "另一个"}).json()["data"]
    taken = host.post(f"/api/workspaces/{other['id']}/relocate",
                      json={"grant_id": grant(host, target), "version": other["version"]})
    assert taken.status_code == 409 and taken.json()["error"]["details"]["reason"] == "already_bound"
    nested = Path(other["folder"]["path"]) / "内层"
    nested.mkdir()
    refused = host.post(base, json={"grant_id": grant(host, nested), "version": data["version"]})
    assert refused.status_code == 400 and refused.json()["error"]["details"]["reason"] == "nested"
    for workspace in (ws, other["id"]):
        host.post(f"/api/workspaces/{workspace}/delete")
