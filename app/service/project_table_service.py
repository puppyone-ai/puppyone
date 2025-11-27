"""
项目表数据服务
用于 MCP server 访问项目表数据（支持 JSON Pointer）
"""
from typing import Dict, Any, Optional, Tuple
from jsonpointer import resolve_pointer, set_pointer
import json
import jmespath
from app.core.dependencies import get_project_service
from app.core.exceptions import NotFoundException, BusinessException, ErrorCode
from app.utils.logger import log_error, log_info


class ProjectTableService:
    """项目表数据服务，用于 MCP server 访问表数据"""
    
    def __init__(self):
        self.project_service = get_project_service()
    
    def get_table_data(self, project_id: str, table_id: str, json_pointer_path: str = "") -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        获取表数据中指定路径的数据
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径，默认为空字符串表示根路径
        
        Returns:
            (success, error_message, data) 元组
        """
        try:
            # 获取表数据
            table_data_list = self.project_service.get_table_data(project_id, table_id)
            
            if not table_data_list or len(table_data_list) == 0:
                return (False, "表数据为空", None)
            
            # 表数据可能是列表或字典
            # 如果是列表，取第一个元素（通常是文件夹结构导入的字典）
            # 如果是字典，直接使用
            if isinstance(table_data_list, list) and len(table_data_list) > 0:
                table_data = table_data_list[0]
            else:
                table_data = table_data_list
            
            # 如果 json_pointer_path 为空，返回整个数据
            if not json_pointer_path:
                return (True, None, table_data)
            
            # 使用 JSON Pointer 解析指定路径
            try:
                data = resolve_pointer(table_data, json_pointer_path, None)
                if data is None:
                    return (False, f"路径不存在: {json_pointer_path}", None)
                return (True, None, data)
            except Exception as e:
                return (False, f"无效的路径: {str(e)}", None)
                
        except NotFoundException as e:
            return (False, str(e), None)
        except Exception as e:
            log_error(f"Failed to get table data: {e}")
            return (False, f"获取表数据失败: {str(e)}", None)
    
    def query_table_data_with_jmespath(
        self, 
        project_id: str, 
        table_id: str,
        json_pointer_path: str,
        query: str
    ) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        使用 JMESPath 查询表数据中指定路径的数据
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径
            query: JMESPath 查询字符串
        
        Returns:
            (success, error_message, data) 元组
        """
        try:
            # 先获取指定路径的数据
            success, error_msg, base_data = self.get_table_data(project_id, table_id, json_pointer_path)
            if not success:
                return (False, error_msg, None)
            
            if base_data is None:
                return (False, f"路径不存在: {json_pointer_path}", None)
            
            # 使用 JMESPath 查询数据
            try:
                result = jmespath.search(query, base_data)
                return (True, None, result)
            except jmespath.exceptions.ParseError as e:
                return (False, f"JMESPath 语法错误: {str(e)}", None)
            except Exception as e:
                return (False, f"查询失败: {str(e)}", None)
                
        except Exception as e:
            log_error(f"Failed to query table data with JMESPath: {e}")
            return (False, f"查询失败: {str(e)}", None)
    
    def get_table_structure(
        self, 
        project_id: str, 
        table_id: str,
        json_pointer_path: str = ""
    ) -> Tuple[bool, Optional[str], Optional[Dict]]:
        """
        获取表数据的结构（不包含实际数据值）
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径
        
        Returns:
            (success, error_message, structure) 元组
        """
        try:
            success, error_msg, data = self.get_table_data(project_id, table_id, json_pointer_path)
            if not success:
                return (False, error_msg, None)
            
            if data is None:
                return (False, f"路径不存在: {json_pointer_path}", None)
            
            # 提取结构信息
            structure = self._extract_structure(data)
            return (True, None, structure)
            
        except Exception as e:
            log_error(f"Failed to get table structure: {e}")
            return (False, f"获取结构失败: {str(e)}", None)
    
    def create_table_data(
        self,
        project_id: str,
        table_id: str,
        json_pointer_path: str,
        elements: list
    ) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        在表数据的指定路径下创建新数据
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径（挂载点）
            elements: 要创建的元素列表，每个元素包含 key 和 content
        
        Returns:
            (success, error_message, result_data) 元组
        """
        try:
            # 获取当前表数据
            table_data_list = self.project_service.get_table_data(project_id, table_id)
            
            if not table_data_list or len(table_data_list) == 0:
                # 如果表数据为空，创建一个新的字典
                table_data = {}
            else:
                # 取第一个元素（通常是字典）
                if isinstance(table_data_list, list) and len(table_data_list) > 0:
                    table_data = table_data_list[0].copy()
                else:
                    table_data = table_data_list.copy()
            
            # 获取挂载点的父节点
            try:
                parent = resolve_pointer(table_data, json_pointer_path, None)
            except Exception as e:
                return (False, f"无效的路径: {str(e)}", None)
            
            if parent is None:
                return (False, f"路径不存在: {json_pointer_path}", None)
            
            # 确保父节点是字典类型
            if not isinstance(parent, dict):
                return (False, "路径指向的节点不是字典类型", None)
            
            # 检查是否有重复的 key
            for element in elements:
                if 'key' not in element:
                    return (False, "元素缺少 'key' 字段", None)
                key = element['key']
                if key in parent:
                    return (False, f"Key '{key}' 已存在", None)
            
            # 创建新数据
            for element in elements:
                if 'content' not in element:
                    return (False, "元素缺少 'content' 字段", None)
                key = element['key']
                content = element['content']
                parent[key] = content
            
            # 更新表数据
            # 将字典包装成列表格式
            updated_data = [table_data]
            self.project_service.update_table_data(project_id, table_id, updated_data)
            
            # 返回创建后的数据
            result = resolve_pointer(table_data, json_pointer_path)
            return (True, None, result)
            
        except NotFoundException as e:
            return (False, str(e), None)
        except Exception as e:
            log_error(f"Failed to create table data: {e}")
            return (False, f"创建数据失败: {str(e)}", None)
    
    def update_table_data(
        self,
        project_id: str,
        table_id: str,
        json_pointer_path: str,
        elements: list
    ) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        更新表数据中指定路径的数据
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径
            elements: 要更新的元素列表，每个元素包含 key 和 content
        
        Returns:
            (success, error_message, result_data) 元组
        """
        try:
            # 获取当前表数据
            table_data_list = self.project_service.get_table_data(project_id, table_id)
            
            if not table_data_list or len(table_data_list) == 0:
                return (False, "表数据为空", None)
            
            # 取第一个元素（通常是字典）
            if isinstance(table_data_list, list) and len(table_data_list) > 0:
                table_data = table_data_list[0].copy()
            else:
                table_data = table_data_list.copy()
            
            # 获取要更新的父节点
            try:
                parent = resolve_pointer(table_data, json_pointer_path, None)
            except Exception as e:
                return (False, f"无效的路径: {str(e)}", None)
            
            if parent is None:
                return (False, f"路径不存在: {json_pointer_path}", None)
            
            if not isinstance(parent, dict):
                return (False, "路径指向的节点不是字典类型", None)
            
            # 检查所有要更新的 key 是否存在
            for element in elements:
                if 'key' not in element:
                    return (False, "元素缺少 'key' 字段", None)
                key = element['key']
                if key not in parent:
                    return (False, f"Key '{key}' 不存在", None)
            
            # 更新数据
            for element in elements:
                if 'content' not in element:
                    return (False, "元素缺少 'content' 字段", None)
                key = element['key']
                content = element['content']
                parent[key] = content
            
            # 更新表数据
            updated_data = [table_data]
            self.project_service.update_table_data(project_id, table_id, updated_data)
            
            # 返回更新后的数据
            result = resolve_pointer(table_data, json_pointer_path)
            return (True, None, result)
            
        except NotFoundException as e:
            return (False, str(e), None)
        except Exception as e:
            log_error(f"Failed to update table data: {e}")
            return (False, f"更新数据失败: {str(e)}", None)
    
    def delete_table_data(
        self,
        project_id: str,
        table_id: str,
        json_pointer_path: str,
        keys: list
    ) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        删除表数据中指定路径下的 keys
        
        Args:
            project_id: 项目ID
            table_id: 表ID
            json_pointer_path: JSON指针路径
            keys: 要删除的 key 列表
        
        Returns:
            (success, error_message, result_data) 元组
        """
        try:
            # 获取当前表数据
            table_data_list = self.project_service.get_table_data(project_id, table_id)
            
            if not table_data_list or len(table_data_list) == 0:
                return (False, "表数据为空", None)
            
            # 取第一个元素（通常是字典）
            if isinstance(table_data_list, list) and len(table_data_list) > 0:
                table_data = table_data_list[0].copy()
            else:
                table_data = table_data_list.copy()
            
            # 获取要删除的父节点
            try:
                parent = resolve_pointer(table_data, json_pointer_path, None)
            except Exception as e:
                return (False, f"无效的路径: {str(e)}", None)
            
            if parent is None:
                return (False, f"路径不存在: {json_pointer_path}", None)
            
            if not isinstance(parent, dict):
                return (False, "路径指向的节点不是字典类型", None)
            
            # 检查所有要删除的 key 是否存在
            for key in keys:
                if key not in parent:
                    return (False, f"Key '{key}' 不存在", None)
            
            # 删除数据
            for key in keys:
                del parent[key]
            
            # 更新表数据
            updated_data = [table_data]
            self.project_service.update_table_data(project_id, table_id, updated_data)
            
            # 返回删除后的数据
            result = resolve_pointer(table_data, json_pointer_path)
            return (True, None, result)
            
        except NotFoundException as e:
            return (False, str(e), None)
        except Exception as e:
            log_error(f"Failed to delete table data: {e}")
            return (False, f"删除数据失败: {str(e)}", None)
    
    def _extract_structure(self, data: Any) -> Any:
        """
        递归提取数据结构，保留类型信息但不保留实际值
        """
        if isinstance(data, dict):
            structure = {}
            for key, value in data.items():
                structure[key] = self._extract_structure(value)
            return structure
        elif isinstance(data, list):
            if len(data) > 0:
                # 使用第一个元素的结构作为模板
                return [self._extract_structure(data[0])]
            else:
                return []
        else:
            # 对于基本类型，返回类型名称
            type_name = type(data).__name__
            return f"<{type_name}>"


def get_project_table_service() -> ProjectTableService:
    """获取项目表数据服务实例"""
    return ProjectTableService()

