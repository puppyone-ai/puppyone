"""MCP Supabase Repository 测试

测试 MCP 模块的 Supabase 存储后端功能
"""

import pytest
from unittest.mock import Mock, MagicMock
from datetime import datetime

from src.mcp.repository import McpInstanceRepositorySupabase
from src.mcp.models import McpInstance
from src.supabase.schemas import McpResponse


# ============= Fixtures =============


@pytest.fixture
def mock_supabase_repo():
    """Mock Supabase Repository"""
    return Mock()


@pytest.fixture
def mcp_supabase_repo(mock_supabase_repo, monkeypatch):
    """创建 McpInstanceRepositorySupabase 实例（带 mock）"""
    repo = McpInstanceRepositorySupabase.__new__(McpInstanceRepositorySupabase)
    repo._repo = mock_supabase_repo
    return repo


@pytest.fixture
def sample_mcp_response():
    """示例 MCP 响应数据"""
    return McpResponse(
        id=1,
        created_at=datetime.now(),
        api_key="test-api-key",
        user_id=100,
        project_id=200,
        table_id=300,
        json_path="/data/users",
        status=True,
        port=8080,
        docker_info={"container_id": "abc123"},
        tools_definition={"get": {"name": "get_tool"}},
        register_tools=["get", "create"],
        preview_keys=["name", "email"],
    )


# ============= 字段映射测试 =============


def test_mcp_response_to_instance_conversion(mcp_supabase_repo, sample_mcp_response):
    """测试 McpResponse 到 McpInstance 的转换"""
    instance = mcp_supabase_repo._mcp_response_to_instance(sample_mcp_response)
    
    # 验证字段映射
    assert instance.mcp_instance_id == "1"  # id → mcp_instance_id (str)
    assert instance.api_key == "test-api-key"
    assert instance.user_id == "100"  # int → str
    assert instance.project_id == "200"  # int → str
    assert instance.table_id == "300"  # int → str
    assert instance.json_pointer == "/data/users"  # json_path → json_pointer
    assert instance.status == 1  # True → 1
    assert instance.port == 8080
    assert instance.docker_info == {"container_id": "abc123"}
    assert instance.tools_definition == {"get": {"name": "get_tool"}}
    assert instance.register_tools == ["get", "create"]
    assert instance.preview_keys == ["name", "email"]


def test_mcp_response_to_instance_with_false_status(mcp_supabase_repo):
    """测试 status 字段的 bool → int 转换（False 情况）"""
    mcp_response = McpResponse(
        id=2,
        created_at=datetime.now(),
        api_key="test-key",
        user_id=1,
        project_id=1,
        table_id=1,
        json_path="",
        status=False,  # False → 0
        port=8080,
        docker_info={},
    )
    
    instance = mcp_supabase_repo._mcp_response_to_instance(mcp_response)
    assert instance.status == 0


def test_mcp_response_to_instance_with_none_values(mcp_supabase_repo):
    """测试处理 None 值的情况"""
    mcp_response = McpResponse(
        id=3,
        created_at=datetime.now(),
        api_key=None,
        user_id=None,
        project_id=None,
        table_id=None,
        json_path=None,
        status=None,
        port=None,
        docker_info=None,
        tools_definition=None,
        register_tools=None,
        preview_keys=None,
    )
    
    instance = mcp_supabase_repo._mcp_response_to_instance(mcp_response)
    assert instance.mcp_instance_id == "3"
    assert instance.api_key == ""
    assert instance.user_id == ""
    assert instance.project_id == ""
    assert instance.table_id == ""
    assert instance.json_pointer == ""
    assert instance.status == 0  # None → False → 0
    assert instance.port == 0
    assert instance.docker_info == {}


# ============= CRUD 操作测试 =============


def test_get_by_id_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试根据 ID 获取 MCP 实例（成功）"""
    mock_supabase_repo.get_mcp.return_value = sample_mcp_response
    
    instance = mcp_supabase_repo.get_by_id("1")
    
    assert instance is not None
    assert instance.mcp_instance_id == "1"
    mock_supabase_repo.get_mcp.assert_called_once_with(1)


def test_get_by_id_not_found(mcp_supabase_repo, mock_supabase_repo):
    """测试根据 ID 获取 MCP 实例（不存在）"""
    mock_supabase_repo.get_mcp.return_value = None
    
    instance = mcp_supabase_repo.get_by_id("999")
    
    assert instance is None
    mock_supabase_repo.get_mcp.assert_called_once_with(999)


def test_get_by_id_invalid_id(mcp_supabase_repo, mock_supabase_repo):
    """测试根据无效 ID 获取 MCP 实例"""
    instance = mcp_supabase_repo.get_by_id("invalid")
    
    assert instance is None
    mock_supabase_repo.get_mcp.assert_not_called()


def test_get_by_api_key_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试根据 API Key 获取 MCP 实例（成功）"""
    mock_supabase_repo.get_mcp_by_api_key.return_value = sample_mcp_response
    
    instance = mcp_supabase_repo.get_by_api_key("test-api-key")
    
    assert instance is not None
    assert instance.api_key == "test-api-key"
    mock_supabase_repo.get_mcp_by_api_key.assert_called_once_with("test-api-key")


