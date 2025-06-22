"""
PuppyEngine ExecutableResources - Modify Resources

重构后的ModifyEdge资源系列:
- 去除subtype多层级设计
- 每个edge资源都是平级的
- 统一标注UID
- 基于ExecutableResource基类
"""

import copy
import json
import re
from typing import Any, Dict, List, Union
import uuid

from .base import (
    ExecutableResource,
    ResourceConfigProtocol,
    ExecutionContext,
    GlobalResourceUID,
    ResourceType,
    ContentType,
    ResourceConfig,
    IOConfig,
    ResourceMetadata
)


class ModifyCopyResource(ExecutableResource):
    """内容复制资源（平级设计）"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        # 确保资源UID正确设置
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="copy",
                version="v1"
            )
        
        super().__init__(config, context)
    
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行内容复制业务逻辑"""
        content = inputs.get("content")
        if content is None:
            raise ValueError("Content is required for copy operation")
        
        # 深拷贝内容
        copied_content = copy.deepcopy(content)
        
        return {
            "result": copied_content,
            "operation": "copy",
            "resource_uid": self.config.resource_uid.short_id
        }
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用复制操作的验证"""
        if validation == "content_exists":
            return "content" in data and data["content"] is not None
        return super()._apply_validation(data, validation)


class ModifyConvert2TextResource(ExecutableResource):
    """结构化数据转文本资源（平级设计）"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="convert2text",
                version="v1"
            )
        
        super().__init__(config, context)
    
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行结构化数据转文本业务逻辑"""
        content = inputs.get("content")
        if content is None:
            raise ValueError("Content is required for convert2text operation")
        
        # 转换为文本
        if isinstance(content, (dict, list)):
            text_result = json.dumps(content, ensure_ascii=False, indent=2)
        else:
            text_result = str(content)
        
        return {
            "result": text_result,
            "operation": "convert2text",
            "resource_uid": self.config.resource_uid.short_id,
            "original_type": type(content).__name__
        }
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用转换验证"""
        if validation == "content_serializable":
            try:
                content = data.get("content")
                json.dumps(content)
                return True
            except (TypeError, ValueError):
                return False
        return super()._apply_validation(data, validation)


class ModifyConvert2StructuredResource(ExecutableResource):
    """文本转结构化数据资源（平级设计）"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="convert2structured",
                version="v1"
            )
        
        super().__init__(config, context)
    
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行文本转结构化数据业务逻辑"""
        content = inputs.get("content")
        conversion_mode = inputs.get("conversion_mode", "parse_as_json")
        
        if content is None:
            raise ValueError("Content is required for convert2structured operation")
        
        if not isinstance(content, str):
            content = str(content)
        
        try:
            if conversion_mode == "parse_as_json":
                # 尝试解析为JSON
                structured_result = json.loads(content)
            elif conversion_mode == "eval_safe":
                # 安全的eval解析（仅支持基本数据结构）
                import ast
                structured_result = ast.literal_eval(content)
            else:
                # 默认JSON解析
                structured_result = json.loads(content)
                
        except (json.JSONDecodeError, ValueError, SyntaxError) as e:
            # 解析失败时返回原文本
            structured_result = {"raw_text": content, "parse_error": str(e)}
        
        return {
            "result": structured_result,
            "operation": "convert2structured",
            "resource_uid": self.config.resource_uid.short_id,
            "conversion_mode": conversion_mode
        }
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用解析验证"""
        if validation == "valid_json_format":
            try:
                content = data.get("content", "")
                json.loads(str(content))
                return True
            except (json.JSONDecodeError, TypeError):
                return False
        return super()._apply_validation(data, validation)


class ModifyEditTextResource(ExecutableResource):
    """文本编辑资源（平级设计）"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="edit_text",
                version="v1"
            )
        
        super().__init__(config, context)
    
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行文本编辑业务逻辑"""
        content = inputs.get("content", "")
        slice_range = inputs.get("slice", [0, -1])
        sort_type = inputs.get("sort_type", "")
        plugins = inputs.get("plugins", {})
        
        if not isinstance(content, str):
            content = str(content)
        
        # 1. 切片操作
        if slice_range and len(slice_range) >= 2:
            start, end = slice_range[0], slice_range[1]
            content = content[start:end if end != -1 else None]
        
        # 2. 排序操作
        if sort_type in {"ascending", "descending"}:
            content = "".join(sorted(content, reverse=(sort_type == "descending")))
        
        # 3. 变量替换
        if plugins:
            for key, value in plugins.items():
                pattern = f"{{{{{key}}}}}"
                content = content.replace(pattern, str(value))
        
        return {
            "result": content,
            "operation": "edit_text",
            "resource_uid": self.config.resource_uid.short_id,
            "applied_operations": {
                "slice": slice_range if slice_range != [0, -1] else None,
                "sort": sort_type if sort_type else None,
                "variable_replace": bool(plugins)
            }
        }
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用文本编辑验证"""
        if validation == "valid_slice_range":
            slice_range = data.get("slice", [0, -1])
            if not isinstance(slice_range, list) or len(slice_range) != 2:
                return False
            return isinstance(slice_range[0], int) and isinstance(slice_range[1], int)
        elif validation == "valid_sort_type":
            sort_type = data.get("sort_type", "")
            return sort_type in {"", "ascending", "descending"}
        return super()._apply_validation(data, validation)


