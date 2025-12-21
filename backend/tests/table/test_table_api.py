"""Table API 端点测试

测试 Table 相关的 FastAPI 端点：
- Table CRUD 操作
- Context Data 操作（create, get, update, delete）
- JMESPath 查询功能
"""

from datetime import datetime, UTC
from unittest.mock import Mock, patch
from typing import List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.table.dependencies import get_table_service
from src.table.router import router
from src.table.models import Table
from src.auth.dependencies import get_user_service
from src.auth.models import User


# ============= Fixtures =============


@pytest.fixture
def app():
    """创建测试用的FastAPI应用"""
    test_app = FastAPI()
    test_app.include_router(router)
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


@pytest.fixture
def sample_tables():
    """示例表格列表"""
    return [
        Table(
            id=i,
            name=f"表格{i}",
            project_id=1,
            description=f"描述{i}",
            data={},
            created_at=datetime.now(UTC)
        )
        for i in range(1, 4)
    ]


# ============= Table CRUD 测试 =============


def test_list_tables_success(client, mock_table_service, mock_user_service, sample_user, sample_tables):
    """测试成功获取用户的所有表格"""
    mock_user_service.get_user.return_value = sample_user
    mock_table_service.get_by_user_id.return_value = sample_tables
    
    response = client.get("/tables/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert len(data["data"]) == 3
    assert data["message"] == "表格列表获取成功"
    
    # 验证服务被调用
    mock_user_service.get_user.assert_called_once_with(1)
    mock_table_service.get_by_user_id.assert_called_once_with(1)


def test_list_tables_user_not_found(client, mock_table_service, mock_user_service):
    """测试获取不存在用户的表格列表"""
    from src.exceptions import NotFoundException
    mock_user_service.get_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.get("/tables/999")
    
    assert response.status_code == 404


def test_create_table_success(client, mock_table_service, sample_table):
    """测试成功创建表格"""
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
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["name"] == "测试表格"
    assert data["message"] == "表格创建成功"
    
    # 验证服务被调用
    mock_table_service.create.assert_called_once_with(
        project_id=1,
        name="测试表格",
        description="测试用表格",
        data={"users": {}}
    )


def test_create_table_without_data(client, mock_table_service, sample_table):
    """测试创建表格时不提供data字段"""
    sample_table.data = {}
    mock_table_service.create.return_value = sample_table
    
    response = client.post(
        "/tables/",
        json={
            "project_id": 1,
            "name": "测试表格",
            "description": "测试用表格"
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["code"] == 0
    
    # 验证服务被调用时data为空字典
    mock_table_service.create.assert_called_once_with(
        project_id=1,
        name="测试表格",
        description="测试用表格",
        data={}
    )


def test_create_table_missing_required_fields(client, mock_table_service):
    """测试创建表格时缺少必需字段"""
    response = client.post(
        "/tables/",
        json={
            "name": "测试表格"
            # 缺少 project_id 和 description
        }
    )
    
    assert response.status_code == 422  # Validation error


def test_update_table_success(client, mock_table_service, sample_table):
    """测试成功更新表格"""
    updated_table = Table(
        id=1,
        name="更新后的表格",
        project_id=1,
        description="更新后的描述",
        data={"users": {"user2": {"name": "Bob"}}},
        created_at=sample_table.created_at
    )
    mock_table_service.update.return_value = updated_table
    
    response = client.put(
        "/tables/1",
        json={
            "name": "更新后的表格",
            "description": "更新后的描述",
            "data": {"users": {"user2": {"name": "Bob"}}}
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["name"] == "更新后的表格"
    assert data["message"] == "表格更新成功"


def test_update_table_not_found(client, mock_table_service):
    """测试更新不存在的表格"""
    from src.exceptions import NotFoundException
    mock_table_service.update.side_effect = NotFoundException("Table not found: 999")
    
    response = client.put(
        "/tables/999",
        json={
            "name": "更新后的表格",
            "description": "更新后的描述"
        }
    )
    
    assert response.status_code == 404


def test_update_table_with_empty_data(client, mock_table_service, sample_table):
    """测试更新表格时data为空（不更新data字段）"""
    mock_table_service.update.return_value = sample_table
    
    response = client.put(
        "/tables/1",
        json={
            "name": "更新后的表格",
            "description": "更新后的描述",
            "data": {}
        }
    )
    
    assert response.status_code == 200
    
    # 验证服务被调用时data为None
    mock_table_service.update.assert_called_once_with(
        table_id=1,
        name="更新后的表格",
        description="更新后的描述",
        data=None
    )


def test_delete_table_success(client, mock_table_service):
    """测试成功删除表格"""
    mock_table_service.delete.return_value = None
    
    response = client.delete("/tables/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["message"] == "表格删除成功"
    
    # 验证服务被调用
    mock_table_service.delete.assert_called_once_with(1)


def test_delete_table_not_found(client, mock_table_service):
    """测试删除不存在的表格"""
    from src.exceptions import NotFoundException
    mock_table_service.delete.side_effect = NotFoundException("Table not found: 999")
    
    response = client.delete("/tables/999")
    
    assert response.status_code == 404


# ============= Context Data 测试 =============


def test_create_context_data_success(client, mock_table_service):
    """测试成功创建context data"""
    mock_table_service.create_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    
    response = client.post(
        "/tables/1/data",
        json={
            "mounted_json_pointer_path": "",
            "elements": [
                {"key": "user1", "content": {"name": "Alice", "age": 30}}
            ]
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["code"] == 0
    assert "user1" in data["data"]["data"]
    assert data["message"] == "数据创建成功"
    
    # 验证服务被调用
    mock_table_service.create_context_data.assert_called_once_with(
        table_id=1,
        mounted_json_pointer_path="",
        elements=[{"key": "user1", "content": {"name": "Alice", "age": 30}}]
    )


def test_create_context_data_at_nested_path(client, mock_table_service):
    """测试在嵌套路径下创建context data"""
    mock_table_service.create_context_data.return_value = {
        "user1": {"name": "Alice"}
    }
    
    response = client.post(
        "/tables/1/data",
        json={
            "mounted_json_pointer_path": "/users",
            "elements": [
                {"key": "user1", "content": {"name": "Alice"}}
            ]
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["code"] == 0


def test_create_context_data_duplicate_key(client, mock_table_service):
    """测试创建context data时key已存在"""
    from src.exceptions import BusinessException
    mock_table_service.create_context_data.side_effect = BusinessException(
        "Key 'user1' already exists"
    )
    
    response = client.post(
        "/tables/1/data",
        json={
            "mounted_json_pointer_path": "",
            "elements": [
                {"key": "user1", "content": {"name": "Alice"}}
            ]
        }
    )
    
    assert response.status_code == 400


def test_get_context_data_success(client, mock_table_service):
    """测试成功获取context data"""
    mock_table_service.get_context_data.return_value = {
        "user1": {"name": "Alice", "age": 30}
    }
    
    response = client.get("/tables/1/data?json_pointer_path=")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert "user1" in data["data"]["data"]
    assert data["message"] == "数据获取成功"


def test_get_context_data_at_nested_path(client, mock_table_service):
    """测试获取嵌套路径的context data"""
    mock_table_service.get_context_data.return_value = {
        "name": "Alice",
        "age": 30
    }
    
    response = client.get("/tables/1/data?json_pointer_path=/users/user1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["data"]["name"] == "Alice"


def test_get_context_data_not_found(client, mock_table_service):
    """测试获取不存在的context data"""
    from src.exceptions import NotFoundException
    mock_table_service.get_context_data.side_effect = NotFoundException(
        "Path not found: /nonexistent"
    )
    
    response = client.get("/tables/1/data?json_pointer_path=/nonexistent")
    
    assert response.status_code == 404


def test_update_context_data_success(client, mock_table_service):
    """测试成功更新context data"""
    mock_table_service.update_context_data.return_value = {
        "user1": {"name": "Alice Updated", "age": 31}
    }
    
    response = client.put(
        "/tables/1/data",
        json={
            "json_pointer_path": "",
            "elements": [
                {"key": "user1", "content": {"name": "Alice Updated", "age": 31}}
            ]
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["data"]["user1"]["name"] == "Alice Updated"
    assert data["message"] == "数据更新成功"


def test_update_context_data_key_not_found(client, mock_table_service):
    """测试更新不存在的key"""
    from src.exceptions import NotFoundException
    mock_table_service.update_context_data.side_effect = NotFoundException(
        "Key 'nonexistent' not found"
    )
    
    response = client.put(
        "/tables/1/data",
        json={
            "json_pointer_path": "",
            "elements": [
                {"key": "nonexistent", "content": {"name": "Bob"}}
            ]
        }
    )
    
    assert response.status_code == 404


def test_delete_context_data_success(client, mock_table_service):
    """测试成功删除context data"""
    import json as json_lib
    mock_table_service.delete_context_data.return_value = {}
    
    response = client.request(
        "DELETE",
        "/tables/1/data",
        content=json_lib.dumps({
            "json_pointer_path": "",
            "keys": ["user1"]
        }),
        headers={"Content-Type": "application/json"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["message"] == "数据删除成功"
    
    # 验证服务被调用
    mock_table_service.delete_context_data.assert_called_once_with(
        table_id=1,
        json_pointer_path="",
        keys=["user1"]
    )


def test_delete_context_data_key_not_found(client, mock_table_service):
    """测试删除不存在的key"""
    import json as json_lib
    from src.exceptions import NotFoundException
    mock_table_service.delete_context_data.side_effect = NotFoundException(
        "Key 'nonexistent' not found"
    )
    
    response = client.request(
        "DELETE",
        "/tables/1/data",
        content=json_lib.dumps({
            "json_pointer_path": "",
            "keys": ["nonexistent"]
        }),
        headers={"Content-Type": "application/json"}
    )
    
    assert response.status_code == 404


def test_delete_multiple_context_data(client, mock_table_service):
    """测试删除多个context data"""
    import json as json_lib
    mock_table_service.delete_context_data.return_value = {
        "user3": {"name": "Charlie"}
    }
    
    response = client.request(
        "DELETE",
        "/tables/1/data",
        content=json_lib.dumps({
            "json_pointer_path": "",
            "keys": ["user1", "user2"]
        }),
        headers={"Content-Type": "application/json"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0


# ============= 类型转换测试 =============


def test_table_id_type_conversion(client, mock_table_service):
    """测试table_id类型转换（从字符串到整数）"""
    mock_table_service.get_context_data.return_value = {}
    
    # FastAPI会自动将路径参数转换为正确的类型
    response = client.get("/tables/1/data?json_pointer_path=")
    assert response.status_code == 200
    
    # 如果传入无效的ID格式，FastAPI会返回422
    response_invalid = client.delete("/tables/abc")
    assert response_invalid.status_code == 422


def test_user_id_type_conversion(client, mock_table_service, mock_user_service, sample_user, sample_tables):
    """测试user_id类型转换"""
    mock_user_service.get_user.return_value = sample_user
    mock_table_service.get_by_user_id.return_value = sample_tables
    
    response = client.get("/tables/1")
    assert response.status_code == 200
    
    # 测试无效的user_id
    response_invalid = client.get("/tables/abc")
    assert response_invalid.status_code == 422


def test_project_id_type_in_create(client, mock_table_service, sample_table):
    """测试创建表格时project_id类型"""
    mock_table_service.create.return_value = sample_table
    
    # 正确的类型
    response = client.post(
        "/tables/",
        json={
            "project_id": 1,
            "name": "测试",
            "description": "测试"
        }
    )
    assert response.status_code == 201
    
    # 错误的类型
    response_invalid = client.post(
        "/tables/",
        json={
            "project_id": "abc",  # 应该是整数
            "name": "测试",
            "description": "测试"
        }
    )
    assert response_invalid.status_code == 422


# ============= 错误处理测试 =============


def test_invalid_json_pointer_path(client, mock_table_service):
    """测试无效的JSON指针路径"""
    from src.exceptions import BusinessException
    mock_table_service.get_context_data.side_effect = BusinessException(
        "Invalid path: invalid format"
    )
    
    response = client.get("/tables/1/data?json_pointer_path=invalid")
    
    assert response.status_code == 400


def test_path_points_to_non_dict(client, mock_table_service):
    """测试路径指向非字典类型的节点"""
    from src.exceptions import BusinessException
    mock_table_service.create_context_data.side_effect = BusinessException(
        "Path points to non-dict node"
    )
    
    response = client.post(
        "/tables/1/data",
        json={
            "mounted_json_pointer_path": "/users/user1/name",
            "elements": [{"key": "test", "content": "value"}]
        }
    )
    
    assert response.status_code == 400


def test_missing_element_fields(client, mock_table_service):
    """测试element缺少必需字段"""
    # 缺少content字段
    response = client.post(
        "/tables/1/data",
        json={
            "mounted_json_pointer_path": "",
            "elements": [{"key": "test"}]  # 缺少content
        }
    )
    
    assert response.status_code == 422


def test_table_not_found_in_context_operations(client, mock_table_service):
    """测试context操作时table不存在"""
    from src.exceptions import NotFoundException
    mock_table_service.get_context_data.side_effect = NotFoundException(
        "Table not found: 999"
    )
    
    response = client.get("/tables/999/data?json_pointer_path=")
    
    assert response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