def test_get_by_user_id_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试根据 user_id 获取 MCP 实例列表"""
    mock_supabase_repo.get_mcps.return_value = [sample_mcp_response]
    
    instances = mcp_supabase_repo.get_by_user_id("100")
    
    assert len(instances) == 1
    assert instances[0].user_id == "100"
    mock_supabase_repo.get_mcps.assert_called_once_with(user_id=100)


def test_create_mcp_instance(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试创建 MCP 实例"""
    mock_supabase_repo.create_mcp.return_value = sample_mcp_response
    
    instance = mcp_supabase_repo.create(
        api_key="test-api-key",
        user_id="100",
        project_id="200",
        table_id="300",
        json_pointer="/data/users",
        status=1,
        port=8080,
        docker_info={"container_id": "abc123"},
        tools_definition={"get": {"name": "get_tool"}},
        register_tools=["get", "create"],
    )
    
    assert instance is not None
    assert instance.mcp_instance_id == "1"
    assert instance.json_pointer == "/data/users"
    assert instance.status == 1
    
    # 验证传递给 Supabase 的数据进行了正确的字段映射
    call_args = mock_supabase_repo.create_mcp.call_args[0][0]
    assert call_args.json_path == "/data/users"  # json_pointer → json_path
    assert call_args.status is True  # 1 → True
    assert call_args.user_id == 100  # str → int


def test_update_by_id_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试根据 ID 更新 MCP 实例"""
    mock_supabase_repo.update_mcp.return_value = sample_mcp_response
    
    instance = mcp_supabase_repo.update_by_id(
        mcp_instance_id="1",
        api_key="updated-key",
        user_id="100",
        project_id="200",
        table_id="300",
        json_pointer="/updated/path",
        status=0,
        port=9090,
        docker_info={"updated": "info"},
    )
    
    assert instance is not None
    mock_supabase_repo.update_mcp.assert_called_once()
    
    # 验证字段映射
    call_args = mock_supabase_repo.update_mcp.call_args
    assert call_args[0][0] == 1  # mcp_id
    assert call_args[0][1].json_path == "/updated/path"  # json_pointer → json_path
    assert call_args[0][1].status is False  # 0 → False


def test_update_by_api_key_success(mcp_supabase_repo, mock_supabase_repo, sample_mcp_response):
    """测试根据 API Key 更新 MCP 实例"""
    mock_supabase_repo.update_mcp_by_api_key.return_value = sample_mcp_response
    
    instance = mcp_supabase_repo.update_by_api_key(
        api_key="test-api-key",
        user_id="100",
        project_id="200",
        table_id="300",
        json_pointer="/updated/path",
        status=1,
        port=8080,
        docker_info={},
    )
    
    assert instance is not None
    mock_supabase_repo.update_mcp_by_api_key.assert_called_once()


def test_delete_by_id_success(mcp_supabase_repo, mock_supabase_repo):
    """测试根据 ID 删除 MCP 实例（成功）"""
    mock_supabase_repo.delete_mcp.return_value = True
    
    result = mcp_supabase_repo.delete_by_id("1")
    
    assert result is True
    mock_supabase_repo.delete_mcp.assert_called_once_with(1)


def test_delete_by_id_not_found(mcp_supabase_repo, mock_supabase_repo):
    """测试根据 ID 删除 MCP 实例（不存在）"""
    mock_supabase_repo.delete_mcp.return_value = False
    
    result = mcp_supabase_repo.delete_by_id("999")
    
    assert result is False


def test_delete_by_api_key_success(mcp_supabase_repo, mock_supabase_repo):
    """测试根据 API Key 删除 MCP 实例"""
    mock_supabase_repo.delete_mcp_by_api_key.return_value = True
    
    result = mcp_supabase_repo.delete_by_api_key("test-api-key")
    
    assert result is True
    mock_supabase_repo.delete_mcp_by_api_key.assert_called_once_with("test-api-key")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
