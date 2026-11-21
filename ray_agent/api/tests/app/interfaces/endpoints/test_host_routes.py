"""宿主活动运行数接口：只认宿主密钥，空闲时为 0；真实应用生命周期。"""
from fastapi.testclient import TestClient

from app.interfaces.host_access import HOST_SECRET_HEADER, set_host_secret

SECRET = "host-secret-for-tests-0123456789"


def test_host_activity_is_host_only_and_counts_idle_as_zero(client: TestClient):
    set_host_secret(SECRET)
    try:
        assert client.get("/api/host/activity").status_code == 403
        assert client.get("/api/host/activity", headers={HOST_SECRET_HEADER: "wrong"}).status_code == 403
        response = client.get("/api/host/activity", headers={HOST_SECRET_HEADER: SECRET})
        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"active_runs": 0}
    finally:
        set_host_secret(None)