class ModifyEditStructuredResource(ExecutableResource):
    """结构化数据编辑资源（平级设计）"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="edit_structured",
                version="v1"
            )
        
        super().__init__(config, context)
    
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行结构化数据编辑业务逻辑"""
        content = inputs.get("content")
        operations = inputs.get("operations", [])
        
        if content is None:
            raise ValueError("Content is required for edit_structured operation")
        
        # 深拷贝以避免修改原数据
        result = copy.deepcopy(content)
        applied_operations = []
        
        # 执行操作链
        for operation in operations:
            operation_type = operation.get("type")
            params = operation.get("params", {})
            
            try:
                if operation_type == "get":
                    result = await self._get_operation(result, params)
                elif operation_type == "set_value":
                    result = await self._set_value_operation(result, params)
                elif operation_type == "append":
                    result = await self._append_operation(result, params)
                elif operation_type == "sort":
                    result = await self._sort_operation(result, params)
                elif operation_type == "set_operation":
                    result = await self._set_operation(result, params)
                elif operation_type == "variable_replace":
                    result = await self._variable_replace_operation(result, params)
                else:
                    raise ValueError(f"Unknown operation type: {operation_type}")
                
                applied_operations.append({
                    "type": operation_type,
                    "success": True,
                    "params": params
                })
                
            except Exception as e:
                applied_operations.append({
                    "type": operation_type,
                    "success": False,
                    "error": str(e),
                    "params": params
                })
        
        return {
            "result": result,
            "operation": "edit_structured",
            "resource_uid": self.config.resource_uid.short_id,
            "applied_operations": applied_operations
        }
    
    async def _get_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """获取操作"""
        path = params.get("path", [])
        default = params.get("default", None)
        
        current = data
        try:
            for key in path:
                if isinstance(current, dict):
                    current = current[key]
                elif isinstance(current, list):
                    current = current[int(key)]
                else:
                    return default
            return current
        except (KeyError, IndexError, ValueError, TypeError):
            return default
    
    async def _set_value_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """设置值操作"""
        path = params.get("path", [])
        value = params.get("value")
        
        if not path:
            return value
        
        current = data
        for key in path[:-1]:
            if isinstance(current, dict):
                if key not in current:
                    current[key] = {}
                current = current[key]
            elif isinstance(current, list):
                idx = int(key)
                while len(current) <= idx:
                    current.append(None)
                if current[idx] is None:
                    current[idx] = {}
                current = current[idx]
        
        # 设置最终值
        final_key = path[-1]
        if isinstance(current, dict):
            current[final_key] = value
        elif isinstance(current, list):
            idx = int(final_key)
            while len(current) <= idx:
                current.append(None)
            current[idx] = value
        
        return data
    
    async def _append_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """追加操作"""
        path = params.get("path", [])
        value = params.get("value")
        
        target = await self._get_operation(data, {"path": path})
        if isinstance(target, list):
            target.append(value)
        elif isinstance(target, dict):
            # 对于字典，使用数字键追加
            next_key = max([int(k) for k in target.keys() if k.isdigit()] + [-1]) + 1
            target[str(next_key)] = value
        
        return data
    
    async def _sort_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """排序操作"""
        path = params.get("path", [])
        reverse = params.get("reverse", False)
        
        target = await self._get_operation(data, {"path": path})
        if isinstance(target, list):
            target.sort(reverse=reverse)
        
        return data
    
    async def _set_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """集合操作"""
        path1 = params.get("path1", [])
        path2 = params.get("path2", [])
        operation = params.get("operation", "union")  # union, intersection, difference
        
        set1 = set(await self._get_operation(data, {"path": path1, "default": []}))
        set2 = set(await self._get_operation(data, {"path": path2, "default": []}))
        
        if operation == "union":
            result_set = set1.union(set2)
        elif operation == "intersection":
            result_set = set1.intersection(set2)
        elif operation == "difference":
            result_set = set1.difference(set2)
        else:
            result_set = set1
        
        return list(result_set)
    
    async def _variable_replace_operation(self, data: Any, params: Dict[str, Any]) -> Any:
        """变量替换操作"""
        plugins = params.get("plugins", {})
        
        def replace_in_value(value):
            if isinstance(value, str):
                for key, replacement in plugins.items():
                    pattern = f"{{{{{key}}}}}"
                    value = value.replace(pattern, str(replacement))
                return value
            elif isinstance(value, dict):
                return {k: replace_in_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [replace_in_value(item) for item in value]
            return value
        
        return replace_in_value(data)
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用结构化编辑验证"""
        if validation == "valid_operations":
            operations = data.get("operations", [])
            if not isinstance(operations, list):
                return False
            
            valid_operation_types = {
                "get", "set_value", "append", "sort", 
                "set_operation", "variable_replace"
            }
            
            for op in operations:
                if not isinstance(op, dict):
                    return False
                if op.get("type") not in valid_operation_types:
                    return False
            
            return True
        
        return super()._apply_validation(data, validation)


# ModifyCopyResource
def create_modify_copy_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyCopy资源"""
    if not resource_id:
        resource_id = f"modify_copy_{str(uuid.uuid4())[:8]}"
    
    # 完整的资源UID（按照设计文档）
    uid = GlobalResourceUID(
        namespace="puppyengine",
        resource_type="modify", 
        resource_name="copy",
        version="v1"
    )
    
    config = ResourceConfig(
        resource_id=resource_id,
        resource_uid=uid,
        resource_type=ResourceType.MODIFY,
        io_config=IOConfig(
            input_format=ContentType.JSON,  # 兼容既有Edge的结构化数据
            output_format=ContentType.JSON,
            shared_adapters=True
        ),
        internal_config={"operation": "copy"}
    )
    
    context = ExecutionContext(
        resource_id=resource_id,
        workspace_id="default"
    )
    
    return ModifyCopyResource(config, context)


# ModifyConvert2TextResource  
def create_modify_convert2text_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyConvert2Text资源"""
    if not resource_id:
        resource_id = f"modify_convert2text_{str(uuid.uuid4())[:8]}"
    
    uid = GlobalResourceUID(
        namespace="puppyengine",
        resource_type="modify",
        resource_name="convert2text", 
        version="v1"
    )
    
    config = ResourceConfig(
        resource_id=resource_id,
        resource_uid=uid,
        resource_type=ResourceType.MODIFY,
        io_config=IOConfig(
            input_format=ContentType.JSON,  # 输入structured
            output_format=ContentType.TEXT,  # 输出text
            shared_adapters=True
        )
    )
    
    context = ExecutionContext(resource_id=resource_id)
    return ModifyConvert2TextResource(config, context)


# ModifyConvert2StructuredResource
def create_modify_convert2structured_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyConvert2Structured资源"""
    if not resource_id:
        resource_id = f"modify_convert2structured_{str(uuid.uuid4())[:8]}"
    
    uid = GlobalResourceUID(
        namespace="puppyengine", 
        resource_type="modify",
        resource_name="convert2structured",
        version="v1"
    )
    
    config = ResourceConfig(
        resource_id=resource_id,
        resource_uid=uid, 
        resource_type=ResourceType.MODIFY,
        io_config=IOConfig(
            input_format=ContentType.TEXT,   # 输入text
            output_format=ContentType.JSON,  # 输出structured
            shared_adapters=True
        )
    )
    
    context = ExecutionContext(resource_id=resource_id)
    return ModifyConvert2StructuredResource(config, context)


# ModifyEditTextResource
def create_modify_edit_text_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyEditText资源"""
    if not resource_id:
        resource_id = f"modify_edit_text_{str(uuid.uuid4())[:8]}"
    
    uid = GlobalResourceUID(
        namespace="puppyengine",
        resource_type="modify", 
        resource_name="edit_text",
        version="v1"
    )
    
    config = ResourceConfig(
        resource_id=resource_id,
        resource_uid=uid,
        resource_type=ResourceType.MODIFY,
        io_config=IOConfig(
            input_format=ContentType.TEXT,
            output_format=ContentType.TEXT,
            shared_adapters=True
        )
    )
    
    context = ExecutionContext(resource_id=resource_id)
    return ModifyEditTextResource(config, context)


# ModifyEditStructuredResource
def create_modify_edit_structured_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyEditStructured资源"""
    if not resource_id:
        resource_id = f"modify_edit_structured_{str(uuid.uuid4())[:8]}"
    
    uid = GlobalResourceUID(
        namespace="puppyengine",
        resource_type="modify",
        resource_name="edit_structured", 
        version="v1"
    )
    
    config = ResourceConfig(
        resource_id=resource_id,
        resource_uid=uid,
        resource_type=ResourceType.MODIFY,
        io_config=IOConfig(
            input_format=ContentType.JSON,
            output_format=ContentType.JSON,
            shared_adapters=True
        )
    )
    
    context = ExecutionContext(resource_id=resource_id)
    return ModifyEditStructuredResource(config, context)


def create_modify_resource(modify_type: str, resource_id: str = None) -> ExecutableResource:
    """工厂函数：根据modify_type创建对应的资源（完整资源ID支持）"""
    creators = {
        "copy": create_modify_copy_resource,
        "convert2text": create_modify_convert2text_resource,
        "convert2structured": create_modify_convert2structured_resource,
        "edit_text": create_modify_edit_text_resource,
        "edit_structured": create_modify_edit_structured_resource,
    }
    
    creator = creators.get(modify_type)
    if not creator:
        raise ValueError(f"Unsupported modify type: {modify_type}")
    
    resource = creator(resource_id)
    
    # 创建完整的资源元数据（按照设计文档）
    metadata = ResourceMetadata(
        uid=resource.config.resource_uid,
        owner="system",
        description=f"ModifyEdge {modify_type} resource",
        tags=[modify_type, "edge", "modify"],
        public=False,
        server_location="local"
    )
    
    # 将元数据附加到资源（可在后续版本中用于服务发现）
    resource._metadata = metadata
    
    return resource 