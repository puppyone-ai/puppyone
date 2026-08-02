from src.connectors.manager import router as access_router
from src.connectors.mcp_endpoint import repository as mcp_repository
from src.connectors.mcp_endpoint import service as mcp_service


def test_unified_mcp_create_returns_the_one_time_key(monkeypatch):
    """The unified create endpoint must not discard the only key disclosure."""

    captured: dict = {}

    monkeypatch.setattr(mcp_repository, "McpEndpointRepository", lambda: object())

    def create_endpoint(self, **kwargs):
        captured.update(kwargs)
        return {
            "id": "mcp-endpoint-1",
            "project_id": "project-1",
            "name": "Import MCP",
            "status": "active",
            "api_key": "mcp_one_time_key",
        }

    monkeypatch.setattr(mcp_service.McpEndpointService, "create_endpoint", create_endpoint)

    result = access_router._create_mcp(
        access_router.UnifiedConnectionCreate(
            project_id="project-1",
            provider="mcp",
            name="Import MCP",
        ),
        created_by="user-1",
    )

    assert captured["created_by"] == "user-1"
    assert result.id == "mcp-endpoint-1"
    assert result.access_key == "mcp_one_time_key"
    assert result.model_dump(exclude_none=True) == {
        "id": "mcp-endpoint-1",
        "project_id": "project-1",
        "provider": "mcp",
        "name": "Import MCP",
        "status": "active",
        "access_key": "mcp_one_time_key",
    }
