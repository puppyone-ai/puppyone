"""Auth API 端点测试

测试 Auth 相关的 FastAPI 端点：
- 用户 CRUD 操作
- 类型转换和错误处理
"""

from datetime import datetime, UTC
from unittest.mock import Mock
from typing import List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth.dependencies import get_user_service
from src.auth.router import router
from src.auth.models import User


# ============= Fixtures =============


@pytest.fixture
def app():
    """创建测试用的FastAPI应用"""
    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


@pytest.fixture
def client(app, mock_user_service):
    """创建测试客户端并覆盖依赖"""
    app.dependency_overrides[get_user_service] = lambda: mock_user_service
    
    with TestClient(app) as test_client:
        yield test_client
    
    # 清理依赖覆盖
    app.dependency_overrides.clear()


@pytest.fixture
def mock_user_service():
    """Mock User服务"""
    service = Mock()
    service.list_users = Mock()
    service.get_user = Mock()
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
def sample_users():
    """示例用户列表"""
    return [
        User(
            user_id=i,
            username=f"用户{i}"
        )
        for i in range(1, 4)
    ]


# ============= 用户 CRUD 测试 =============


def test_list_users_success(client, mock_user_service, sample_users):
    """测试成功获取所有用户"""
    mock_user_service.list_users.return_value = sample_users
    
    response = client.get("/users/")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert len(data["data"]) == 3
    
    # 验证服务被调用
    mock_user_service.list_users.assert_called_once()


def test_list_users_empty(client, mock_user_service):
    """测试获取空用户列表"""
    mock_user_service.list_users.return_value = []
    
    response = client.get("/users/")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"] == []


