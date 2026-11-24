"""应用内静态项目预览：三类挂载、安全越界/敏感路径拦截、CSP 跨挂载隔离、ZIP 导出过滤限额、目录入口探测与端口释放。"""
import asyncio
import io
import os
import socket
import urllib.request
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.application.services.root_access import StaticBindings
from app.application.services.static_preview_service import StaticPreviewService, validate_parent_origin
from app.domain.external.workspace_files import FileKind, FileLimits, RootBinding
from app.domain.models.file import File
from app.domain.models.identity import RootKind, RootedPath
from app.infrastructure.external.static_preview.server import StaticPreviewServer, create_static_preview_app
from app.infrastructure.external.workspace_files.posix import PosixWorkspaceFiles
from app.interfaces.endpoints.static_preview_routes import router as static_preview_router
from app.interfaces.errors.exception_handlers import register_exception_handlers
from app.interfaces.service_dependencies import get_static_preview_service
from core.config import Settings


class _StubFileService:
    def __init__(self, items: dict[str, tuple[bytes, File]]):
        self._items = items

    async def download_file(self, file_id: str):
        from app.application.errors.exceptions import GoneError, NotFoundError
        if file_id not in self._items:
            raise NotFoundError("文件不存在")
        data, meta = self._items[file_id]
        if meta.visual and meta.visual.get("deleted_at"):
            raise GoneError("临时文件已过期")
        return io.BytesIO(data), meta


def _make_binding(root_id: str, path) -> RootBinding:
    info = os.stat(path)
    return RootBinding(
        root_id=root_id,
        kind=RootKind.WORKSPACE_FOLDER,
        path=str(path),
        dev=info.st_dev,
        ino=info.st_ino,
    )


def _setup_clients(tmp_path, *, settings: Settings | None = None):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("TOP_SECRET", encoding="utf-8")

    ws_a = tmp_path / "ws_a"
    ws_a.mkdir()
    (ws_a / ".rayagent").mkdir()
    (ws_a / ".rayagent" / "workspace.json").write_text('{"id":"a"}', encoding="utf-8")
    (ws_a / "report.html").write_text("<!doctype html><html><body>Single Root HTML</body></html>", encoding="utf-8")
    (ws_a / "sibling.js").write_text("console.log('sibling');", encoding="utf-8")

    site = ws_a / "site"
    site.mkdir()
    (site / "index.html").write_text(
        "<!doctype html><html><head><link rel='stylesheet' href='styles.css'></head><body>App</body></html>",
        encoding="utf-8",
    )
    (site / "app.js").write_text("export const ok = true;\n", encoding="utf-8")
    (site / "styles.css").write_text("body { color: #111; }\n", encoding="utf-8")
    (site / "assets").mkdir()
    (site / "assets" / "logo.svg").write_text("<svg></svg>", encoding="utf-8")
    (site / "sub").mkdir()
    (site / "sub" / "index.html").write_text("<!doctype html><html><body>Sub</body></html>", encoding="utf-8")
    (site / "sub" / "data.json").write_text('{"items":[1,2]}', encoding="utf-8")
    (site / ".rayagent").mkdir()
    (site / ".rayagent" / "internal.json").write_text("{}", encoding="utf-8")
    (site / ".git").mkdir()
    (site / ".git" / "config").write_text("[core]", encoding="utf-8")
    (site / "node_modules").mkdir()
    (site / "node_modules" / "pkg").mkdir()
    (site / "node_modules" / "pkg" / "index.js").write_text("module.exports={}", encoding="utf-8")
    (site / ".env").write_text("API_KEY=secret", encoding="utf-8")
    (site / "secret.key").write_text("PRIVATE KEY", encoding="utf-8")
    (site / "data.sqlite").write_text("sqlite", encoding="utf-8")
    (site / ".rayagent-write-temp.tmp").write_text("tmp", encoding="utf-8")
    (site / "escape.txt").symlink_to(outside / "secret.txt")
    (site / "escape-dir").symlink_to(outside)

    ws_b = tmp_path / "ws_b"
    ws_b.mkdir()
    (ws_b / "index.htm").write_text("<!doctype html><html><body>Site B</body></html>", encoding="utf-8")

    bindings = [_make_binding("root-a", ws_a), _make_binding("root-b", ws_b)]
    static_bindings = StaticBindings(bindings)
    files = PosixWorkspaceFiles(static_bindings, FileLimits())
    stub_files = _StubFileService(
        {
            "att-html": (
                b"\xef\xbb\xbf<!DOCTYPE html><html><body><a download='cal.ics'>export</a></body></html>",
                File(id="att-html", filename="活动页.html", size=78),
            ),
            "att-txt": (b"plain text", File(id="att-txt", filename="readme.txt", size=10)),
        }
    )

    port = 18991
    current_settings = settings or Settings()
    service = StaticPreviewService(
        file_service=stub_files,
        root_files=files,
        root_bindings=static_bindings,
        port_provider=lambda: port,
        settings_provider=lambda: current_settings,
    )

    api_app = FastAPI()
    register_exception_handlers(api_app)
    api_app.include_router(static_preview_router, prefix="/api")
    api_app.dependency_overrides[get_static_preview_service] = lambda: service

    preview_app = create_static_preview_app(service, lambda: port)
    return TestClient(api_app), TestClient(preview_app), service, ws_a, files


