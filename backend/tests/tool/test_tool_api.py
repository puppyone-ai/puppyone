"""Tool API 端点测试

覆盖：
- GET /tools/by-path/{path}
"""

from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.exception_handler import (
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from src.exceptions import AppException
from src.tool.dependencies import get_tool_service
from src.tool.models import Tool
from src.tool.router import router


@pytest.fixture
def app():
    test_app = FastAPI()
    test_app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    test_app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    test_app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    test_app.include_router(router)
    return test_app


@pytest.fixture
def mock_tool_service():
    service = Mock()
    service.list_org_tools_by_path = Mock()
    service.create = Mock()
    service.get_by_id_with_access_check = Mock()
    service.update = Mock()
    service.delete = Mock()
    return service


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
def client(app, mock_tool_service, current_user):
    app.dependency_overrides[get_tool_service] = lambda: mock_tool_service
    app.dependency_overrides[get_current_user] = lambda: current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def sample_tools(current_user):
    now = datetime.now(UTC)
    return [
        Tool(
            id="tool_1",
            created_at=now,
            user_id=current_user.user_id,
            org_id="org_1",
            project_id="project_1",
            path="node_10",
            json_path="",
            type="search",
            name="tool_1",
            alias=None,
            description=None,
            input_schema=None,
            output_schema=None,
            metadata=None,
        ),
        Tool(
            id="tool_2",
            created_at=now,
            user_id=current_user.user_id,
            org_id="org_1",
            project_id="project_1",
            path="node_10",
            json_path="/a",
            type="search",
            name="tool_2",
            alias="Get",
            description="desc",
            input_schema=None,
            output_schema=None,
            metadata={"k": "v"},
        ),
    ]


@patch("src.tool.router.resolve_org_id", return_value="org_1")
def test_list_tools_by_path_success(
    _mock_resolve, client, mock_tool_service, sample_tools, current_user
):
    mock_tool_service.list_org_tools_by_path.return_value = sample_tools

    resp = client.get("/tools/by-path/node_10?skip=0&limit=1000")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["message"] == "Tool list retrieved successfully"
    assert len(body["data"]) == 2
    mock_tool_service.list_org_tools_by_path.assert_called_once_with(
        current_user.user_id,
        "org_1",
        path="node_10",
        skip=0,
        limit=1000,
    )


@patch("src.tool.router.resolve_org_id", return_value="org_1")
def test_list_tools_by_path_not_found(_mock_resolve, client, mock_tool_service):
    from src.exceptions import NotFoundException

    mock_tool_service.list_org_tools_by_path.side_effect = NotFoundException(
        "Node not found: node_999"
    )

    resp = client.get("/tools/by-path/node_999")

    assert resp.status_code == 404
