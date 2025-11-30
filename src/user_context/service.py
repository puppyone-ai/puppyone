"""
负责用户知识库内容的管理
"""

from typing import List, Optional, Dict, Any
from jsonpointer import resolve_pointer
import json
import jmespath
from src.user_context.models import UserContext
from src.user_context.repository import UserContextRepositoryBase
from src.exceptions import NotFoundException, BusinessException, ErrorCode


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

    def update(self, context_id: str, context_name: str, context_description: str, context_data: Optional[dict], metadata: dict) -> UserContext:
        updated = self.repo.update(context_id, context_name, context_description, context_data, metadata)
        if not updated:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        return updated

    def delete(self, context_id: str) -> None:
        success = self.repo.delete(context_id)
        if not success:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
    
    def create_context_data(self, context_id: str, mounted_json_pointer_path: str, elements: List[Dict]) -> Any:
        """
        在 context_data 的指定路径下创建新数据
        
        Args:
            context_id: 知识库ID
            mounted_json_pointer_path: JSON指针路径，数据将挂载到此路径下
            elements: 要创建的元素数组，每个元素包含 key 和 content
        

        """
        context = self.repo.get_by_id(context_id)
        if not context:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        context_data = context.context_data.copy()
        
        # 获取挂载点的父节点
        try:
            parent = resolve_pointer(context_data, mounted_json_pointer_path, None)
        except Exception as e:
            raise BusinessException(f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST)
        
        if parent is None:
            raise BusinessException(f"Path not found: {mounted_json_pointer_path}", code=ErrorCode.BAD_REQUEST)
        
        # 确保父节点是字典类型
        if not isinstance(parent, dict):
            raise BusinessException("Path points to non-dict node", code=ErrorCode.BAD_REQUEST)
        
        # 检查是否有重复的 key
        for element in elements:
            if 'key' not in element:
                raise BusinessException("Element missing 'key' field", code=ErrorCode.VALIDATION_ERROR)
            key = element['key']
            if key in parent:
                raise BusinessException(f"Key '{key}' already exists", code=ErrorCode.VALIDATION_ERROR)
        
        # 检查 content 是否重复（深度比较）
        existing_content_strs = {json.dumps(parent[k], sort_keys=True) for k in parent.keys()}
        for element in elements:
            if 'content' not in element:
                raise BusinessException("Element missing 'content' field", code=ErrorCode.VALIDATION_ERROR)
            content = element['content']
            # 深度比较：序列化后比较字符串
            content_str = json.dumps(content, sort_keys=True)
            if content_str in existing_content_strs:
                raise BusinessException(f"Content already exists for key: {element['key']}", code=ErrorCode.VALIDATION_ERROR)
        
        # 创建新数据
        for element in elements:
            key = element['key']
            content = element['content']
            parent[key] = content
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            raise BusinessException("Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        
        # 返回创建后的数据
        result = resolve_pointer(updated_context.context_data, mounted_json_pointer_path)
        return result
    
    def get_context_data(self, context_id: str, json_pointer_path: str) -> Any:
        """
        获取 context_data 中指定路径的数据
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        try:
            data = resolve_pointer(context.context_data, json_pointer_path, None)
            if data is None:
                 # 为了保险，我们认为如果 resolve 返回 default (None)，就是没找到。
                 raise NotFoundException(f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND)
            return data
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST)
    
    def update_context_data(self, context_id: str, json_pointer_path: str, elements: List[Dict]) -> Any:
        """
        更新 context_data 中指定路径的数据
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        context_data = context.context_data.copy()
        
        # 获取要更新的父节点
        try:
            parent = resolve_pointer(context_data, json_pointer_path, None)
        except Exception as e:
            raise BusinessException(f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST)
        
        if parent is None:
            raise NotFoundException(f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND)
        
        if not isinstance(parent, dict):
            raise BusinessException("Path points to non-dict node", code=ErrorCode.BAD_REQUEST)
        
        # 检查所有要更新的 key 是否存在
        for element in elements:
            if 'key' not in element:
                raise BusinessException("Element missing 'key' field", code=ErrorCode.VALIDATION_ERROR)
            key = element['key']
            if key not in parent:
                raise NotFoundException(f"Key '{key}' not found", code=ErrorCode.NOT_FOUND)
        
        # 更新数据
        for element in elements:
            if 'content' not in element:
                raise BusinessException("Element missing 'content' field", code=ErrorCode.VALIDATION_ERROR)
            key = element['key']
            content = element['content']
            parent[key] = content
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            raise BusinessException("Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        
        # 返回更新后的数据
        result = resolve_pointer(updated_context.context_data, json_pointer_path)
        return result
    
    def delete_context_data(self, context_id: str, json_pointer_path: str, keys: List[str]) -> Any:
        """
        删除 context_data 中指定路径下的 keys
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        context_data = context.context_data.copy()
        
        # 获取要删除的父节点
        try:
            parent = resolve_pointer(context_data, json_pointer_path, None)
        except Exception as e:
             raise BusinessException(f"Invalid path: {str(e)}", code=ErrorCode.BAD_REQUEST)
        
        if parent is None:
            raise NotFoundException(f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND)
        
        if not isinstance(parent, dict):
            raise BusinessException("Path points to non-dict node", code=ErrorCode.BAD_REQUEST)
        
        # 检查所有要删除的 key 是否存在
        for key in keys:
            if key not in parent:
                raise NotFoundException(f"Key '{key}' not found", code=ErrorCode.NOT_FOUND)
        
        # 删除数据
        for key in keys:
            del parent[key]
        
        # 更新 context_data
        updated_context = self.repo.update_context_data(context_id, context_data)
        if not updated_context:
            raise BusinessException("Update failed", code=ErrorCode.INTERNAL_SERVER_ERROR)
        
        # 返回删除后的数据
        result = resolve_pointer(updated_context.context_data, json_pointer_path)
        return result
    
    def query_context_data_with_jmespath(
        self, 
        context_id: str, 
        json_pointer_path: str, 
        query: str
    ) -> Optional[Any]:
        """
        使用 JMESPath 查询 context_data 中指定路径的数据
        """
        context = self.repo.get_by_id(context_id)
        if not context:
            raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        try:
            # 先获取指定路径的数据
            base_data = resolve_pointer(context.context_data, json_pointer_path, None)
            if base_data is None:
                raise NotFoundException(f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND)
            
            # 使用 JMESPath 查询数据
            result = jmespath.search(query, base_data)

            # 处理空结果 (JMESPath returns None if nothing matched)
            # 我们认为这也是一种成功结果，只是数据为空
            return result
            
        except jmespath.exceptions.ParseError as e:
            raise BusinessException(f"JMESPath syntax error: {str(e)}", code=ErrorCode.BAD_REQUEST)
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(f"Query failed: {str(e)}", code=ErrorCode.BAD_REQUEST)
    
    def get_context_structure(
        self, 
        context_id: str, 
        json_pointer_path: str
    ) -> Dict:
        """
        获取 context_data 中指定路径的数据结构（不包含实际数据值）
        """
        context = self.repo.get_by_id(context_id)
        if not context:
             raise NotFoundException(f"Context not found: {context_id}", code=ErrorCode.NOT_FOUND)
        
        try:
            data = resolve_pointer(context.context_data, json_pointer_path, None)
            if data is None:
                raise NotFoundException(f"Path not found: {json_pointer_path}", code=ErrorCode.NOT_FOUND)
            
            # 提取结构信息
            structure = self._extract_structure(data)
            return structure
            
        except Exception as e:
            if isinstance(e, NotFoundException):
                raise
            raise BusinessException(f"Failed to extract structure: {str(e)}", code=ErrorCode.INTERNAL_SERVER_ERROR)
    
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