def test_attachment_and_root_file_mounts_and_bridge_injection(tmp_path):
    api_client, preview_client, _, _, _ = _setup_clients(tmp_path)

    # 非 HTML 附件拒绝挂载
    bad = api_client.post("/api/previews/static/mounts", json={"kind": "attachment", "file_id": "att-txt"})
    assert bad.status_code == 400

    # 校验合法 Origin 被注入且不受非法 Origin 污染
    resp = api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "attachment", "file_id": "att-html"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert resp.status_code == 200
    mount = resp.json()["data"]
    token = mount["mount_token"]
    assert mount["export_zip_path"] is None
    assert mount["preview_url"].startswith(f"http://127.0.0.1:18991/s/{token}/")

    # 根跳转 307
    redir = preview_client.get(f"/s/{token}", follow_redirects=False)
    assert redir.status_code == 307

    # BOM + <!DOCTYPE html> 后紧跟下载桥脚本，且仅保留对应 Origin
    page = preview_client.get(f"/s/{token}/")
    assert page.status_code == 200
    assert page.content.startswith(b"\xef\xbb\xbf<!DOCTYPE html><script>")
    assert b"rayagent:preview-download" in page.content
    assert b'"http://localhost:5173"' in page.content
    assert "http://localhost:5173" in page.headers["content-security-policy"]
    assert page.headers["x-content-type-options"] == "nosniff"
    assert page.headers["cache-control"] == "no-store"
    assert page.headers["referrer-policy"] == "no-referrer"

    # 单文件附件挂载不能读其他路径
    assert preview_client.get(f"/s/{token}/other.js").status_code == 404

    # 非法 Origin 不进入 frame-ancestors 与脚本 targetOrigin
    evil = api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "root_file", "root_id": "root-a", "relative_path": "report.html"},
        headers={"Origin": "https://evil.example"},
    )
    assert evil.status_code == 200
    evil_token = evil.json()["data"]["mount_token"]
    evil_page = preview_client.get(f"/s/{evil_token}/report.html")
    assert evil_page.status_code == 200
    assert "https://evil.example" not in evil_page.headers["content-security-policy"]
    assert b"evil.example" not in evil_page.content
    # 单文件挂载不能顺带读取同目录其他脚本
    assert preview_client.get(f"/s/{evil_token}/sibling.js").status_code == 404

    # 撤销挂载后不可再访问
    assert api_client.delete(f"/api/previews/static/mounts/{evil_token}").status_code == 200
    assert preview_client.get(f"/s/{evil_token}/report.html").status_code == 404


