from __future__ import annotations

from starlette.requests import Request

from src.connectors.agent.mcp import dependencies


def _request_with_key(api_key: str) -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": f"/api/v1/mcp/proxy/{api_key}",
        "headers": [],
        "path_params": {"api_key": api_key},
    })


def test_runtime_principal_accepts_standalone_mcp_endpoint_key(monkeypatch):
    class _AgentRepo:
        def get_by_mcp_api_key_with_accesses(self, _api_key):
            return None

    class _EndpointRepo:
        def get_by_api_key(self, api_key):
            assert api_key == "mcp_endpoint_key"
            return {"id": "endpoint-1", "status": "active"}

    monkeypatch.setattr(dependencies, "AgentRepository", lambda: _AgentRepo())
    monkeypatch.setattr(dependencies, "McpEndpointRepository", lambda: _EndpointRepo())

    principal = dependencies.get_mcp_runtime_principal(
        _request_with_key("mcp_endpoint_key"),
        x_mcp_api_key=None,
    )

    assert principal.api_key == "mcp_endpoint_key"
    assert principal.kind == "mcp_endpoint"


def test_runtime_principal_keeps_agent_key_path(monkeypatch):
    class _Agent:
        mcp_api_key = "agent_key"

    class _AgentRepo:
        def get_by_mcp_api_key_with_accesses(self, api_key):
            assert api_key == "agent_key"
            return _Agent()

    class _EndpointRepo:
        def get_by_api_key(self, _api_key):
            raise AssertionError("endpoint lookup should not run for agent keys")

    monkeypatch.setattr(dependencies, "AgentRepository", lambda: _AgentRepo())
    monkeypatch.setattr(dependencies, "McpEndpointRepository", lambda: _EndpointRepo())

    principal = dependencies.get_mcp_runtime_principal(
        _request_with_key("agent_key"),
        x_mcp_api_key=None,
    )

    assert principal.api_key == "agent_key"
    assert principal.kind == "agent"
