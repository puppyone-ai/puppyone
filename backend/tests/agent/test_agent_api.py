from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.router import router as agent_router


def create_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(agent_router)
    return app


def test_agents_route_not_found():
    app = create_test_app()
    with TestClient(app) as client:
        resp = client.post("/agents", json={"prompt": "hi"})
    assert resp.status_code != 404