def test_root_dir_security_csp_isolation_and_zip_export(tmp_path):
    api_client, preview_client, _, _, _ = _setup_clients(tmp_path)

    mount_a = api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "root_dir", "root_id": "root-a", "relative_path": "site"},
        headers={"Origin": "tauri://localhost"},
    ).json()["data"]
    mount_b = api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "root_dir", "root_id": "root-b", "relative_path": ""},
        headers={"Origin": "tauri://localhost"},
    ).json()["data"]
    tok_a, tok_b = mount_a["mount_token"], mount_b["mount_token"]
    assert mount_a["entry_path"] == "index.html"
    assert mount_b["entry_path"] == "index.htm"
    assert mount_a["export_zip_path"] == f"/previews/static/mounts/{tok_a}/export.zip"

    # 正常读取 HTML/CSS/ES Module/JSON/SVG 与子目录 index.html
    html_res = preview_client.get(f"/s/{tok_a}/index.html")
    assert html_res.status_code == 200
    js_res = preview_client.get(f"/s/{tok_a}/app.js")
    assert js_res.status_code == 200 and js_res.headers["content-type"].startswith("text/javascript")
    css_res = preview_client.get(f"/s/{tok_a}/styles.css")
    assert css_res.status_code == 200 and css_res.headers["content-type"].startswith("text/css")
    json_res = preview_client.get(f"/s/{tok_a}/sub/data.json")
    assert json_res.status_code == 200 and json_res.json() == {"items": [1, 2]}
    sub_res = preview_client.get(f"/s/{tok_a}/sub/")
    assert sub_res.status_code == 200 and b"Sub" in sub_res.content

    # Range 读取与 HEAD
    partial = preview_client.get(f"/s/{tok_a}/app.js", headers={"Range": "bytes=0-5"})
    assert partial.status_code == 206 and partial.content == b"export"
    assert preview_client.get(f"/s/{tok_a}/app.js", headers={"Range": "bytes=999-1000"}).status_code == 416
    head_js = preview_client.head(f"/s/{tok_a}/app.js")
    assert head_js.status_code == 200 and head_js.content == b"" and int(head_js.headers["content-length"]) > 0

    # 跨挂载 CSP 隔离：mount A 的 CSP 仅授权 /s/{tok_a}/，不包含 tok_b
    csp_a = html_res.headers["content-security-policy"]
    csp_b = preview_client.get(f"/s/{tok_b}/index.htm").headers["content-security-policy"]
    assert f"/s/{tok_a}/" in csp_a and f"/s/{tok_b}/" not in csp_a
    assert f"/s/{tok_b}/" in csp_b and f"/s/{tok_a}/" not in csp_b

    # 安全边界：仅 GET/HEAD；越界/编码斜杠/符号链接/保留目录/VCS/凭据/数据库/内部临时文件全部拦截；不列目录
    assert preview_client.post(f"/s/{tok_a}/app.js").status_code == 405
    for forbidden in (
        f"/s/{tok_a}/../report.html",
        f"/s/{tok_a}/%2e%2e/report.html",
        f"/s/{tok_a}/sub%2f..%2f.env",
        f"/s/{tok_a}/%5c.env",
        f"/s/{tok_a}//app.js",
        f"/s/{tok_a}/.rayagent/internal.json",
        f"/s/{tok_a}/.git/config",
        f"/s/{tok_a}/.env",
        f"/s/{tok_a}/secret.key",
        f"/s/{tok_a}/data.sqlite",
        f"/s/{tok_a}/.rayagent-write-temp.tmp",
        f"/s/{tok_a}/escape.txt",
        f"/s/{tok_a}/escape-dir/secret.txt",
    ):
        assert preview_client.get(forbidden).status_code in (400, 403, 404), forbidden
        assert preview_client.get(forbidden).status_code != 200, forbidden
    # 明确验证敏感路径与符号链接返回 403
    for strict_403 in (
        f"/s/{tok_a}/%2e%2e/report.html",
        f"/s/{tok_a}/.rayagent/internal.json",
        f"/s/{tok_a}/.git/config",
        f"/s/{tok_a}/.env",
        f"/s/{tok_a}/secret.key",
        f"/s/{tok_a}/data.sqlite",
        f"/s/{tok_a}/.rayagent-write-temp.tmp",
        f"/s/{tok_a}/escape.txt",
        f"/s/{tok_a}/escape-dir/secret.txt",
    ):
        assert preview_client.get(strict_403).status_code == 403, strict_403

    # 无入口目录绝不列目录
    assert preview_client.get(f"/s/{tok_a}/assets/").status_code == 404
    assert preview_client.get(f"/s/{tok_a}/assets").status_code == 404

    # 挂载包含敏感目录时直接拒绝创建
    assert api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "root_dir", "root_id": "root-a", "relative_path": ".rayagent"},
    ).status_code == 403

    # ZIP 导出：过滤保留目录、VCS、node_modules、凭据、数据库、内部临时文件与符号链接
    export_url = f"/api{mount_a['export_zip_path']}"
    assert api_client.head(export_url).status_code == 200
    zip_resp = api_client.get(export_url)
    assert zip_resp.status_code == 200
    assert zip_resp.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        names = set(zf.namelist())
    assert names == {"index.html", "app.js", "styles.css", "assets/logo.svg", "sub/index.html", "sub/data.json"}


