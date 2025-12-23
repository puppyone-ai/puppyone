"""ETL API（控制面）测试：submit(s3_key) 与 mount

覆盖当前架构下的关键行为：
- submit：从 current_user 注入 user_id，支持可选 s3_key
- mount：仅 completed 可挂载，挂载时从 S3 下载 JSON 并调用 TableService
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, Mock

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
from src.etl.dependencies import get_etl_service
from src.etl.router import router
from src.etl.tasks.models import ETLTask, ETLTaskResult, ETLTaskStatus
from src.s3.dependencies import get_s3_service
from src.table.dependencies import get_table_service


@pytest.fixture
def app():
    test_app = FastAPI()
    test_app.include_router(router)
    test_app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    test_app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    test_app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    return test_app


@pytest.fixture
def mock_etl_service():
    service = Mock()
    service.submit_etl_task = AsyncMock()
    service.get_task_status_with_access_check = AsyncMock()
    return service


@pytest.fixture
def mock_s3_service():
    service = Mock()
    service.download_file = AsyncMock()
    return service


@pytest.fixture
def mock_table_service():
    # mount endpoint uses asyncio.to_thread on this sync method
    service = Mock()
    service.create_context_data = Mock()
    return service


@pytest.fixture
def client(app, mock_etl_service, mock_s3_service, mock_table_service):
    async def _override_etl_service():
        return mock_etl_service

    def _override_current_user():
        return CurrentUser(user_id="user123", email="user@example.com", role="authenticated")

    app.dependency_overrides[get_etl_service] = _override_etl_service
    app.dependency_overrides[get_current_user] = _override_current_user
    app.dependency_overrides[get_s3_service] = lambda: mock_s3_service
    app.dependency_overrides[get_table_service] = lambda: mock_table_service

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_submit_supports_s3_key(client, mock_etl_service):
    mock_task = ETLTask(
        task_id=123,
        user_id="user123",
        project_id=2,
        filename="test.pdf",
        rule_id=3,
        status=ETLTaskStatus.PENDING,
    )
    mock_etl_service.submit_etl_task.return_value = mock_task

    resp = client.post(
        "/etl/submit",
        json={
            "project_id": 2,
            "filename": "test.pdf",
            "rule_id": 3,
            "s3_key": "users/user123/raw/2/some.pdf",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["task_id"] == 123
    assert data["status"] == "pending"

    mock_etl_service.submit_etl_task.assert_called_once_with(
        user_id="user123",
        project_id=2,
        filename="test.pdf",
        rule_id=3,
        s3_key="users/user123/raw/2/some.pdf",
    )


def test_mount_requires_completed(client, mock_etl_service):
    task = ETLTask(
        task_id=1,
        user_id="user123",
        project_id=1,
        filename="doc.pdf",
        rule_id=1,
        status=ETLTaskStatus.PENDING,
    )
    mock_etl_service.get_task_status_with_access_check.return_value = task

    resp = client.post("/etl/tasks/1/mount", json={"table_id": 1, "json_path": "/x"})
    assert resp.status_code == 400


def test_mount_success(client, mock_etl_service, mock_s3_service, mock_table_service):
    task = ETLTask(
        task_id=1,
        user_id="user123",
        project_id=1,
        filename="doc.pdf",
        rule_id=1,
        status=ETLTaskStatus.COMPLETED,
        result=ETLTaskResult(
            output_path="users/user123/processed/1/1.json",
            output_size=10,
            processing_time=1.0,
            mineru_task_id="m1",
        ),
    )
    mock_etl_service.get_task_status_with_access_check.return_value = task
    mock_s3_service.download_file.return_value = json.dumps({"a": 1}).encode("utf-8")

    resp = client.post("/etl/tasks/1/mount", json={"table_id": 1, "json_path": "/docs"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True

    mock_s3_service.download_file.assert_awaited_once()
    mock_table_service.create_context_data.assert_called_once()


