"""MCP Table Tool 测试

测试 MCP 服务中的 Table 工具功能：
- Table 操作（create, update, delete, query, preview, select）
- 与 Table Service 的集成
"""

from datetime import datetime, UTC
from unittest.mock import Mock, patch
import pytest

from src.mcp.server.tools.table_tool import TableTool
from src.table.models import Table
from src.exceptions import NotFoundException, BusinessException


# ============= Fixtures =============


@pytest.fixture
def mock_table_service():
    """Mock Table服务"""
    service = Mock()
    service.get_by_id = Mock()
    service.create_context_data = Mock()
    service.get_context_data = Mock()
    service.update_context_data = Mock()
    service.delete_context_data = Mock()
    service.query_context_data_with_jmespath = Mock()
    service.get_context_structure = Mock()
    return service


@pytest.fixture
def table_tool():
    """创建 TableTool 实例"""
    return TableTool()


@pytest.fixture
def sample_table():
    """示例表格"""
    return Table(
        id=1,
        name="测试表格",
        project_id=1,
        description="测试用表格",
        data={
            "users": {
                "user1": {"name": "Alice", "age": 30},
                "user2": {"name": "Bob", "age": 25}
            }
        },
        created_at=datetime.now(UTC)
    )


# ============= 工具描述生成测试 =============


def test_generate_tool_description_create(table_tool):
    """测试生成创建工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="create",
        project_description="项目描述",
        table_description="表格描述"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "创建" in description or "create" in description.lower()


def test_generate_tool_description_update(table_tool):
    """测试生成更新工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="update"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "更新" in description or "update" in description.lower()


def test_generate_tool_description_delete(table_tool):
    """测试生成删除工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="delete"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "删除" in description or "delete" in description.lower()


def test_generate_tool_description_query(table_tool):
    """测试生成查询工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="query"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "查询" in description or "query" in description.lower()


def test_generate_tool_description_preview(table_tool):
    """测试生成预览工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="preview"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "预览" in description or "preview" in description.lower()


def test_generate_tool_description_select(table_tool):
    """测试生成选择工具的描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="select"
    )
    
    assert "测试项目" in description
    assert "测试表格" in description
    assert "选择" in description or "select" in description.lower()


def test_generate_tool_description_with_metadata(table_tool):
    """测试生成包含元数据的工具描述"""
    description = table_tool.generate_tool_description(
        project_name="测试项目",
        table_name="测试表格",
        tool_type="create",
        project_metadata={"version": "1.0"},
        table_metadata={"schema": "v1"}  # 注意：table_metadata已废弃
    )
    
    assert "测试项目" in description
    assert "测试表格" in description


# ============= Create 工具测试 =============


def test_create_tool_success(table_tool, mock_table_service, sample_table):
    """测试成功创建数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.create_context_data.return_value = {
            "user3": {"name": "Charlie", "age": 35}
        }
        
        result = table_tool.create(
            table_id=1,
            mounted_json_pointer_path="",
            elements=[{"key": "user3", "content": {"name": "Charlie", "age": 35}}]
        )
        
        assert "user3" in str(result)
        mock_table_service.create_context_data.assert_called_once()


def test_create_tool_duplicate_key(table_tool, mock_table_service):
    """测试创建重复key时的错误处理"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.create_context_data.side_effect = BusinessException(
            "Key 'user1' already exists"
        )
        
        with pytest.raises(BusinessException):
            table_tool.create(
                table_id=1,
                mounted_json_pointer_path="",
                elements=[{"key": "user1", "content": {"name": "Alice"}}]
            )


