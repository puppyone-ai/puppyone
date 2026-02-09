"""MCP v2 bound tools list API tests

覆盖：
- GET /api/v1/mcp/{api_key}/tools
- GET /api/v1/mcp/id/{mcp_id}/tools
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.exception_handler import (
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from src.exceptions import AppException, ErrorCode, NotFoundException
from src.mcp_v2.dependencies import get_mcp_v2_instance_by_api_key, get_mcp_v2_service
from src.mcp_v2.models import McpV2Instance
from src.mcp_v2.router import router as mcp_v2_router
from src.mcp_v2.schemas import BoundToolOut


@pytest.fixture
def app():
    test_app = FastAPI()
    test_app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    test_app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    test_app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    test_app.include_router(mcp_v2_router, prefix="/api/v1", tags=["mcp"])
    return test_app


@pytest.fixture
def current_user():
    return CurrentUser(
        user_id="u_test",
        email="test@example.com",
        role="authenticated",
        is_anonymous=False,
        app_metadata={},
        user_metadata={},
    )


@pytest.fixture
def client(app, current_user):
    svc = Mock()
    svc.list_bound_tools_by_mcp_id = Mock()
    svc.list_bound_tools_by_mcp_id_with_access_check = Mock()

    app.dependency_overrides[get_mcp_v2_service] = lambda: svc
    app.dependency_overrides[get_current_user] = lambda: current_user

    with TestClient(app) as c:
        yield c, svc

    app.dependency_overrides.clear()


def test_list_bound_tools_by_api_key_success(client):
    c, svc = client
    inst = McpV2Instance(
        id=1,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        user_id="u_test",
        name="n",
        api_key="k",
        status=True,
    )

    svc.list_bound_tools_by_mcp_id.return_value = [
        BoundToolOut(
            tool_id="100",
            binding_id=10,
            binding_status=True,
            created_at=datetime.now(UTC),
            user_id="u_test",
            name="t1",
            type="query_data",
            node_id="node_1",
            json_path="",
            description="desc",
            input_schema={"type": "object"},
            output_schema=None,
            metadata={"k": "v"},
        )
    ]

    # 覆盖 api_key 解析依赖（避免走真实 service/repo）
    c.app.dependency_overrides[get_mcp_v2_instance_by_api_key] = lambda: inst

    resp = c.get("/api/v1/mcp/k/tools")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert len(body["data"]) == 1
    svc.list_bound_tools_by_mcp_id.assert_called_once_with(1, include_disabled=False)


def test_list_bound_tools_by_api_key_not_found(client):
    c, _svc = client

    def _raise():
        raise NotFoundException("MCP v2 instance not found", code=ErrorCode.MCP_INSTANCE_NOT_FOUND)

    c.app.dependency_overrides[get_mcp_v2_instance_by_api_key] = _raise

    resp = c.get("/api/v1/mcp/not-exists/tools")
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == ErrorCode.MCP_INSTANCE_NOT_FOUND


def test_list_bound_tools_by_mcp_id_owner_success(client):
    c, svc = client
    svc.list_bound_tools_by_mcp_id_with_access_check.return_value = []

    resp = c.get("/api/v1/mcp/id/10/tools?include_disabled=true")
    assert resp.status_code == 200
    svc.list_bound_tools_by_mcp_id_with_access_check.assert_called_once_with(
        10,
        user_id="u_test",
        include_disabled=True,
    )


def test_list_bound_tools_by_mcp_id_not_owner(client):
    c, svc = client
    svc.list_bound_tools_by_mcp_id_with_access_check.side_effect = NotFoundException("MCP v2 instance not found")

    resp = c.get("/api/v1/mcp/id/999/tools")
    assert resp.status_code == 404


