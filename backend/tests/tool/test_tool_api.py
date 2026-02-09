"""Tool API 端点测试

覆盖：
- GET /tools/by-node/{node_id}
"""

from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
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
    service.list_user_tools = Mock()
    service.list_user_tools_by_node_id = Mock()
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
            project_id="project_1",
            node_id="node_10",
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
            project_id="project_1",
            node_id="node_10",
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


def test_list_tools_by_node_id_success(client, mock_tool_service, sample_tools, current_user):
    mock_tool_service.list_user_tools_by_node_id.return_value = sample_tools

    resp = client.get("/tools/by-node/node_10?skip=0&limit=1000")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["message"] == "获取 Tool 列表成功"
    assert len(body["data"]) == 2
    mock_tool_service.list_user_tools_by_node_id.assert_called_once_with(
        current_user.user_id,
        node_id="node_10",
        skip=0,
        limit=1000,
    )


def test_list_tools_by_node_id_not_found(client, mock_tool_service):
    from src.exceptions import NotFoundException

    mock_tool_service.list_user_tools_by_node_id.side_effect = NotFoundException(
        "Node not found: node_999"
    )

    resp = client.get("/tools/by-node/node_999")

    assert resp.status_code == 404
