"""ETL API 端点测试

测试 ETL 相关的 FastAPI 端点：
- upload_and_submit（替代 upload/submit/import-folder）
- 查询任务状态
- 列出任务
- 规则管理（创建、查询、列出、删除）
- 健康检查
"""

import json
from datetime import datetime, UTC
from unittest.mock import AsyncMock, Mock, patch

import pytest

pytest.skip(
    "Legacy ETL API tests target deprecated /etl endpoints; migrate to /ingest APIs",
    allow_module_level=True,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.exception_handler import (
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from src.upload.file.dependencies import get_etl_service
from src.upload.file.rules.dependencies import get_rule_repository
from src.upload.file.exceptions import RuleNotFoundError
from src.upload.router import router
from src.upload.file.rules.schemas import ETLRule
from src.upload.file.tasks.models import ETLTask, ETLTaskResult, ETLTaskStatus
from src.exceptions import AppException
from src.exceptions import NotFoundException
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from src.project.dependencies import get_project_service
from src.s3.dependencies import get_s3_service
from src.s3.exceptions import S3FileSizeExceededError
from src.table.dependencies import get_table_service


# ============= Fixtures =============


@pytest.fixture
def app():
    """创建测试用的FastAPI应用"""
    test_app = FastAPI()
    test_app.include_router(router)
    # Add the same exception handlers as production app
    test_app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    test_app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    test_app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    return test_app


@pytest.fixture
def client(
    app, mock_etl_service, mock_rule_repository, mock_s3_service, mock_table_service, mock_project_service
):
    """创建测试客户端并覆盖依赖"""
    async def _override_etl_service():
        return mock_etl_service

    def _override_rule_repo():
        return mock_rule_repository

    def _override_current_user():
        return CurrentUser(user_id="user123", email="user@example.com", role="authenticated")

    app.dependency_overrides[get_etl_service] = _override_etl_service
    app.dependency_overrides[get_rule_repository] = _override_rule_repo
    app.dependency_overrides[get_current_user] = _override_current_user
    app.dependency_overrides[get_s3_service] = lambda: mock_s3_service
    app.dependency_overrides[get_table_service] = lambda: mock_table_service
    app.dependency_overrides[get_project_service] = lambda: mock_project_service
    
    with TestClient(app) as test_client:
        yield test_client
    
    # 清理依赖覆盖
    app.dependency_overrides.clear()


@pytest.fixture
def mock_etl_service():
    """Mock ETL服务"""
    service = Mock()
    service.submit_etl_task = AsyncMock()
    service.create_failed_task = AsyncMock()
    service.get_task_status = AsyncMock()
    service.get_task_status_with_access_check = AsyncMock()
    service.list_tasks = AsyncMock()
    service.cancel_task = AsyncMock()
    service.retry_task = AsyncMock()
    service.get_queue_size = Mock(return_value=5)
    service.get_task_count = Mock(return_value=10)
    service.task_repository = Mock()
    service.task_repository.update_task = Mock()
    return service


@pytest.fixture
def mock_s3_service():
    service = Mock()
    service.upload_file = AsyncMock()
    return service


@pytest.fixture
def mock_table_service():
    service = Mock()
    service.get_by_id_with_access_check = Mock()
    return service


@pytest.fixture
def mock_project_service():
    service = Mock()
    service.verify_project_access = Mock(return_value=True)
    return service


@pytest.fixture
def mock_rule_repository():
    """Mock规则仓库"""
    repo = Mock()
    repo.create_rule = Mock()
    repo.get_rule = Mock()
    repo.list_rules = Mock()
    repo.delete_rule = Mock()
    repo.count_rules = Mock()
    return repo


@pytest.fixture
def sample_rule():
    """示例规则"""
    now = datetime.now(UTC)
    return ETLRule(
        rule_id="1",
        name="测试规则",
        description="测试用规则",
        json_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        system_prompt="测试prompt",
        created_at=now,
        updated_at=now
    )


@pytest.fixture
def sample_task():
    """示例任务"""
    return ETLTask(
        task_id=1,
        user_id="user123",
        project_id=456,
        filename="test.pdf",
        rule_id=789,
        status=ETLTaskStatus.PENDING
    )


# ============= upload_and_submit 测试 =============


def test_upload_and_submit_success(client, mock_etl_service, mock_s3_service, sample_task):
    """测试成功 upload_and_submit（单文件）"""
    sample_task.project_id = 456
    sample_task.filename = "test.pdf"
    mock_etl_service.submit_etl_task.return_value = sample_task

    response = client.post(
        "/etl/upload_and_submit",
        data={"project_id": "456", "rule_id": "789"},
        files=[("files", ("test.pdf", b"hello", "application/pdf"))],
    )

    assert response.status_code == 201
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["task_id"] == 1
    assert data["items"][0]["status"] == "pending"
    assert data["items"][0]["s3_key"].startswith("users/user123/raw/456/")

    mock_s3_service.upload_file.assert_awaited_once()
    mock_etl_service.submit_etl_task.assert_awaited_once()
    mock_etl_service.task_repository.update_task.assert_called_once()


def test_upload_and_submit_upload_failed_still_creates_task(
    client, mock_etl_service, mock_s3_service
):
    """测试 upload 失败也创建 failed task_id"""
    failed_task = ETLTask(
        task_id=99,
        user_id="user123",
        project_id=456,
        filename="test.pdf",
        rule_id=789,
        status=ETLTaskStatus.FAILED,
        error="too large",
        metadata={},
    )
    mock_etl_service.create_failed_task.return_value = failed_task
    mock_s3_service.upload_file.side_effect = S3FileSizeExceededError(size=2, max_size=1)

    response = client.post(
        "/etl/upload_and_submit",
        data={"project_id": "456", "rule_id": "789"},
        files=[("files", ("test.pdf", b"xx", "application/pdf"))],
    )

    assert response.status_code == 201
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["task_id"] == 99
    assert data["items"][0]["status"] == "failed"
    assert data["items"][0]["s3_key"] is None

    mock_etl_service.submit_etl_task.assert_not_called()
    mock_etl_service.create_failed_task.assert_awaited_once()


def test_legacy_endpoints_are_removed(client):
    assert client.post("/etl/submit", json={}).status_code == 404
    assert client.post("/etl/upload", data={}).status_code == 404
    assert client.post("/etl/tasks/1/mount", json={}).status_code == 404


# ============= 查询任务状态测试 =============


def test_get_task_status_success(client, mock_etl_service, sample_task):
    """测试成功查询任务状态"""
    mock_etl_service.get_task_status_with_access_check.return_value = sample_task
    
    response = client.get("/etl/tasks/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == 1
    assert data["user_id"] == "user123"
    assert data["status"] == "pending"


def test_get_task_status_completed(client, mock_etl_service, sample_task):
    """测试查询已完成任务的状态"""
    sample_task.status = ETLTaskStatus.COMPLETED
    sample_task.result = ETLTaskResult(
        output_path="output/test.json",
        output_size=1024,
        processing_time=30.5,
        mineru_task_id="mineru-123"
    )
    
    mock_etl_service.get_task_status_with_access_check.return_value = sample_task
    
    response = client.get("/etl/tasks/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert data["result"] is not None
    assert data["result"]["output_path"] == "output/test.json"
    assert data["result"]["output_size"] == 1024


def test_get_task_status_not_found(client, mock_etl_service):
    """测试查询不存在的任务"""
    mock_etl_service.get_task_status_with_access_check.side_effect = NotFoundException("ETL task not found")
    
    response = client.get("/etl/tasks/999999")
    
    assert response.status_code == 404


def test_get_task_status_failed(client, mock_etl_service, sample_task):
    """测试查询失败任务的状态"""
    sample_task.status = ETLTaskStatus.FAILED
    sample_task.error = "解析失败：文件格式不支持"
    
    mock_etl_service.get_task_status_with_access_check.return_value = sample_task
    
    response = client.get("/etl/tasks/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "failed"
    assert data["error"] == "解析失败：文件格式不支持"


# ============= 列出任务测试 =============


def test_list_tasks_empty(client, mock_etl_service):
    """测试列出空任务列表"""
    mock_etl_service.list_tasks.return_value = []
    
    response = client.get("/etl/tasks")
    
    assert response.status_code == 200
    data = response.json()
    assert data["tasks"] == []
    assert data["total"] == 0


def test_list_tasks_success(client, mock_etl_service):
    """测试成功列出任务"""
    tasks = [
        ETLTask(
            task_id=i + 1,
            user_id="user123",
            project_id=456,
            filename=f"file{i}.pdf",
            rule_id=789
        )
        for i in range(3)
    ]
    
    mock_etl_service.list_tasks.return_value = tasks
    
    response = client.get("/etl/tasks")
    
    assert response.status_code == 200
    data = response.json()
    assert len(data["tasks"]) == 3
    assert data["total"] == 3


def test_list_tasks_with_filters(client, mock_etl_service):
    """测试使用过滤器列出任务"""
    mock_etl_service.list_tasks.return_value = []
    
    response = client.get(
        "/etl/tasks",
        params={
            "project_id": 456,
            "status": "completed"
        }
    )
    
    assert response.status_code == 200
    
    # 验证服务被正确调用
    mock_etl_service.list_tasks.assert_called_once_with(
        user_id="user123",
        project_id=456,
        status=ETLTaskStatus.COMPLETED
    )


def test_list_tasks_pagination(client, mock_etl_service):
    """测试任务列表分页"""
    tasks = [
        ETLTask(
            task_id=i + 1,
            user_id="user123",
            project_id=456,
            filename=f"file{i}.pdf",
            rule_id=789
        )
        for i in range(10)
    ]
    
    mock_etl_service.list_tasks.return_value = tasks
    
    # 获取第一页
    response = client.get("/etl/tasks?limit=5&offset=0")
    data = response.json()
    assert len(data["tasks"]) == 5
    assert data["limit"] == 5
    assert data["offset"] == 0
    assert data["total"] == 10
    
    # 获取第二页
    response = client.get("/etl/tasks?limit=5&offset=5")
    data = response.json()
    assert len(data["tasks"]) == 5


def test_list_tasks_invalid_pagination(client, mock_etl_service):
    """测试无效的分页参数"""
    # 负数limit
    response = client.get("/etl/tasks?limit=-1")
    assert response.status_code == 422
    
    # 超大limit
    response = client.get("/etl/tasks?limit=1000")
    assert response.status_code == 422
    
    # 负数offset
    response = client.get("/etl/tasks?offset=-1")
    assert response.status_code == 422


# ============= 创建规则测试 =============


def test_create_rule_success(client, mock_rule_repository, sample_rule):
    """测试成功创建规则"""
    mock_rule_repository.create_rule.return_value = sample_rule
    
    response = client.post(
        "/etl/rules",
        json={
            "name": "测试规则",
            "description": "测试用规则",
            "json_schema": {"type": "object"},
            "system_prompt": "测试prompt"
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["rule_id"] == 1
    assert data["name"] == "测试规则"


def test_create_rule_missing_fields(client, mock_rule_repository):
    """测试创建规则时缺少必需字段"""
    response = client.post(
        "/etl/rules",
        json={
            "name": "测试规则"
            # 缺少其他字段
        }
    )
    
    assert response.status_code == 422


def test_create_rule_invalid_json_schema(client, mock_rule_repository):
    """测试创建规则时JSON Schema无效"""
    response = client.post(
        "/etl/rules",
        json={
            "name": "测试规则",
            "description": "测试",
            "json_schema": {"invalid": "schema"}  # 缺少type字段
        }
    )
    
    # 注意：这取决于ETLRule的验证逻辑
    # 如果在Pydantic模型中验证，会返回422
    assert response.status_code in [422, 500]


# ============= 查询规则测试 =============


def test_get_rule_success(client, mock_rule_repository, sample_rule):
    """测试成功查询规则"""
    mock_rule_repository.get_rule.return_value = sample_rule
    
    response = client.get("/etl/rules/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["rule_id"] == 1
    assert data["name"] == "测试规则"


def test_get_rule_not_found(client, mock_rule_repository):
    """测试查询不存在的规则"""
    mock_rule_repository.get_rule.return_value = None
    
    response = client.get("/etl/rules/999999")
    
    assert response.status_code == 404


# ============= 列出规则测试 =============


def test_list_rules_empty(client, mock_rule_repository):
    """测试列出空规则列表"""
    mock_rule_repository.list_rules.return_value = []
    mock_rule_repository.count_rules.return_value = 0
    
    response = client.get("/etl/rules")
    
    assert response.status_code == 200
    data = response.json()
    assert data["rules"] == []
    assert data["total"] == 0


def test_list_rules_success(client, mock_rule_repository):
    """测试成功列出规则"""
    now = datetime.now(UTC)
    rules = [
        ETLRule(
            rule_id=str(i + 1),
            name=f"规则{i}",
            description=f"描述{i}",
            json_schema={"type": "object"},
            created_at=now,
            updated_at=now
        )
        for i in range(3)
    ]
    
    mock_rule_repository.list_rules.return_value = rules
    mock_rule_repository.count_rules.return_value = 3
    
    response = client.get("/etl/rules")
    
    assert response.status_code == 200
    data = response.json()
    assert len(data["rules"]) == 3
    assert data["total"] == 3


def test_list_rules_pagination(client, mock_rule_repository):
    """测试规则列表分页"""
    now = datetime.now(UTC)
    rules = [
        ETLRule(
            rule_id=str(i + 1),
            name=f"规则{i}",
            description=f"描述{i}",
            json_schema={"type": "object"},
            created_at=now,
            updated_at=now
        )
        for i in range(5)
    ]
    
    mock_rule_repository.list_rules.return_value = rules[:2]
    mock_rule_repository.count_rules.return_value = 5
    
    response = client.get("/etl/rules?limit=2&offset=0")
    
    assert response.status_code == 200
    data = response.json()
    assert len(data["rules"]) == 2
    assert data["total"] == 5
    assert data["limit"] == 2
    assert data["offset"] == 0
    
    # 验证仓库被正确调用
    # 由于接口会先确保全局默认规则存在（可能触发一次 list_rules），这里仅断言分页调用存在即可
    assert any(
        call.kwargs == {"limit": 2, "offset": 0} for call in mock_rule_repository.list_rules.call_args_list
    )


# ============= 删除规则测试 =============


def test_delete_rule_success(client, mock_rule_repository):
    """测试成功删除规则"""
    mock_rule_repository.delete_rule.return_value = True
    
    response = client.delete("/etl/rules/1")
    
    assert response.status_code == 204
    
    # 验证仓库被调用
    mock_rule_repository.delete_rule.assert_called_once_with("1")


def test_delete_rule_not_found(client, mock_rule_repository):
    """测试删除不存在的规则"""
    mock_rule_repository.delete_rule.return_value = False
    
    response = client.delete("/etl/rules/999999")
    
    assert response.status_code == 404


# ============= 健康检查测试 =============


def test_health_check(client, mock_etl_service):
    """测试健康检查端点"""
    response = client.get("/etl/health")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "queue_size" in data
    assert "task_count" in data
    assert "worker_count" in data


# ============= 集成场景测试 =============


def test_complete_workflow(client, mock_etl_service, mock_rule_repository, sample_rule, sample_task):
    """测试完整的工作流程"""
    # 1. 创建规则
    mock_rule_repository.create_rule.return_value = sample_rule
    
    response = client.post(
        "/etl/rules",
        json={
            "name": "测试规则",
            "description": "测试",
            "json_schema": {"type": "object"}
        }
    )
    assert response.status_code == 201
    rule_id = response.json()["rule_id"]
    
    # 2. upload_and_submit
    sample_task.rule_id = rule_id
    mock_etl_service.submit_etl_task.return_value = sample_task

    response = client.post(
        "/etl/upload_and_submit",
        data={"project_id": "456", "rule_id": str(rule_id)},
        files=[("files", ("test.pdf", b"hello", "application/pdf"))],
    )
    assert response.status_code == 201
    task_id = response.json()["items"][0]["task_id"]
    
    # 3. 查询任务状态
    mock_etl_service.get_task_status_with_access_check.return_value = sample_task
    
    response = client.get(f"/etl/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