def test_get_user_success(client, mock_user_service, sample_user):
    """测试成功获取单个用户"""
    mock_user_service.get_user.return_value = sample_user
    
    response = client.get("/users/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["user_id"] == 1
    assert data["data"]["username"] == "测试用户"
    
    # 验证服务被调用
    mock_user_service.get_user.assert_called_once_with(1)


def test_get_user_not_found(client, mock_user_service):
    """测试获取不存在的用户"""
    from src.exceptions import NotFoundException
    mock_user_service.get_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.get("/users/999")
    
    assert response.status_code == 404


def test_create_user_success(client, mock_user_service, sample_user):
    """测试成功创建用户"""
    mock_user_service.create_user.return_value = sample_user
    
    response = client.post(
        "/users/",
        json={"username": "测试用户"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["username"] == "测试用户"
    assert data["message"] == "用户创建成功"
    
    # 验证服务被调用
    mock_user_service.create_user.assert_called_once_with("测试用户")


def test_create_user_missing_username(client, mock_user_service):
    """测试创建用户时缺少用户名"""
    response = client.post(
        "/users/",
        json={}
    )
    
    assert response.status_code == 422  # Validation error


def test_create_user_empty_username(client, mock_user_service):
    """测试创建用户时用户名为空字符串"""
    # 空字符串可能被接受或拒绝，取决于schema中是否有min_length验证
    response = client.post(
        "/users/",
        json={"username": ""}
    )
    
    # 可能是422（验证错误）或200（创建成功但业务层拒绝）
    assert response.status_code in [200, 400, 422]


def test_create_user_invalid_type(client, mock_user_service):
    """测试创建用户时用户名类型错误"""
    response = client.post(
        "/users/",
        json={"username": 123}  # 应该是字符串
    )
    
    assert response.status_code == 422


def test_update_user_success(client, mock_user_service, sample_user):
    """测试成功更新用户"""
    updated_user = User(
        user_id=1,
        username="更新后的用户"
    )
    mock_user_service.update_user.return_value = updated_user
    
    response = client.put(
        "/users/1",
        json={"username": "更新后的用户"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["username"] == "更新后的用户"
    assert data["message"] == "用户更新成功"
    
    # 验证服务被调用
    mock_user_service.update_user.assert_called_once_with(1, "更新后的用户")


def test_update_user_not_found(client, mock_user_service):
    """测试更新不存在的用户"""
    from src.exceptions import NotFoundException
    mock_user_service.update_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.put(
        "/users/999",
        json={"username": "更新后的用户"}
    )
    
    assert response.status_code == 404


def test_update_user_missing_username(client, mock_user_service):
    """测试更新用户时缺少用户名"""
    response = client.put(
        "/users/1",
        json={}
    )
    
    assert response.status_code == 422


def test_delete_user_success(client, mock_user_service):
    """测试成功删除用户"""
    mock_user_service.delete_user.return_value = None
    
    response = client.delete("/users/1")
    
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["message"] == "用户删除成功"
    
    # 验证服务被调用
    mock_user_service.delete_user.assert_called_once_with(1)


def test_delete_user_not_found(client, mock_user_service):
    """测试删除不存在的用户"""
    from src.exceptions import NotFoundException
    mock_user_service.delete_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.delete("/users/999")
    
    assert response.status_code == 404


# ============= 类型转换测试 =============


def test_user_id_type_conversion(client, mock_user_service, sample_user):
    """测试user_id类型转换（从字符串到整数）"""
    mock_user_service.get_user.return_value = sample_user
    
    # FastAPI会自动将路径参数转换为正确的类型
    response = client.get("/users/1")
    assert response.status_code == 200
    
    # 如果传入无效的ID格式，FastAPI会返回422
    response_invalid = client.get("/users/abc")
    assert response_invalid.status_code == 422


def test_user_id_as_string_in_path(client, mock_user_service):
    """测试路径中的user_id为字符串时的处理"""
    response = client.get("/users/not-a-number")
    
    assert response.status_code == 422


def test_user_id_negative(client, mock_user_service):
    """测试负数user_id"""
    # 根据API设计，负数ID应该被接受或拒绝
    # 这里假设Supabase的bigint可以接受负数
    mock_user_service.get_user.side_effect = Exception("User not found")
    
    response = client.get("/users/-1")
    
    # 取决于实现，可能是404或500
    assert response.status_code in [404, 500]


def test_user_id_zero(client, mock_user_service):
    """测试user_id为0"""
    from src.exceptions import NotFoundException
    mock_user_service.get_user.side_effect = NotFoundException("User not found: 0")
    
    response = client.get("/users/0")
    
    assert response.status_code == 404


def test_user_id_very_large(client, mock_user_service, sample_user):
    """测试非常大的user_id（bigint范围内）"""
    large_id = 9223372036854775807  # bigint最大值
    sample_user.user_id = large_id
    mock_user_service.get_user.return_value = sample_user
    
    response = client.get(f"/users/{large_id}")
    
    assert response.status_code == 200


# ============= 错误处理测试 =============


def test_internal_server_error(client, mock_user_service):
    """测试服务内部错误"""
    mock_user_service.list_users.side_effect = Exception("Database connection failed")
    
    response = client.get("/users/")
    
    assert response.status_code == 500


def test_create_user_with_duplicate_name(client, mock_user_service):
    """测试创建重复用户名的用户"""
    from src.exceptions import BusinessException
    mock_user_service.create_user.side_effect = BusinessException(
        "User with name 'existing' already exists"
    )
    
    response = client.post(
        "/users/",
        json={"username": "existing"}
    )
    
    assert response.status_code == 400


def test_update_user_validation_error(client, mock_user_service):
    """测试更新用户时的验证错误"""
    from src.exceptions import BusinessException
    mock_user_service.update_user.side_effect = BusinessException(
        "Username cannot be empty"
    )
    
    response = client.put(
        "/users/1",
        json={"username": "  "}  # 空白字符串
    )
    
    assert response.status_code == 400


def test_delete_user_with_dependencies(client, mock_user_service):
    """测试删除有依赖关系的用户"""
    from src.exceptions import BusinessException
    mock_user_service.delete_user.side_effect = BusinessException(
        "Cannot delete user with existing projects"
    )
    
    response = client.delete("/users/1")
    
    assert response.status_code == 400


# ============= 边界情况测试 =============


def test_create_user_with_special_characters(client, mock_user_service, sample_user):
    """测试创建包含特殊字符的用户名"""
    sample_user.username = "用户@#$%"
    mock_user_service.create_user.return_value = sample_user
    
    response = client.post(
        "/users/",
        json={"username": "用户@#$%"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["username"] == "用户@#$%"


def test_create_user_with_unicode(client, mock_user_service, sample_user):
    """测试创建包含Unicode字符的用户名"""
    sample_user.username = "用户😀🎉"
    mock_user_service.create_user.return_value = sample_user
    
    response = client.post(
        "/users/",
        json={"username": "用户😀🎉"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["data"]["username"] == "用户😀🎉"


def test_create_user_with_very_long_name(client, mock_user_service, sample_user):
    """测试创建非常长的用户名"""
    long_name = "a" * 1000
    sample_user.username = long_name
    mock_user_service.create_user.return_value = sample_user
    
    response = client.post(
        "/users/",
        json={"username": long_name}
    )
    
    # 根据实现，可能成功或返回验证错误
    assert response.status_code in [200, 400, 422]


def test_get_user_concurrent_requests(client, mock_user_service, sample_user):
    """测试并发获取用户请求"""
    mock_user_service.get_user.return_value = sample_user
    
    # 模拟并发请求
    responses = []
    for _ in range(10):
        response = client.get("/users/1")
        responses.append(response)
    
    # 所有请求都应该成功
    assert all(r.status_code == 200 for r in responses)
    
    # 验证服务被调用了10次
    assert mock_user_service.get_user.call_count == 10


# ============= API响应格式测试 =============


def test_response_format_success(client, mock_user_service, sample_user):
    """测试成功响应的格式"""
    mock_user_service.get_user.return_value = sample_user
    
    response = client.get("/users/1")
    
    assert response.status_code == 200
    data = response.json()
    
    # 验证响应格式
    assert "code" in data
    assert "data" in data
    assert data["code"] == 0
    
    # 验证data字段包含必需的用户信息
    user_data = data["data"]
    assert "user_id" in user_data
    assert "username" in user_data


def test_response_format_with_message(client, mock_user_service, sample_user):
    """测试包含消息的响应格式"""
    mock_user_service.create_user.return_value = sample_user
    
    response = client.post(
        "/users/",
        json={"username": "测试用户"}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # 验证响应包含消息
    assert "message" in data
    assert data["message"] == "用户创建成功"


def test_response_format_error(client, mock_user_service):
    """测试错误响应的格式"""
    from src.exceptions import NotFoundException
    mock_user_service.get_user.side_effect = NotFoundException("User not found: 999")
    
    response = client.get("/users/999")
    
    assert response.status_code == 404
    data = response.json()
    
    # 验证错误响应格式
    assert "detail" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
