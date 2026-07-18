from __future__ import annotations

from types import SimpleNamespace

from src.connectors.manager.router import UnifiedConnectionCreate, _create_mcp


def test_create_mcp_returns_its_one_time_key_only_in_create_shape(monkeypatch) -> None:
    class EndpointService:
        def __init__(self, repository):
            assert repository is not None

        def create_endpoint(self, **kwargs):
            assert kwargs["created_by"] == "user-1"
            return {
                "id": "endpoint-1",
                "project_id": "project-1",
                "name": "Docs",
                "status": "active",
                "api_key": "mcp_create_only_secret",
            }

    monkeypatch.setattr(
        "src.connectors.mcp_endpoint.repository.McpEndpointRepository",
        lambda: SimpleNamespace(),
    )
    monkeypatch.setattr(
        "src.connectors.mcp_endpoint.service.McpEndpointService",
        EndpointService,
    )

    result = _create_mcp(
        UnifiedConnectionCreate(
            project_id="project-1",
            provider="mcp",
            name="Docs",
        ),
        created_by="user-1",
    )

    assert result.cli_access_key == "mcp_create_only_secret"
    assert "access_key" not in result.model_dump(exclude_none=True)
