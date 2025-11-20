"""
负责用户知识库内容的管理
"""

from typing import List, Optional, Dict, Tuple, Any
from jsonpointer import resolve_pointer, set_pointer
import json
import jmespath
from app.utils.logger import log_warning
from app.models.user_context import UserContext
from app.repositories.base import UserContextRepositoryBase

class UserContextService:
    """封装业务逻辑层"""

    def __init__(self, repo: UserContextRepositoryBase):
        self.repo = repo

    def get_by_user_id(self, user_id: str) -> List[UserContext]:
        return self.repo.get_by_user_id(user_id)

    def get_by_id(self, context_id: str) -> Optional[UserContext]:
        return self.repo.get_by_id(context_id)

    def create(self, user_id: str, project_id: str, context_name: str, context_description: str, context_data: dict, metadata: dict) -> UserContext:
        return self.repo.create(user_id, project_id, context_name, context_description, context_data, metadata)

    def update(self, context_id: str, context_name: str, context_description: str, context_data: Optional[dict], metadata: dict) -> Optional[UserContext]:
        return self.repo.update(context_id, context_name, context_description, context_data, metadata)

    def delete(self, context_id: str) -> bool:
        return self.repo.delete(context_id)
    
    def create_context_data(self, context_id: str, mounted_json_pointer_path: str, elements: List[Dict]) -> Tuple[bool, Optional[str], Optional[Dict]]:
        """
        在 context_data 的指定路径下创建新数据
        
        Args:
            context_id: 知识库ID
            mounted_json_pointer_path: JSON指针路径，数据将挂载到此路径下
            elements: 要创建的元素数组，每个元素包含 key 和 content
        
        Returns:
            (success: bool, error_message: Optional[str], data: Optional[Dict])
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        context_data = context.context_data.copy()
        
        # 获取挂载点的父节点
        try:
            parent = resolve_pointer(context_data, mounted_json_pointer_path, None)
        except Exception as e:
            return False, f"路径不存在或无效: {str(e)}", None
        
        if parent is None:
            # 如果路径不存在，尝试创建路径
            # 这里简化处理，假设路径必须存在
            return False, f"路径不存在: {mounted_json_pointer_path}", None
        
        # 确保父节点是字典类型
        if not isinstance(parent, dict):
            return False, f"路径指向的节点不是字典类型", None
        
        # 检查是否有重复的 key
        for element in elements:
            if 'key' not in element:
                return False, "元素缺少 'key' 字段", None
            key = element['key']
            if key in parent:
                return False, f"键 '{key}' 已存在", None
        
        # 检查 content 是否重复（深度比较）
        # 将现有的 content 序列化为字符串用于比较
        existing_content_strs = {json.dumps(parent[k], sort_keys=True) for k in parent.keys()}
        for element in elements:
            if 'content' not in element:
                return False, "元素缺少 'content' 字段", None
            content = element['content']
            # 深度比较：序列化后比较字符串
            content_str = json.dumps(content, sort_keys=True)
            if content_str in existing_content_strs:
                return False, f"内容已存在: {element['key']}", None
        
        # 创建新数据
        for element in elements:
            key = element['key']
            content = element['content']
            parent[key] = content
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            return False, "更新失败", None
        
        # 返回创建后的数据
        result = resolve_pointer(updated_context.context_data, mounted_json_pointer_path)
        return True, None, result
    
    def get_context_data(self, context_id: str, json_pointer_path: str) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        获取 context_data 中指定路径的数据
        
        Args:
            context_id: 知识库ID
            json_pointer_path: JSON指针路径
        
        Returns:
            (success: bool, error_message: Optional[str], data: Optional[Any])
            data 可以是任意类型：dict、list、str、int、float、bool等
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        try:
            data = resolve_pointer(context.context_data, json_pointer_path, None)
            if data is None:
                return False, f"路径不存在: {json_pointer_path}", None
            return True, None, data
        except Exception as e:
            return False, f"路径无效: {str(e)}", None
    
    def update_context_data(self, context_id: str, json_pointer_path: str, elements: List[Dict]) -> Tuple[bool, Optional[str], Optional[Dict]]:
        """
        更新 context_data 中指定路径的数据
        
        Args:
            context_id: 知识库ID
            json_pointer_path: JSON指针路径
            elements: 要更新的元素数组，每个元素包含 key 和 content
        
        Returns:
            (success: bool, error_message: Optional[str], data: Optional[Dict])
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        context_data = context.context_data.copy()
        
        # 获取要更新的父节点
        try:
            parent = resolve_pointer(context_data, json_pointer_path, None)
        except Exception as e:
            return False, f"路径不存在或无效: {str(e)}", None
        
        if parent is None:
            return False, f"路径不存在: {json_pointer_path}", None
        
        if not isinstance(parent, dict):
            return False, f"路径指向的节点不是字典类型", None
        
        # 检查所有要更新的 key 是否存在
        for element in elements:
            if 'key' not in element:
                return False, "元素缺少 'key' 字段", None
            key = element['key']
            if key not in parent:
                return False, f"键 '{key}' 不存在，无法更新", None
        
        # 更新数据
        for element in elements:
            if 'content' not in element:
                return False, "元素缺少 'content' 字段", None
            key = element['key']
            content = element['content']
            parent[key] = content
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            return False, "更新失败", None
        
        # 返回更新后的数据
        result = resolve_pointer(updated_context.context_data, json_pointer_path)
        return True, None, result
    
    def delete_context_data(self, context_id: str, json_pointer_path: str, keys: List[str]) -> Tuple[bool, Optional[str], Optional[Dict]]:
        """
        删除 context_data 中指定路径下的 keys
        
        Args:
            context_id: 知识库ID
            json_pointer_path: JSON指针路径
            keys: 要删除的键列表
        
        Returns:
            (success: bool, error_message: Optional[str], data: Optional[Dict])
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        context_data = context.context_data.copy()
        
        # 获取要删除的父节点
        try:
            parent = resolve_pointer(context_data, json_pointer_path, None)
        except Exception as e:
            return False, f"路径不存在或无效: {str(e)}", None
        
        if parent is None:
            return False, f"路径不存在: {json_pointer_path}", None
        
        if not isinstance(parent, dict):
            return False, f"路径指向的节点不是字典类型", None
        
        # 检查所有要删除的 key 是否存在
        for key in keys:
            if key not in parent:
                return False, f"键 '{key}' 不存在，无法删除", None
        
        # 删除数据
        for key in keys:
            del parent[key]
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            return False, "更新失败", None
        
        # 返回删除后的数据
        result = resolve_pointer(updated_context.context_data, json_pointer_path)
        return True, None, result
    
    def query_context_data_with_jmespath(
        self, 
        context_id: str, 
        json_pointer_path: str, 
        query: str
    ) -> Tuple[bool, Optional[str], Optional[Any]]:
        """
        使用 JMESPath 查询 context_data 中指定路径的数据
        
        Args:
            context_id: 知识库ID
            json_pointer_path: JSON指针路径，查询将基于此路径下的数据
            query: JMESPath 查询字符串
        
        Returns:
            (success: bool, error_message: Optional[str], data: Optional[Any])
            data 可以是任意类型：dict、list、str、int、float、bool等
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        try:
            # 先获取指定路径的数据
            base_data = resolve_pointer(context.context_data, json_pointer_path, None)
            if base_data is None:
                return False, f"路径不存在: {json_pointer_path}", None
            
            # 使用 JMESPath 查询数据
            result = jmespath.search(query, base_data)

            # 处理空结果
            if result is None:
                return True, None, None
            
            return True, None, result
            
        except jmespath.exceptions.ParseError as e:
            return False, f"JMESPath 查询语法错误: {str(e)}", None
        except Exception as e:
            return False, f"查询失败: {str(e)}", None
    
    def get_context_structure(
        self, 
        context_id: str, 
        json_pointer_path: str
    ) -> Tuple[bool, Optional[str], Optional[Dict]]:
        """
        获取 context_data 中指定路径的数据结构（不包含实际数据值）
        
        Args:
            context_id: 知识库ID
            json_pointer_path: JSON指针路径
        
        Returns:
            (success: bool, error_message: Optional[str], structure: Optional[Dict])
            structure 只包含结构信息，不包含数据值
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            return False, "知识库不存在", None
        
        try:
            data = resolve_pointer(context.context_data, json_pointer_path, None)
            if data is None:
                return False, f"路径不存在: {json_pointer_path}", None
            
            # 提取结构信息
            structure = self._extract_structure(data)
            return True, None, structure
            
        except Exception as e:
            return False, f"获取结构失败: {str(e)}", None
    
    def _extract_structure(self, data: Any) -> Any:
        """
        递归提取数据结构，保留类型信息但不保留实际值
        
        Args:
            data: 要提取结构的数据
        
        Returns:
            结构信息（类型占位符）
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
