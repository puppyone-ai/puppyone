"""API 集成测试

测试所有 API 端点的集成，验证：
- Table 和 Auth API 端点正常工作
- 数据流从请求到响应的完整性
- 类型转换和错误处理
"""

from datetime import datetime, UTC
from unittest.mock import Mock, patch
import pytest

pytest.skip(
    "Legacy integration tests reference removed auth router/user-service",
    allow_module_level=True,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.table.router import router as table_router
from src.auth.router import router as auth_router
from src.table.dependencies import get_table_service
from src.auth.dependencies import get_user_service
from src.table.models import Table
from src.auth.models import User


# ============= Fixtures =============


@pytest.fixture
def app():
    """创建测试用的FastAPI应用"""
    test_app = FastAPI()
    test_app.include_router(table_router)
    test_app.include_router(auth_router)
    return test_app


@pytest.fixture
def client(app, mock_table_service, mock_user_service):
    """创建测试客户端并覆盖依赖"""
    app.dependency_overrides[get_table_service] = lambda: mock_table_service
    app.dependency_overrides[get_user_service] = lambda: mock_user_service
    
    with TestClient(app) as test_client:
        yield test_client
    
    # 清理依赖覆盖
    app.dependency_overrides.clear()


@pytest.fixture
def mock_table_service():
    """Mock Table服务"""
    service = Mock()
    service.get_by_user_id = Mock()
    service.get_by_id = Mock()
    service.create = Mock()
    service.update = Mock()
    service.delete = Mock()
    service.create_context_data = Mock()
    service.get_context_data = Mock()
    service.update_context_data = Mock()
    service.delete_context_data = Mock()
    service.query_context_data_with_jmespath = Mock()
    return service


@pytest.fixture
def mock_user_service():
    """Mock User服务"""
    service = Mock()
    service.get_user = Mock()
    service.list_users = Mock()
    service.create_user = Mock()
    service.update_user = Mock()
    service.delete_user = Mock()
    return service


@pytest.fixture
def sample_user():
    """示例用户"""
    return User(
        user_id=1,
        username="测试用户"
    )


@pytest.fixture
def sample_table():
    """示例表格"""
    return Table(
        id=1,
        name="测试表格",
        project_id=1,
        description="测试用表格",
        data={"users": {"user1": {"name": "Alice", "age": 30}}},
        created_at=datetime.now(UTC)
    )


# ============= 完整工作流集成测试 =============


def test_complete_user_and_table_workflow(client, mock_table_service, mock_user_service, sample_user, sample_table):
    """测试完整的用户和表格工作流程"""
    # 1. 创建用户
    mock_user_service.create_user.return_value = sample_user
    response = client.post("/users/", json={"username": "测试用户"})
    assert response.status_code == 200
    user_id = response.json()["data"]["user_id"]
    
    # 2. 获取用户
    mock_user_service.get_user.return_value = sample_user
    response = client.get(f"/users/{user_id}")
    assert response.status_code == 200
    assert response.json()["data"]["username"] == "测试用户"
    
    # 3. 创建表格
    mock_table_service.create.return_value = sample_table
    response = client.post(
        "/tables/",
        json={
            "project_id": 1,
            "name": "测试表格",
            "description": "测试用表格",
            "data": {"users": {}}
        }
    )
    assert response.status_code == 201
    table_id = response.json()["data"]["id"]
    
    # 4. 获取用户的表格列表
    mock_table_service.get_by_user_id.return_value = [sample_table]
    response = client.get(f"/tables/{user_id}")
    assert response.status_code == 200
    assert len(response.json()["data"]) == 1
    
    # 5. 创建context data
    mock_table_service.create_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    response = client.post(
        f"/tables/{table_id}/data",
        json={
            "mounted_json_pointer_path": "",
            "elements": [{"key": "user1", "content": {"name": "Alice", "age": 30}}]
        }
    )
    assert response.status_code == 201
    
    # 6. 获取context data
    mock_table_service.get_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    response = client.get(f"/tables/{table_id}/data?json_pointer_path=")
    assert response.status_code == 200
    assert "user1" in response.json()["data"]["data"]
    
    # 7. 更新context data
    mock_table_service.update_context_data.return_value = {
        "user1": {"name": "Alice Updated", "age": 31}
    }
    response = client.put(
        f"/tables/{table_id}/data",
        json={
            "json_pointer_path": "",
            "elements": [{"key": "user1", "content": {"name": "Alice Updated", "age": 31}}]
        }
    )
    assert response.status_code == 200
    
    # 8. 删除context data
    mock_table_service.delete_context_data.return_value = {}
    response = client.delete(
        f"/tables/{table_id}/data",
        json={"json_pointer_path": "", "keys": ["user1"]}
    )
    assert response.status_code == 200
    
    # 9. 删除表格
    mock_table_service.delete.return_value = None
    response = client.delete(f"/tables/{table_id}")
    assert response.status_code == 200
    
    # 10. 删除用户
    mock_user_service.delete_user.return_value = None
    response = client.delete(f"/users/{user_id}")
    assert response.status_code == 200


def test_nested_path_operations(client, mock_table_service, sample_table):
    """测试嵌套路径的完整操作流程"""
    table_id = 1
    
    # 1. 在嵌套路径创建数据
    mock_table_service.create_context_data.return_value = {
        "user1": {"name": "Alice"}
    }
    response = client.post(
        f"/tables/{table_id}/data",
        json={
            "mounted_json_pointer_path": "/users",
            "elements": [{"key": "user1", "content": {"name": "Alice"}}]
        }
    )
    assert response.status_code == 201
    
    # 2. 获取嵌套路径的数据
    mock_table_service.get_context_data.return_value = {
        "name": "Alice"
    }
    response = client.get(f"/tables/{table_id}/data?json_pointer_path=/users/user1")
    assert response.status_code == 200
    assert response.json()["data"]["data"]["name"] == "Alice"
    
    # 3. 更新嵌套路径的数据
    mock_table_service.update_context_data.return_value = {
        "user1": {"name": "Alice Updated"}
    }
    response = client.put(
        f"/tables/{table_id}/data",
        json={
            "json_pointer_path": "/users",
            "elements": [{"key": "user1", "content": {"name": "Alice Updated"}}]
        }
    )
    assert response.status_code == 200
    
    # 4. 删除嵌套路径的数据
    mock_table_service.delete_context_data.return_value = {}
    response = client.delete(
        f"/tables/{table_id}/data",
        json={"json_pointer_path": "/users", "keys": ["user1"]}
    )
    assert response.status_code == 200


# ============= 错误处理集成测试 =============


def test_cascading_errors(client, mock_table_service, mock_user_service):
    """测试级联错误处理"""
    # 1. 尝试获取不存在的用户的表格
    from src.exceptions import NotFoundException
    mock_user_service.get_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.get("/tables/999")
    assert response.status_code == 404
    
    # 2. 尝试在不存在的表格上操作
    mock_table_service.get_context_data.side_effect = NotFoundException("Table not found: 999")
    
    response = client.get("/tables/999/data?json_pointer_path=")
    assert response.status_code == 404


def test_validation_errors_across_endpoints(client, mock_table_service, mock_user_service):
    """测试所有端点的验证错误"""
    # 1. 用户端点验证错误
    response = client.post("/users/", json={})
    assert response.status_code == 422
    
    # 2. 表格端点验证错误
    response = client.post("/tables/", json={"name": "test"})
    assert response.status_code == 422
    
    # 3. Context data端点验证错误
    response = client.post(
        "/tables/1/data",
        json={"mounted_json_pointer_path": "", "elements": []}
    )
    # 空elements可能被接受或拒绝，取决于实现
    assert response.status_code in [201, 400, 422]


# ============= 并发操作测试 =============


def test_concurrent_table_operations(client, mock_table_service, sample_table):
    """测试并发的表格操作"""
    mock_table_service.get_by_id.return_value = sample_table
    mock_table_service.get_context_data.return_value = {"users": {}}
    
    # 模拟多个并发请求
    responses = []
    for _ in range(5):
        response = client.get("/tables/1/data?json_pointer_path=")
        responses.append(response)
    
    # 所有请求都应该成功
    assert all(r.status_code == 200 for r in responses)


def test_concurrent_user_operations(client, mock_user_service, sample_user):
    """测试并发的用户操作"""
    mock_user_service.get_user.return_value = sample_user
    
    # 模拟多个并发请求
    responses = []
    for _ in range(5):
        response = client.get("/users/1")
        responses.append(response)
    
    # 所有请求都应该成功
    assert all(r.status_code == 200 for r in responses)


# ============= 类型转换集成测试 =============


def test_id_type_conversion_across_endpoints(client, mock_table_service, mock_user_service, sample_user, sample_table):
    """测试所有端点的ID类型转换"""
    # 1. 用户ID类型转换
    mock_user_service.get_user.return_value = sample_user
    response = client.get("/users/1")
    assert response.status_code == 200
    
    # 2. 表格ID类型转换
    mock_table_service.get_by_user_id.return_value = [sample_table]
    response = client.get("/tables/1")
    assert response.status_code == 200
    
    # 3. Context data操作中的ID类型转换
    mock_table_service.get_context_data.return_value = {}
    response = client.get("/tables/1/data?json_pointer_path=")
    assert response.status_code == 200


def test_invalid_id_types_across_endpoints(client):
    """测试所有端点的无效ID类型"""
    # 1. 无效用户ID
    response = client.get("/users/abc")
    assert response.status_code == 422
    
    # 2. 无效表格ID（在路径中）
    response = client.get("/tables/abc")
    assert response.status_code == 422
    
    # 3. 无效表格ID（在context data操作中）
    response = client.get("/tables/xyz/data?json_pointer_path=")
    assert response.status_code == 422


def test_bigint_boundary_values(client, mock_table_service, mock_user_service, sample_user, sample_table):
    """测试bigint边界值"""
    # 测试最大bigint值
    max_bigint = 9223372036854775807
    
    sample_user.user_id = max_bigint
    mock_user_service.get_user.return_value = sample_user
    response = client.get(f"/users/{max_bigint}")
    assert response.status_code == 200
    
    sample_table.id = max_bigint  # Table uses 'id' not 'table_id'
    mock_table_service.get_context_data.return_value = {}
    response = client.get(f"/tables/{max_bigint}/data?json_pointer_path=")
    assert response.status_code == 200


# ============= 数据一致性测试 =============


def test_data_consistency_across_operations(client, mock_table_service, sample_table):
    """测试操作间的数据一致性"""
    table_id = 1
    
    # 1. 创建数据
    mock_table_service.create_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    response = client.post(
        f"/tables/{table_id}/data",
        json={
            "mounted_json_pointer_path": "",
            "elements": [{"key": "user1", "content": {"name": "Alice", "age": 30}}]
        }
    )
    assert response.status_code == 201
    created_data = response.json()["data"]["data"]
    
    # 2. 获取数据，验证与创建的数据一致
    mock_table_service.get_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    response = client.get(f"/tables/{table_id}/data?json_pointer_path=")
    assert response.status_code == 200
    retrieved_data = response.json()["data"]["data"]
    assert created_data == retrieved_data
    
    # 3. 更新数据
    mock_table_service.update_context_data.return_value = {
        "user1": {"name": "Alice Updated", "age": 31}
    }
    response = client.put(
        f"/tables/{table_id}/data",
        json={
            "json_pointer_path": "",
            "elements": [{"key": "user1", "content": {"name": "Alice Updated", "age": 31}}]
        }
    )
    assert response.status_code == 200
    updated_data = response.json()["data"]["data"]
    
    # 4. 再次获取数据，验证更新生效
    mock_table_service.get_context_data.return_value = {
        "user1": {"name": "Alice Updated", "age": 31}
    }
    response = client.get(f"/tables/{table_id}/data?json_pointer_path=")
    assert response.status_code == 200
    final_data = response.json()["data"]["data"]
    assert updated_data == final_data


# ============= 响应格式一致性测试 =============


def test_response_format_consistency(client, mock_table_service, mock_user_service, sample_user, sample_table):
    """测试所有端点的响应格式一致性"""
    # 1. 用户端点响应格式
    mock_user_service.get_user.return_value = sample_user
    response = client.get("/users/1")
    assert response.status_code == 200
    user_response = response.json()
    assert "success" in user_response
    assert "data" in user_response
    assert user_response["success"] is True
    
    # 2. 表格端点响应格式
    mock_table_service.get_by_user_id.return_value = [sample_table]
    response = client.get("/tables/1")
    assert response.status_code == 200
    table_response = response.json()
    assert "success" in table_response
    assert "data" in table_response
    assert "message" in table_response
    assert table_response["success"] is True
    
    # 3. Context data端点响应格式
    mock_table_service.get_context_data.return_value = {}
    response = client.get("/tables/1/data?json_pointer_path=")
    assert response.status_code == 200
    context_response = response.json()
    assert "success" in context_response
    assert "data" in context_response
    assert "message" in context_response
    assert context_response["success"] is True


def test_error_response_format_consistency(client, mock_table_service, mock_user_service):
    """测试错误响应格式的一致性"""
    from src.exceptions import NotFoundException
    
    # 1. 用户不存在错误
    mock_user_service.get_user.side_effect = NotFoundException("User not found")
    response = client.get("/users/999")
    assert response.status_code == 404
    assert "detail" in response.json()
    
    # 2. 表格不存在错误
    mock_table_service.get_context_data.side_effect = NotFoundException("Table not found")
    response = client.get("/tables/999/data?json_pointer_path=")
    assert response.status_code == 404
    assert "detail" in response.json()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