def test_mount_expiry_capacity_and_zip_limits(tmp_path):
    limited = Settings(
        static_preview_mount_seconds=1,
        static_preview_mount_capacity=2,
        static_preview_zip_max_files=2,
        static_preview_zip_max_bytes=4096,
    )
    api_client, preview_client, service, _, _ = _setup_clients(tmp_path, settings=limited)

    tokens = []
    for _ in range(3):
        res = api_client.post("/api/previews/static/mounts", json={"kind": "attachment", "file_id": "att-html"})
        assert res.status_code == 200
        tokens.append(res.json()["data"]["mount_token"])

    # 超出容量 2 时淘汰最早的 token
    assert preview_client.get(f"/s/{tokens[0]}/").status_code == 404
    assert preview_client.get(f"/s/{tokens[2]}/").status_code == 200

    # 超出文件数上限拒绝 ZIP 导出
    site_mount = api_client.post(
        "/api/previews/static/mounts",
        json={"kind": "root_dir", "root_id": "root-a", "relative_path": "site"},
    ).json()["data"]
    too_many = api_client.get(f"/api{site_mount['export_zip_path']}")
    assert too_many.status_code == 400

    # 字节上限验证
    service._settings_provider = lambda: Settings(static_preview_zip_max_files=100, static_preview_zip_max_bytes=10)
    too_big = api_client.get(f"/api{site_mount['export_zip_path']}")
    assert too_big.status_code == 400

    # validate_parent_origin 严格放行白名单
    assert validate_parent_origin("tauri://localhost") == "tauri://localhost"
    assert validate_parent_origin("http://127.0.0.1:5173") == "http://127.0.0.1:5173"
    assert validate_parent_origin("http://localhost:70000") is None
    assert validate_parent_origin("https://example.com") is None


def test_list_dir_probes_static_entry_safely(tmp_path):
    _, _, _, ws_a, files = _setup_clients(tmp_path)
    (ws_a / "empty-dir").mkdir()
    (ws_a / "htm-dir").mkdir()
    (ws_a / "htm-dir" / "index.htm").write_text("<html></html>", encoding="utf-8")
    outside_site = tmp_path / "outside-site"
    outside_site.mkdir()
    (outside_site / "index.html").write_text("<html></html>", encoding="utf-8")
    (ws_a / "link-site").symlink_to(outside_site)

    listing = asyncio.run(files.list_dir(RootedPath(root_id="root-a", relative_path="")))
    by_name = {entry.name: entry for entry in listing.entries}
    assert by_name["site"].static_entry == "index.html"
    assert by_name["htm-dir"].static_entry == "index.htm"
    assert by_name["empty-dir"].static_entry is None
    assert by_name["link-site"].kind is FileKind.SYMLINK
    assert by_name["link-site"].static_entry is None


def test_static_preview_server_binds_and_releases_loopback_port(tmp_path):
    _, _, service, _, _ = _setup_clients(tmp_path)

    def _fetch(url: str) -> tuple[int, bytes]:
        with urllib.request.urlopen(url, timeout=3) as resp:
            return resp.status, resp.read()

    async def exercise():
        server = StaticPreviewServer(service)
        service._port_provider = lambda: server.port
        port = await server.start()
        try:
            mount = await service.create_mount(
                type("Req", (), {"kind": "root_dir", "file_id": None, "root_id": "root-a", "relative_path": "site", "entry_path": ""})(),
                parent_origin="tauri://localhost",
            )
            status, body = await asyncio.to_thread(_fetch, mount.preview_url)
            assert status == 200 and b"App" in body
        finally:
            await server.stop()

        assert server.port is None
        with pytest.raises(OSError):
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                pass

    asyncio.run(exercise())