def test_create_tool_invalid_path(table_tool, mock_table_service):
    """测试创建数据时路径无效"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.create_context_data.side_effect = BusinessException(
            "Path not found: /nonexistent"
        )
        
        with pytest.raises(BusinessException):
            table_tool.create(
                table_id=1,
                mounted_json_pointer_path="/nonexistent",
                elements=[{"key": "test", "content": "value"}]
            )


# ============= Update 工具测试 =============


def test_update_tool_success(table_tool, mock_table_service):
    """测试成功更新数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.update_context_data.return_value = {
            "user1": {"name": "Alice Updated", "age": 31}
        }
        
        result = table_tool.update(
            table_id=1,
            json_pointer_path="",
            elements=[{"key": "user1", "content": {"name": "Alice Updated", "age": 31}}]
        )
        
        assert "Alice Updated" in str(result)
        mock_table_service.update_context_data.assert_called_once()


def test_update_tool_key_not_found(table_tool, mock_table_service):
    """测试更新不存在的key"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.update_context_data.side_effect = NotFoundException(
            "Key 'nonexistent' not found"
        )
        
        with pytest.raises(NotFoundException):
            table_tool.update(
                table_id=1,
                json_pointer_path="",
                elements=[{"key": "nonexistent", "content": {"name": "Test"}}]
            )


# ============= Delete 工具测试 =============


def test_delete_tool_success(table_tool, mock_table_service):
    """测试成功删除数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.delete_context_data.return_value = {
            "user2": {"name": "Bob", "age": 25}
        }
        
        result = table_tool.delete(
            table_id=1,
            json_pointer_path="",
            keys=["user1"]
        )
        
        assert "user2" in str(result)
        mock_table_service.delete_context_data.assert_called_once()


def test_delete_tool_key_not_found(table_tool, mock_table_service):
    """测试删除不存在的key"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.delete_context_data.side_effect = NotFoundException(
            "Key 'nonexistent' not found"
        )
        
        with pytest.raises(NotFoundException):
            table_tool.delete(
                table_id=1,
                json_pointer_path="",
                keys=["nonexistent"]
            )


def test_delete_multiple_keys(table_tool, mock_table_service):
    """测试删除多个key"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.delete_context_data.return_value = {}
        
        result = table_tool.delete(
            table_id=1,
            json_pointer_path="",
            keys=["user1", "user2"]
        )
        
        mock_table_service.delete_context_data.assert_called_once_with(
            table_id=1,
            json_pointer_path="",
            keys=["user1", "user2"]
        )


# ============= Query 工具测试 =============


def test_query_tool_success(table_tool, mock_table_service):
    """测试成功查询数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.query_context_data_with_jmespath.return_value = [
            {"name": "Alice", "age": 30}
        ]
        
        result = table_tool.query(
            table_id=1,
            json_pointer_path="",
            query="users[?age > `25`]"
        )
        
        assert "Alice" in str(result)
        mock_table_service.query_context_data_with_jmespath.assert_called_once()


def test_query_tool_empty_result(table_tool, mock_table_service):
    """测试查询返回空结果"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.query_context_data_with_jmespath.return_value = []
        
        result = table_tool.query(
            table_id=1,
            json_pointer_path="",
            query="users[?age > `100`]"
        )
        
        assert result == []


def test_query_tool_invalid_jmespath(table_tool, mock_table_service):
    """测试无效的JMESPath查询"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.query_context_data_with_jmespath.side_effect = BusinessException(
            "JMESPath syntax error"
        )
        
        with pytest.raises(BusinessException):
            table_tool.query(
                table_id=1,
                json_pointer_path="",
                query="users[?age >"  # 语法错误
            )


# ============= Preview 工具测试 =============


def test_preview_tool_success(table_tool, mock_table_service):
    """测试成功预览数据结构"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.get_context_structure.return_value = {
            "users": {
                "user1": {"name": "<str>", "age": "<int>"}
            }
        }
        
        result = table_tool.preview(
            table_id=1,
            json_pointer_path=""
        )
        
        assert "users" in str(result)
        mock_table_service.get_context_structure.assert_called_once()


