"""
表格工具实现
通过RPC调用主服务实现表格操作
"""
from typing import Dict, Any, List, Optional
from ..rpc.client import InternalApiClient


class TableToolImplementation:
    """表格工具实现类"""
    
    def __init__(self, rpc_client: InternalApiClient):
        """
        初始化工具
        
        Args:
            rpc_client: RPC客户端
        """
        self.rpc_client = rpc_client
    
    async def get_data_schema(self, table_id: int, json_path: str = "") -> Dict[str, Any]:
        """获取挂载点数据结构（不含实际值）"""
        try:
            data = await self.rpc_client.get_context_schema(table_id=table_id, json_path=json_path)
            if data is None:
                return {"error": "获取数据结构失败"}
            return {"message": "获取数据结构成功", "data": data, "schema_only": True}
        except Exception as e:
            return {"error": "获取数据结构失败", "detail": str(e)}

    async def get_all_data(self, table_id: int, json_path: str = "") -> Dict[str, Any]:
        """获取挂载点全部数据"""
        try:
            data = await self.rpc_client.get_context_data(table_id=table_id, json_path=json_path)
            if data is None:
                return {"error": "获取数据失败"}
            return {"message": "获取数据成功", "data": data or {}}
        except Exception as e:
            return {"error": "获取数据失败", "detail": str(e)}

    async def query_data(self, table_id: int, json_path: str, query: str) -> Dict[str, Any]:
        """对挂载点数据做 JMESPath 查询"""
        try:
            if not query:
                return {"error": "query 参数不能为空"}
            data = await self.rpc_client.query_context_data(
                table_id=table_id, json_path=json_path, query=query
            )
            if data is None:
                return {"error": "JMESPath 查询失败"}
            return {"message": "JMESPath 查询成功", "data": data, "query": query}
        except Exception as e:
            return {"error": "JMESPath 查询失败", "detail": str(e)}
    
    async def create_element(
        self,
        table_id: int,
        json_path: str,
        elements: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        创建表格元素
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            elements: 要创建的元素列表
            
        Returns:
            创建结果
        """
        try:
            # 验证元素格式
            validated_elements = []
            failed_keys = []
            
            for element in elements:
                if not isinstance(element, dict):
                    failed_keys.append({"element": element, "reason": "元素必须是字典类型"})
                    continue
                
                key = element.get("key")
                content = element.get("content")
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if "key" not in element or "content" not in element:
                    failed_keys.append({"element": element, "reason": "元素缺少 'key' 或 'content' 字段"})
                    continue
                
                validated_elements.append({"key": key, "content": content})
            
            if not validated_elements:
                return {"error": "没有成功创建任何元素", "failed": failed_keys}
            
            # 调用RPC创建数据
            success = await self.rpc_client.create_table_data(
                table_id=table_id, json_path=json_path, elements=validated_elements
            )
            
            if not success:
                return {"error": "创建元素失败", "failed": failed_keys if failed_keys else None}
            
            created_keys = [elem["key"] for elem in validated_elements]
            return {
                "message": "元素创建成功",
                "created_keys": created_keys,
                "failed": failed_keys if failed_keys else None,
                "total_created": len(created_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            return {"error": f"创建元素失败: {str(e)}"}
    
    async def update_element(
        self,
        table_id: int,
        json_path: str,
        updates: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        更新表格元素
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            updates: 要更新的元素列表
            
        Returns:
            更新结果
        """
        try:
            # 验证更新项格式
            validated_updates = []
            failed_keys = []
            
            for update_item in updates:
                if not isinstance(update_item, dict):
                    failed_keys.append({"update": update_item, "reason": "更新项必须是字典类型"})
                    continue
                
                key = update_item.get("key")
                content = update_item.get("content")
                
                if not isinstance(key, str):
                    failed_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                
                if "key" not in update_item or "content" not in update_item:
                    failed_keys.append({"update": update_item, "reason": "更新项缺少 'key' 或 'content' 字段"})
                    continue
                
                validated_updates.append({"key": key, "content": content})
            
            if not validated_updates:
                return {"error": "没有成功更新任何元素", "failed": failed_keys}
            
            # 调用RPC更新数据
            success = await self.rpc_client.update_table_data(
                table_id=table_id, json_path=json_path, elements=validated_updates
            )
            
            if not success:
                return {"error": "更新元素失败", "failed": failed_keys if failed_keys else None}
            
            updated_keys = [update["key"] for update in validated_updates]
            return {
                "message": "元素更新成功",
                "updated_keys": updated_keys,
                "failed": failed_keys if failed_keys else None,
                "total_updated": len(updated_keys),
                "total_failed": len(failed_keys)
            }
        except Exception as e:
            return {"error": f"更新元素失败: {str(e)}"}
    
    async def delete_element(
        self,
        table_id: int,
        json_path: str,
        keys: List[str]
    ) -> Dict[str, Any]:
        """
        删除表格元素
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            keys: 要删除的key列表
            
        Returns:
            删除结果
        """
        try:
            # 验证keys格式
            validated_keys = []
            invalid_keys = []
            
            for key in keys:
                if not isinstance(key, str):
                    invalid_keys.append({"key": key, "reason": "key必须是字符串类型"})
                    continue
                validated_keys.append(key)
            
            if not validated_keys:
                return {"error": "没有有效的key可以删除", "invalid": invalid_keys}
            
            # 调用RPC删除数据
            success = await self.rpc_client.delete_table_data(
                table_id=table_id, json_path=json_path, keys=validated_keys
            )
            
            if not success:
                return {"error": "删除元素失败", "invalid": invalid_keys if invalid_keys else None}
            
            return {
                "message": "元素删除成功",
                "deleted_keys": validated_keys,
                "invalid": invalid_keys if invalid_keys else None,
                "total_deleted": len(validated_keys),
                "total_invalid": len(invalid_keys)
            }
        except Exception as e:
            return {"error": f"删除元素失败: {str(e)}"}
    
    async def preview_data(
        self,
        table_id: int,
        json_path: str,
        preview_keys: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        预览表格数据
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            preview_keys: 预览字段列表
            
        Returns:
            预览结果
        """
        try:
            # 获取完整数据
            data = await self.rpc_client.get_context_data(table_id=table_id, json_path=json_path)
            
            if data is None:
                return {"error": "获取表格数据失败"}
            
            # 检查数据类型
            if not isinstance(data, list):
                return {
                    "message": "当前数据不是列表类型，无法使用预览功能。请使用 get_all_data 或 query_data 工具查询数据。",
                    "data_type": str(type(data).__name__)
                }
            
            # 检查列表元素类型
            if data and not all(isinstance(item, dict) for item in data):
                return {
                    "message": "当前数据不是 List[Dict] 类型，无法使用预览功能。请使用 get_all_data 或 query_data 工具查询数据。",
                    "data_type": "List[mixed]"
                }
            
            # 如果没有指定preview_keys，返回所有数据
            if not preview_keys:
                return {
                    "message": "预览数据获取成功（显示所有字段）",
                    "data": data,
                    "preview_keys": "all"
                }
            
            # 过滤数据
            filtered_data = []
            for item in data:
                filtered_item = {key: item.get(key) for key in preview_keys if key in item}
                filtered_data.append(filtered_item)
            
            return {
                "message": "预览数据获取成功",
                "data": filtered_data,
                "preview_keys": preview_keys,
                "total_count": len(filtered_data)
            }
        except Exception as e:
            return {"error": f"预览数据失败: {str(e)}"}
    
    async def select_tables(
        self,
        table_id: int,
        json_path: str,
        field: str,
        keys: List[str]
    ) -> Dict[str, Any]:
        """
        选择表格数据
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            field: 匹配字段名
            keys: 要匹配的值列表
            
        Returns:
            选择结果
        """
        try:
            # 验证参数
            if not field:
                return {"error": "field 参数不能为空"}
            
            if not keys or not isinstance(keys, list):
                return {"error": "keys 参数必须是非空列表"}
            
            # 获取完整数据
            data = await self.rpc_client.get_context_data(table_id=table_id, json_path=json_path)
            
            if data is None:
                return {"error": "获取表格数据失败"}
            
            # 检查数据类型
            if not isinstance(data, list):
                return {
                    "message": "当前数据不是列表类型，无法使用选择功能。请使用 get_all_data 或 query_data 工具查询数据。",
                    "data_type": str(type(data).__name__)
                }
            
            # 检查列表元素类型
            if data and not all(isinstance(item, dict) for item in data):
                return {
                    "message": "当前数据不是 List[Dict] 类型，无法使用选择功能。请使用 get_all_data 或 query_data 工具查询数据。",
                    "data_type": "List[mixed]"
                }
            
            # 筛选数据
            keys_set = set(str(k) for k in keys)
            selected_data = []
            for item in data:
                if field in item and str(item[field]) in keys_set:
                    selected_data.append(item)
            
            return {
                "message": "数据选择成功",
                "data": selected_data,
                "field": field,
                "requested_keys": keys,
                "matched_count": len(selected_data)
            }
        except Exception as e:
            return {"error": f"选择数据失败: {str(e)}"}
