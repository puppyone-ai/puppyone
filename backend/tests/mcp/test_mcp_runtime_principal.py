from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.connectors.agent.mcp import dependencies
from src.connectors.agent.mcp import router as mcp_router


def _request_with_headers(headers: dict[str, str]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/mcp/proxy",
            "headers": [
                (name.lower().encode("latin-1"), value.encode("latin-1"))
                for name, value in headers.items()
            ],
        }
    )


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
        authorization="Bearer mcp_endpoint_key",
    )

    assert principal.api_key == "mcp_endpoint_key"
    assert principal.kind == "mcp_endpoint"


def test_runtime_principal_rejects_inactive_mcp_endpoint_key(monkeypatch):
    class _AgentRepo:
        def get_by_mcp_api_key_with_accesses(self, _api_key):
            return None

    class _EndpointRepo:
        def get_by_api_key(self, api_key):
            assert api_key == "mcp_endpoint_key"
            return {"id": "endpoint-1", "status": "off"}

    monkeypatch.setattr(dependencies, "AgentRepository", lambda: _AgentRepo())
    monkeypatch.setattr(dependencies, "McpEndpointRepository", lambda: _EndpointRepo())

    with pytest.raises(HTTPException) as exc:
        dependencies.get_mcp_runtime_principal(
            authorization="Bearer mcp_endpoint_key",
        )

    assert exc.value.status_code == 403


def test_runtime_principal_keeps_agent_key(monkeypatch):
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
        authorization="Bearer agent_key",
    )

    assert principal.api_key == "agent_key"
    assert principal.kind == "agent"


@pytest.mark.parametrize("authorization", [None, "", "mcp_key", "Basic mcp_key", "Bearer "])
def test_runtime_principal_requires_bearer_authorization(authorization):
    with pytest.raises(HTTPException) as exc:
        dependencies.get_mcp_runtime_principal(authorization=authorization)

    assert exc.value.status_code == 401


def test_runtime_principal_rejects_unknown_bearer_token(monkeypatch):
    class _AgentRepo:
        def get_by_mcp_api_key_with_accesses(self, _api_key):
            return None

    class _EndpointRepo:
        def get_by_api_key(self, _api_key):
            return None

    monkeypatch.setattr(dependencies, "AgentRepository", lambda: _AgentRepo())
    monkeypatch.setattr(dependencies, "McpEndpointRepository", lambda: _EndpointRepo())

    with pytest.raises(HTTPException) as exc:
        dependencies.get_mcp_runtime_principal(authorization="Bearer unknown")

    assert exc.value.status_code == 401


def test_proxy_headers_forward_only_mcp_protocol_headers():
    headers = mcp_router._build_mcp_proxy_headers(
        _request_with_headers(
            {
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "Mcp-Session-Id": "session-1",
                "MCP-Protocol-Version": "2025-06-18",
                "Authorization": "Bearer public-key",
                "Cookie": "session=leak",
                "Origin": "https://example.com",
            }
        ),
        "mcp_internal_key",
    )

    normalized = {name.lower(): value for name, value in headers.items()}
    assert normalized["accept"] == "application/json, text/event-stream"
    assert normalized["content-type"] == "application/json"
    assert normalized["mcp-session-id"] == "session-1"
    assert normalized["mcp-protocol-version"] == "2025-06-18"
    assert normalized["x-api-key"] == "mcp_internal_key"
    assert "authorization" not in normalized
    assert "cookie" not in normalized
    assert "origin" not in normalized


def test_proxy_origin_validation_allows_non_browser_and_allowed_origin(monkeypatch):
    monkeypatch.setattr(mcp_router.settings, "ALLOWED_HOSTS", ["https://app.example.com"])

    mcp_router._validate_mcp_proxy_origin(_request_with_headers({}))
    mcp_router._validate_mcp_proxy_origin(
        _request_with_headers({"Origin": "https://app.example.com"})
    )


def test_proxy_origin_validation_rejects_untrusted_origin(monkeypatch):
    monkeypatch.setattr(mcp_router.settings, "ALLOWED_HOSTS", ["https://app.example.com"])

    with pytest.raises(HTTPException) as exc:
        mcp_router._validate_mcp_proxy_origin(
            _request_with_headers({"Origin": "https://evil.example"})
        )

    assert exc.value.status_code == 403
