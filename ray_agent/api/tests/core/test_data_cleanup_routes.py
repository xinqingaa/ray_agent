from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.interfaces.endpoints.data_routes import router
from app.interfaces.service_dependencies import get_data_cleanup_service


def test_latest_before_any_cleanup_returns_null():
    async def latest(project_id=None):
        return None
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_data_cleanup_service] = lambda: SimpleNamespace(repository=SimpleNamespace(latest=latest))
    with TestClient(app) as client:
        for path in ('/data/tasks/latest', '/data/tasks/latest?project_id=empty'):
            response = client.get(path)
            assert response.status_code == 200
            assert response.json()['data'] is None
