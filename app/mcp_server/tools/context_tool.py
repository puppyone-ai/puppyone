from typing import Literal, List, Dict, Any, Optional
from app.core.dependencies import get_user_context_service
from app.utils.logger import log_error

tool_types = Literal["create", "update", "delete", "get"]
tool_descriptions = {
    "create": "创建元素",
    "update": "更新元素",
    "delete": "删除元素",
    "get": "获取元素",
}

class ContextTool:
    """
    用户知识库管理工具类
    """
    
    def generate_tool_description(
        self, 
        project_name: str, 
        context_name: str, 
        tool_type: tool_types,
        project_description: Optional[str] = None,
        project_metadata: Optional[Dict[str, Any]] = None,
        context_description: Optional[str] = None,
        context_metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        生成工具描述
        
        Args:
            project_name: 项目名称
            context_name: 知识库名称
            tool_type: 工具类型（create/update/delete/get）
            project_description: 项目描述
            project_metadata: 项目元数据
            context_description: 知识库描述
            context_metadata: 知识库元数据
        
        Returns:
            详细的工具描述字符串，用于大语言模型理解工具用途和使用方式
        """
        # 构建项目基础描述
        project_name_str = f'知识库所属项目名称："{project_name}"'
        project_description_str = ""
        project_metadata_str = ""
        if project_description:
            project_description_str = f'该项目的描述为：{project_description}'
        if project_metadata:
            project_metadata_str = f'该项目其他信息包括：{project_metadata}'
        
        # 构建知识库基础描述
        context_info = f'知识库名称："{context_name}; "'
        if context_description:
            context_info += f' 知识库描述：{context_description};'
        if context_metadata:
            context_info += f' 知识库其他信息：{context_metadata} '
        
        base_description = f"""这是一个用于管理知识库的工具。知识库本质上是一个JSON对象，以键值对（key-value）的形式存储数据。知识库的信息如下：

{project_name_str}; {project_description_str}; {project_metadata_str}

{context_info}

重要提示：知识库是一个JSON对象结构，其中：
- key（键）：字符串类型，用于唯一标识数据项
- value（值）：可以是任意JSON类型（对象、数组、字符串、数字、布尔值等）

使用流程：
1. 首次使用必须通过 get_context 工具获取整个知识库的内容，了解当前的数据结构
2. 在了解现有数据结构后，才能进行创建、更新或删除操作
3. 所有操作都是基于key（键）来定位和操作数据项"""
        
        descriptions = {
            "get": f"""{base_description}

功能：获取整个知识库的完整内容（整个JSON对象）。

参数说明：
- 此工具不需要任何参数，直接调用即可获取整个知识库的所有数据。

返回值：
- 返回完整的JSON对象，包含知识库中所有的键值对（key-value pairs）如果知识库为空，将返回空的JSON对象 {{}}

使用场景：
- 首次访问知识库时，必须先调用此工具了解数据结构
- 需要查看知识库的完整内容时
- 在进行增删改操作前，需要先了解现有数据

示例场景：
- 用户说"查看某某项目的某某知识库内容" → 使用此工具获取整个知识库
- 用户说"显示某某项目的某某知识库所有数据" → 使用此工具获取完整JSON对象
- 在进行任何修改操作前，必须先调用此工具""",
            
            "create": f"""{base_description}

功能：在知识库中批量创建新的键值对（key-value pairs）。

参数说明：
- elements (List[Dict]): 要创建的元素数组，每个元素是一个字典，包含：
  - key (str): 字符串类型，新数据项的键名。必须是唯一的，如果已存在则创建失败
  - content (dict): 字典类型，新数据项的值内容，可以是任意JSON对象结构

使用场景：
- 当用户需要向知识库添加新的数据项时
- 当需要批量创建多个键值对时
- 当需要记录新的信息、文档或条目时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，了解现有数据结构
- key必须是字符串类型，且在当前知识库中唯一
- 如果key已存在，创建操作将失败
- content可以是任意JSON对象（dict），根据实际需求定义结构
- 支持批量创建，可以一次创建多个键值对

示例：
假设当前知识库为空 {{}}，要创建两个数据项：
elements = [
    {{"key": "user_001", "content": {{"name": "张三", "age": 25}}}},
    {{"key": "user_002", "content": {{"name": "李四", "age": 30}}}}
]
执行后将得到：{{"user_001": {{"name": "张三", "age": 25}}, "user_002": {{"name": "李四", "age": 30}}}}

示例场景：
- 用户说"在某某项目的某某知识库中添加一个新的用户信息，key是user_001" → 使用此工具创建
- 用户说"在某某项目的某某知识库中记录这个文档，key是doc_001" → 使用此工具创建
- 用户说"在某某项目的某某知识库中保存这个配置，key是config_001" → 使用此工具创建""",
            
            "update": f"""{base_description}

功能：批量更新知识库中已存在的键值对。

参数说明：
- updates (List[Dict]): 要更新的元素数组，每个元素是一个字典，包含：
  - key (str): 字符串类型，要更新的数据项的键名。必须已存在于知识库中
  - value (Any): 任意JSON类型，新的值内容，将完全替换原有的value

使用场景：
- 当用户需要修改知识库中现有数据项的值时或者需要更正或替换已有数据时
- 当需要批量更新多个键值对时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，确认要更新的key是否存在
- key必须已存在于知识库中，如果不存在则更新失败
- value将完全替换原有的值，不是部分更新
- 支持批量更新，可以一次更新多个键值对

示例：
假设当前知识库为：{{"user_001": {{"name": "张三", "age": 25}}}}
要更新user_001的age为26：
updates = [{{"key": "user_001", "value": {{"name": "张三", "age": 26}}}}]
执行后将得到：{{"user_001": {{"name": "张三", "age": 26}}}}

示例场景：
- 用户说"在某某项目的某某知识库中修改key为user_001的用户信息" → 使用此工具更新
- 用户说"在某某项目的某某知识库中更新key为doc_001的文档内容" → 使用此工具更新
- 用户说"在某某项目的某某知识库中把key为config_001的配置改为新值" → 使用此工具更新""",
            
            "delete": f"""{base_description}

功能：从知识库中批量删除指定的键值对。

参数说明：
- keys (List[str]): 字符串数组，包含要删除的所有key（键名）

使用场景：
- 当用户需要移除知识库中的某些数据项时
- 当需要批量删除多个键值对时
- 当需要清理不再需要的数据时

注意事项：
- 必须先使用 get_context 工具获取当前知识库内容，确认要删除的key是否存在
- keys数组中的每个key必须是字符串类型
- 如果某个key不存在，该key的删除操作将被忽略，其他key的删除操作仍会执行
- 支持批量删除，可以一次删除多个键值对
- 删除操作是不可逆的，请谨慎使用

示例：
假设当前知识库为：{{"user_001": {{"name": "张三"}}, "user_002": {{"name": "李四"}}, "user_003": {{"name": "王五"}}}}
要删除user_001和user_002：
keys = ["user_001", "user_002"]
执行后将得到：{{"user_003": {{"name": "王五"}}}}

示例场景：
- 用户说"删除key为user_001的数据" → 使用此工具删除
- 用户说"移除key为doc_001和doc_002的文档" → 使用此工具批量删除
- 用户说"清除key为config_001的配置" → 使用此工具删除"""
        }
        
        return descriptions.get(tool_type, base_description)
    
    def get_context(self, context_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取整个知识库内容（整个JSON对象）
        
        Args:
            context_info: 上下文信息字典，包含 context, context_id 等
        
        Returns:
            操作结果字典
        """
        try:
            context = context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_info.get("context_id")
                }
            
            # 返回完整的context_data（JSON对象）
            return {
                "message": "获取知识库内容成功",
                "data": context.context_data if context.context_data else {}
            }
        except Exception as e:
            log_error(f"Error getting context: {e}")
            return {
                "error": f"获取知识库内容失败: {str(e)}"
            }
    
    def create_element(
        self, 
        elements: List[Dict[str, Any]], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量创建元素
        
        Args:
            elements: 元素数组，每个元素包含 key（str）和 content（Any）
            context_info: 上下文信息字典，包含 context, context_id 等
        
        Returns:
            操作结果字典
        """
        try:
            context_id = context_info.get("context_id")
            context = context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并创建元素
            created_keys = []
            failed_keys = []
            
            for element in elements:
                if not isinstance(element, dict):
                    failed_keys.append({"element": element, "reason": "元素必须是字典类型"})
                    continue
                
                key = element.get("key") if isinstance(element, dict) else getattr(element, "key", None)
                content = element.get("content") if isinstance(element, dict) else getattr(element, "content", None)
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key in context_data:
                    failed_keys.append({"key": key, "reason": "key已存在"})
                    continue
                
                # 创建新的键值对
                context_data[key] = content
                created_keys.append(key)
            
            if not created_keys:
                return {
                    "error": "没有成功创建任何元素",
                    "failed": failed_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素创建成功",
                "created_keys": created_keys,
                "failed": failed_keys if failed_keys else None,
                "total_created": len(created_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            log_error(f"Error creating elements: {e}")
            return {
                "error": f"创建元素失败: {str(e)}"
            }
    
    def update_element(
        self, 
        updates: List[Dict[str, Any]], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量更新元素
        
        Args:
            updates: 更新数组，每个元素包含 key（str）和 content（Any）
            context_info: 上下文信息字典，包含 context, context_id 等
        
        Returns:
            操作结果字典
        """
        try:
            context_id = context_info.get("context_id")
            context = context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并更新元素
            updated_keys = []
            failed_keys = []
            
            for update_item in updates:
                if not isinstance(update_item, dict):
                    failed_keys.append({"update": update_item, "reason": "更新项必须是字典类型"})
                    continue
                
                key = update_item.get("key") if isinstance(update_item, dict) else getattr(update_item, "key", None)
                value = update_item.get("content") if isinstance(update_item, dict) else getattr(update_item, "content", None)
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key not in context_data:
                    failed_keys.append({"key": key, "reason": "key不存在于知识库中"})
                    continue
                
                # 更新键值对（完全替换）
                context_data[key] = value
                updated_keys.append(key)
            
            if not updated_keys:
                return {
                    "error": "没有成功更新任何元素",
                    "failed": failed_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素更新成功",
                "updated_keys": updated_keys,
                "failed": failed_keys if failed_keys else None,
                "total_updated": len(updated_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            log_error(f"Error updating elements: {e}")
            return {
                "error": f"更新元素失败: {str(e)}"
            }
    
    def delete_element(
        self, 
        keys: List[str], 
        context_info: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        批量删除元素
        
        Args:
            keys: 要删除的key数组
            context_info: 上下文信息字典，包含 context, context_id 等
        
        Returns:
            操作结果字典
        """
        try:
            context_id = context_info.get("context_id")
            context = context_info.get("context")
            
            if not context:
                return {
                    "error": "知识库不存在",
                    "context_id": context_id
                }
            
            # 获取当前context_data
            context_data = context.context_data.copy() if context.context_data else {}
            
            # 验证并删除元素
            deleted_keys = []
            not_found_keys = []
            
            for key in keys:
                if not isinstance(key, str):
                    not_found_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if key not in context_data:
                    not_found_keys.append({"key": key, "reason": "key不存在于知识库中"})
                    continue
                
                # 删除键值对
                del context_data[key]
                deleted_keys.append(key)
            
            if not deleted_keys:
                return {
                    "error": "没有成功删除任何元素",
                    "not_found": not_found_keys
                }
            
            # 更新context_data
            user_context_service = get_user_context_service()
            updated_context = user_context_service.update(
                context_id=context_id,
                context_name=context.context_name,
                context_description=context.context_description,
                context_data=context_data,
                metadata=context.metadata
            )
            
            if not updated_context:
                return {
                    "error": "更新知识库失败"
                }
            
            return {
                "message": "元素删除成功",
                "deleted_keys": deleted_keys,
                "not_found": not_found_keys if not_found_keys else None,
                "total_deleted": len(deleted_keys),
                "total_not_found": len(not_found_keys)
            }
        except Exception as e:
            log_error(f"Error deleting elements: {e}")
            return {
                "error": f"删除元素失败: {str(e)}"
            }

