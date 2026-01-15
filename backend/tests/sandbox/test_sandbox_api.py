from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.sandbox.router import router as sandbox_router


def create_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(sandbox_router)
    return app


def test_sandboxes_missing_session_id_returns_400():
    app = create_test_app()
    with TestClient(app) as client:
        resp = client.post("/sandboxes", json={"action": "status"})
    assert resp.status_code == 400
