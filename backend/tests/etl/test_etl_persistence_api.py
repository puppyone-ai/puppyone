"""ETL持久化和ID类型 API集成测试

测试新增功能:
- 使用int类型ID提交任务
- 使用int类型ID查询任务
- JSON挂载接口
- 任务持久化流程
"""

import json
from datetime import datetime, UTC
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.etl.dependencies import get_etl_service
from src.etl.router import router
from src.etl.tasks.models import ETLTask, ETLTaskResult, ETLTaskStatus
from src.s3.dependencies import get_s3_service
from src.table.dependencies import get_table_service


# ============= Fixtures =============


@pytest.fixture
def app():
    """创建测试用的FastAPI应用"""
    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


@pytest.fixture
def mock_etl_service():
    """Mock ETL服务"""
    service = Mock()
    service.submit_etl_task = AsyncMock()
    service.get_task_status = AsyncMock()
    service.list_tasks = AsyncMock()
    return service


@pytest.fixture
def mock_s3_service():
    """Mock S3服务"""
    service = Mock()
    service.download_file = AsyncMock()
    return service


@pytest.fixture
def mock_table_service():
    """Mock Table服务"""
    service = Mock()
    service.create_context_data = AsyncMock()
    return service


@pytest.fixture
def client(app, mock_etl_service, mock_s3_service, mock_table_service):
    """创建测试客户端并覆盖依赖"""
    app.dependency_overrides[get_etl_service] = lambda: mock_etl_service
    app.dependency_overrides[get_s3_service] = lambda: mock_s3_service
    app.dependency_overrides[get_table_service] = lambda: mock_table_service
    
    with TestClient(app) as test_client:
        yield test_client
    
    app.dependency_overrides.clear()


# ============= Tests =============


def test_submit_task_with_int_ids(client, mock_etl_service):
    """测试使用int类型ID提交任务"""
    # Mock response
    mock_task = ETLTask(
        task_id=123,
        user_id=1,
        project_id=2,
        filename="test.pdf",
        rule_id=3,
        status=ETLTaskStatus.PENDING,
    )
    mock_etl_service.submit_etl_task.return_value = mock_task
    
    # Submit with int IDs
    response = client.post(
        "/api/v1/etl/submit",
        json={
            "user_id": 1,
            "project_id": 2,
            "filename": "test.pdf",
            "rule_id": 3,
        }
    )
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == 123
    assert isinstance(data["task_id"], int)
    assert data["status"] == "pending"
    
    # Verify service was called with int types
    mock_etl_service.submit_etl_task.assert_called_once()
    call_args = mock_etl_service.submit_etl_task.call_args[1]
    assert call_args["user_id"] == 1
    assert call_args["project_id"] == 2
    assert call_args["rule_id"] == 3
    assert isinstance(call_args["user_id"], int)


