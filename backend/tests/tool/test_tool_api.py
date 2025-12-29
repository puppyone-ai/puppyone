"""Tool API 端点测试

覆盖：
- GET /tools/by-table/{table_id}
"""

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
from src.exceptions import AppException
from src.tool.dependencies import get_tool_service
from src.tool.models import Tool
from src.tool.router import router


@pytest.fixture
def app():
    test_app = FastAPI()
    # 与生产环境对齐：注册全局异常处理器（否则 AppException 会直接冒泡导致测试失败）
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
    service.list_user_tools_by_table_id = Mock()
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
    return [
        Tool(
            id=1,
            created_at=datetime.now(UTC),
            user_id=current_user.user_id,
            table_id=10,
            json_path="",
            type="query_data",
            name="query_1",
            alias=None,
            description=None,
            input_schema=None,
            output_schema=None,
            metadata=None,
        ),
        Tool(
            id=2,
            created_at=datetime.now(UTC),
            user_id=current_user.user_id,
            table_id=10,
            json_path="/a",
            type="get_all_data",
            name="get_1",
            alias="Get",
            description="desc",
            input_schema=None,
            output_schema=None,
            metadata={"k": "v"},
        ),
    ]


def test_list_tools_by_table_id_success(client, mock_tool_service, sample_tools, current_user):
    mock_tool_service.list_user_tools_by_table_id.return_value = sample_tools

    resp = client.get("/tools/by-table/10?skip=0&limit=1000")

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["message"] == "获取 Tool 列表成功"
    assert len(body["data"]) == 2
    mock_tool_service.list_user_tools_by_table_id.assert_called_once_with(
        current_user.user_id,
        table_id=10,
        skip=0,
        limit=1000,
    )


def test_list_tools_by_table_id_not_found(client, mock_tool_service):
    from src.exceptions import NotFoundException

    mock_tool_service.list_user_tools_by_table_id.side_effect = NotFoundException("Table not found: 999")

    resp = client.get("/tools/by-table/999")

    assert resp.status_code == 404


