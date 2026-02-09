from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.agent.router import router as agent_router
from src.agent.dependencies import get_agent_service
from src.sandbox.dependencies import get_sandbox_service
from src.agent.chat.dependencies import get_chat_service
from src.content_node.dependencies import get_content_node_service
from src.tool.dependencies import get_tool_service
from src.s3.dependencies import get_s3_service
from src.agent.config.dependencies import get_agent_config_service


class _DummyAgentService:
    async def stream_events(self, **kwargs):
        if False:
            yield {}


def create_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(agent_router)
    app.dependency_overrides[get_agent_service] = lambda: _DummyAgentService()
    app.dependency_overrides[get_sandbox_service] = lambda: object()
    app.dependency_overrides[get_chat_service] = lambda: object()
    app.dependency_overrides[get_content_node_service] = lambda: object()
    app.dependency_overrides[get_tool_service] = lambda: object()
    app.dependency_overrides[get_s3_service] = lambda: object()
    app.dependency_overrides[get_agent_config_service] = lambda: object()
    return app


def test_agents_missing_prompt_returns_422():
    app = create_test_app()
    with TestClient(app) as client:
        resp = client.post("/agents", json={})
    assert resp.status_code == 422