def test_preview_tool_nested_path(table_tool, mock_table_service):
    """测试预览嵌套路径的数据结构"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.get_context_structure.return_value = {
            "user1": {"name": "<str>", "age": "<int>"}
        }
        
        result = table_tool.preview(
            table_id=1,
            json_pointer_path="/users"
        )
        
        assert "user1" in str(result)


# ============= Select 工具测试 =============


def test_select_tool_success(table_tool, mock_table_service):
    """测试成功选择数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.get_context_data.return_value = {
            "user1": {"name": "Alice", "age": 30}
        }
        
        result = table_tool.select(
            table_id=1,
            json_pointer_path=""
        )
        
        assert "Alice" in str(result)
        mock_table_service.get_context_data.assert_called_once()


def test_select_tool_nested_path(table_tool, mock_table_service):
    """测试选择嵌套路径的数据"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.get_context_data.return_value = {
            "name": "Alice",
            "age": 30
        }
        
        result = table_tool.select(
            table_id=1,
            json_pointer_path="/users/user1"
        )
        
        assert "Alice" in str(result)


def test_select_tool_path_not_found(table_tool, mock_table_service):
    """测试选择不存在的路径"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.get_context_data.side_effect = NotFoundException(
            "Path not found: /nonexistent"
        )
        
        with pytest.raises(NotFoundException):
            table_tool.select(
                table_id=1,
                json_pointer_path="/nonexistent"
            )


# ============= 集成测试 =============


def test_table_tool_workflow(table_tool, mock_table_service):
    """测试完整的工作流程"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        # 1. 预览数据结构
        mock_table_service.get_context_structure.return_value = {
            "users": {}
        }
        preview_result = table_tool.preview(table_id=1, json_pointer_path="")
        assert "users" in str(preview_result)
        
        # 2. 创建数据
        mock_table_service.create_context_data.return_value = {
            "user1": {"name": "Alice", "age": 30}
        }
        create_result = table_tool.create(
            table_id=1,
            mounted_json_pointer_path="",
            elements=[{"key": "user1", "content": {"name": "Alice", "age": 30}}]
        )
        assert "Alice" in str(create_result)
        
        # 3. 查询数据
        mock_table_service.query_context_data_with_jmespath.return_value = [
            {"name": "Alice", "age": 30}
        ]
        query_result = table_tool.query(
            table_id=1,
            json_pointer_path="",
            query="users[*]"
        )
        assert len(query_result) == 1
        
        # 4. 更新数据
        mock_table_service.update_context_data.return_value = {
            "user1": {"name": "Alice Updated", "age": 31}
        }
        update_result = table_tool.update(
            table_id=1,
            json_pointer_path="",
            elements=[{"key": "user1", "content": {"name": "Alice Updated", "age": 31}}]
        )
        assert "Alice Updated" in str(update_result)
        
        # 5. 删除数据
        mock_table_service.delete_context_data.return_value = {}
        delete_result = table_tool.delete(
            table_id=1,
            json_pointer_path="",
            keys=["user1"]
        )
        
        # 验证所有方法都被调用
        mock_table_service.get_context_structure.assert_called()
        mock_table_service.create_context_data.assert_called()
        mock_table_service.query_context_data_with_jmespath.assert_called()
        mock_table_service.update_context_data.assert_called()
        mock_table_service.delete_context_data.assert_called()


# ============= 错误处理测试 =============


def test_table_not_found_in_all_operations(table_tool, mock_table_service):
    """测试所有操作中table不存在的情况"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        mock_table_service.create_context_data.side_effect = NotFoundException(
            "Table not found: 999"
        )
        
        with pytest.raises(NotFoundException):
            table_tool.create(
                table_id=999,
                mounted_json_pointer_path="",
                elements=[{"key": "test", "content": "value"}]
            )


def test_invalid_table_id_type(table_tool, mock_table_service):
    """测试无效的table_id类型"""
    with patch('src.mcp.server.tools.table_tool.get_table_service', return_value=mock_table_service):
        # Python的类型系统在运行时不强制检查，但我们可以测试业务逻辑
        # 如果传入字符串ID，会在repository层面失败
        mock_table_service.get_context_data.side_effect = Exception("Invalid table_id type")
        
        with pytest.raises(Exception):
            table_tool.select(
                table_id="abc",  # type: ignore
                json_pointer_path=""
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