def test_get_task_status_with_int_id(client, mock_etl_service):
    """测试使用int类型ID查询任务状态"""
    # Mock response
    mock_task = ETLTask(
        task_id=456,
        user_id=1,
        project_id=2,
        filename="test.pdf",
        rule_id=3,
        status=ETLTaskStatus.COMPLETED,
        progress=100,
        result=ETLTaskResult(
            output_path="output.json",
            output_size=1024,
            processing_time=5.5,
            mineru_task_id="m123",
        ),
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Get task with int ID
    response = client.get("/api/v1/etl/tasks/456")
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == 456
    assert data["user_id"] == 1
    assert data["project_id"] == 2
    assert data["rule_id"] == 3
    assert data["status"] == "completed"
    assert data["result"]["output_path"] == "output.json"


def test_list_tasks_with_int_filters(client, mock_etl_service):
    """测试使用int类型ID过滤任务列表"""
    # Mock response
    mock_tasks = [
        ETLTask(
            task_id=1,
            user_id=100,
            project_id=200,
            filename="test1.pdf",
            rule_id=1,
            status=ETLTaskStatus.PENDING,
        ),
        ETLTask(
            task_id=2,
            user_id=100,
            project_id=200,
            filename="test2.pdf",
            rule_id=1,
            status=ETLTaskStatus.COMPLETED,
        ),
    ]
    mock_etl_service.list_tasks.return_value = mock_tasks
    
    # List with int filters
    response = client.get(
        "/api/v1/etl/tasks",
        params={"user_id": 100, "project_id": 200}
    )
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert len(data["tasks"]) == 2
    assert all(isinstance(t["task_id"], int) for t in data["tasks"])
    assert all(t["user_id"] == 100 for t in data["tasks"])


def test_mount_etl_result_success(client, mock_etl_service, mock_s3_service, mock_table_service):
    """测试成功挂载ETL结果"""
    # Mock completed task
    mock_task = ETLTask(
        task_id=789,
        user_id=1,
        project_id=1,
        filename="document.pdf",
        rule_id=1,
        status=ETLTaskStatus.COMPLETED,
        result=ETLTaskResult(
            output_path="users/1/processed/1/document.pdf.json",
            output_size=2048,
            processing_time=10.0,
            mineru_task_id="m456",
        ),
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Mock S3 download
    result_json = {"title": "Test Document", "content": "Sample content"}
    mock_s3_service.download_file.return_value = json.dumps(result_json).encode("utf-8")
    
    # Mount result
    response = client.post(
        "/api/v1/etl/tasks/789/mount",
        json={
            "table_id": 10,
            "json_path": "/documents"
        }
    )
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "mounted_path" in data
    assert data["mounted_path"] == "/documents/document"
    
    # Verify S3 download was called
    mock_s3_service.download_file.assert_called_once_with(
        "users/1/processed/1/document.pdf.json"
    )
    
    # Verify table service was called
    mock_table_service.create_context_data.assert_called_once()
    call_args = mock_table_service.create_context_data.call_args[1]
    assert call_args["table_id"] == 10
    assert call_args["key"] == "document"
    assert call_args["value"] == result_json
    assert call_args["json_path"] == "/documents"


def test_mount_etl_result_task_not_found(client, mock_etl_service):
    """测试挂载不存在的任务"""
    # Mock task not found
    mock_etl_service.get_task_status.return_value = None
    
    # Try to mount
    response = client.post(
        "/api/v1/etl/tasks/999/mount",
        json={
            "table_id": 10,
            "json_path": "/documents"
        }
    )
    
    # Verify
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_mount_etl_result_task_not_completed(client, mock_etl_service):
    """测试挂载未完成的任务"""
    # Mock pending task
    mock_task = ETLTask(
        task_id=789,
        user_id=1,
        project_id=1,
        filename="document.pdf",
        rule_id=1,
        status=ETLTaskStatus.MINERU_PARSING,
        progress=50,
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Try to mount
    response = client.post(
        "/api/v1/etl/tasks/789/mount",
        json={
            "table_id": 10,
            "json_path": "/documents"
        }
    )
    
    # Verify
    assert response.status_code == 400
    assert "not completed" in response.json()["detail"].lower()


def test_mount_etl_result_no_result_path(client, mock_etl_service):
    """测试挂载没有结果路径的任务"""
    # Mock completed task without result
    mock_task = ETLTask(
        task_id=789,
        user_id=1,
        project_id=1,
        filename="document.pdf",
        rule_id=1,
        status=ETLTaskStatus.COMPLETED,
        result=None,  # No result
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Try to mount
    response = client.post(
        "/api/v1/etl/tasks/789/mount",
        json={
            "table_id": 10,
            "json_path": "/documents"
        }
    )
    
    # Verify
    assert response.status_code == 500
    assert "result not found" in response.json()["detail"].lower()


def test_mount_etl_result_with_empty_json_path(client, mock_etl_service, mock_s3_service, mock_table_service):
    """测试挂载到根路径(空json_path)"""
    # Mock completed task
    mock_task = ETLTask(
        task_id=789,
        user_id=1,
        project_id=1,
        filename="doc.pdf",
        rule_id=1,
        status=ETLTaskStatus.COMPLETED,
        result=ETLTaskResult(
            output_path="users/1/processed/1/doc.pdf.json",
            output_size=1024,
            processing_time=5.0,
            mineru_task_id="m789",
        ),
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Mock S3 download
    result_json = {"data": "test"}
    mock_s3_service.download_file.return_value = json.dumps(result_json).encode("utf-8")
    
    # Mount to root
    response = client.post(
        "/api/v1/etl/tasks/789/mount",
        json={
            "table_id": 10,
            "json_path": ""
        }
    )
    
    # Verify
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["mounted_path"] == "doc"  # Root path
    
    # Verify table service was called with empty json_path
    call_args = mock_table_service.create_context_data.call_args[1]
    assert call_args["json_path"] == ""
    assert call_args["key"] == "doc"


def test_task_response_has_int_types(client, mock_etl_service):
    """测试响应包含正确的int类型"""
    # Mock task
    mock_task = ETLTask(
        task_id=100,
        user_id=200,
        project_id=300,
        filename="test.pdf",
        rule_id=400,
        status=ETLTaskStatus.PENDING,
    )
    mock_etl_service.get_task_status.return_value = mock_task
    
    # Get task
    response = client.get("/api/v1/etl/tasks/100")
    
    # Verify all IDs are integers
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["task_id"], int)
    assert isinstance(data["user_id"], int)
    assert isinstance(data["project_id"], int)
    assert isinstance(data["rule_id"], int)


def test_submit_task_validates_int_types(client):
    """测试提交时验证int类型"""
    # Try to submit with string IDs (should fail validation)
    response = client.post(
        "/api/v1/etl/submit",
        json={
            "user_id": "not_an_int",
            "project_id": 2,
            "filename": "test.pdf",
            "rule_id": 3,
        }
    )
    
    # Should get validation error
    assert response.status_code == 422

