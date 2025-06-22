"""
PuppyEngine ExecutableResources - Edge Resources

Edge资源实现系列:
- Modify Edge Resources: 数据修改和转换
- LLM Edge Resources: 大语言模型处理  
- Search Edge Resources: 搜索和检索
- Chunk Edge Resources: 文本分块处理
- 统一的Edge资源架构
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
    BlockAdapterFactory
)


# =============================================================================
# Modify Edge Resources (原ModifyEdge重构为Edge资源)
# =============================================================================

class ModifyEdgeResource(ExecutableResource):
    """Modify Edge资源基类 - 数据修改和转换的统一基础"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        # 确保资源类型为EDGE
        if config.resource_type != ResourceType.EDGE:
            config.resource_type = ResourceType.EDGE
        super().__init__(config, context)


class ModifyCopyEdgeResource(ModifyEdgeResource):
    """内容复制Edge资源"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge", 
                resource_name="modify.copy",
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
            "operation": "modify.copy",
            "resource_uid": self.config.resource_uid.short_id
        }


class ModifyConvert2TextEdgeResource(ModifyEdgeResource):
    """结构化数据转文本Edge资源"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name="modify.convert2text",
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
            "operation": "modify.convert2text",
            "resource_uid": self.config.resource_uid.short_id,
            "original_type": type(content).__name__
        }


class ModifyConvert2StructuredEdgeResource(ModifyEdgeResource):
    """文本转结构化数据Edge资源"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name="modify.convert2structured",
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
            elif conversion_mode == "split_by_character":
                # 按字符分割
                separators = inputs.get("list_separator", [","])
                structured_result = content
                for sep in separators:
                    if sep in structured_result:
                        structured_result = [item.strip() for item in structured_result.split(sep)]
                        break
                if isinstance(structured_result, str):
                    structured_result = [structured_result]
            elif conversion_mode == "split_by_length":
                # 按长度分割
                length = inputs.get("length_separator", 100)
                structured_result = [content[i:i+length] for i in range(0, len(content), length)]
            elif conversion_mode == "wrap_into_dict":
                # 包装为字典
                dict_key = inputs.get("dict_key", "content")
                structured_result = {dict_key: content}
            else:
                # 默认JSON解析
                structured_result = json.loads(content)
                
        except (json.JSONDecodeError, ValueError, SyntaxError) as e:
            # 解析失败时返回原文本
            structured_result = {"raw_text": content, "parse_error": str(e)}
        
        return {
            "result": structured_result,
            "operation": "modify.convert2structured",
            "resource_uid": self.config.resource_uid.short_id,
            "conversion_mode": conversion_mode
        }


class ModifyEditTextEdgeResource(ModifyEdgeResource):
    """文本编辑Edge资源"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name="modify.edit_text",
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
            "operation": "modify.edit_text",
            "resource_uid": self.config.resource_uid.short_id,
            "applied_operations": {
                "slice": slice_range if slice_range != [0, -1] else None,
                "sort": sort_type if sort_type else None,
                "variable_replace": bool(plugins)
            }
        }


class ModifyEditStructuredEdgeResource(ModifyEdgeResource):
    """结构化数据编辑Edge资源"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name="modify.edit_structured",
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
            "operation": "modify.edit_structured",
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


# =============================================================================
# Edge Resource Factory
# =============================================================================

class EdgeResourceFactory:
    """Edge资源工厂 - 支持URI格式创建"""
    
    _edge_registry = {
        # Modify Edge Resources
        "modify.copy": ModifyCopyEdgeResource,
        "modify.convert2text": ModifyConvert2TextEdgeResource,
        "modify.convert2structured": ModifyConvert2StructuredEdgeResource,
        "modify.edit_text": ModifyEditTextEdgeResource,
        "modify.edit_structured": ModifyEditStructuredEdgeResource,
        
        # 可以轻松扩展其他Edge类型
        # "llm.chat": LLMChatEdgeResource,
        # "search.vector": VectorSearchEdgeResource,
        # "chunk.length": LengthChunkEdgeResource,
    }
    
    @classmethod
    def create_edge_resource(
        cls, 
        edge_type_or_uri: str, 
        config: ResourceConfigProtocol = None,
        context: ExecutionContext = None
    ) -> ExecutableResource:
        """根据类型或URI创建Edge资源"""
        
        # 解析资源标识
        if "://" in edge_type_or_uri:
            # URI格式
            resource_uid = GlobalResourceUID.from_url(edge_type_or_uri)
            resource_key = resource_uid.resource_name  # 如: modify.edit_text
        else:
            # 传统格式或简单名称
            resource_key = edge_type_or_uri
            resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name=resource_key,
                version="v1"
            )
        
        # 查找资源类
        resource_class = cls._edge_registry.get(resource_key)
        if not resource_class:
            raise ValueError(f"No edge resource found for: {resource_key}")
        
        # 创建配置和上下文（如果未提供）
        if config is None:
            config = cls._create_default_config(resource_uid)
        if context is None:
            context = ExecutionContext(resource_id=f"edge_{uuid.uuid4().hex[:8]}")
        
        return resource_class(config, context)
    
    @classmethod
    def _create_default_config(cls, resource_uid: GlobalResourceUID) -> ResourceConfig:
        """创建默认资源配置"""
        # 根据资源类型推断I/O格式
        io_config = cls._infer_io_config(resource_uid)
        
        return ResourceConfig(
            resource_id=f"resource_{resource_uid.short_id}",
            resource_uid=resource_uid,
            resource_type=ResourceType.EDGE,
            io_config=io_config
        )
    
    @classmethod
    def _infer_io_config(cls, resource_uid: GlobalResourceUID) -> IOConfig:
        """根据资源类型推断I/O配置"""
        main_type = resource_uid.main_type
        sub_type = resource_uid.sub_type
        
        if main_type == "modify":
            if sub_type == "convert2text":
                return IOConfig(
                    input_format=ContentType.JSON,
                    output_format=ContentType.TEXT
                )
            elif sub_type == "convert2structured":
                return IOConfig(
                    input_format=ContentType.TEXT,
                    output_format=ContentType.JSON
                )
            elif sub_type == "edit_text":
                return IOConfig(
                    input_format=ContentType.TEXT,
                    output_format=ContentType.TEXT
                )
            else:
                # 默认JSON格式
                return IOConfig(
                    input_format=ContentType.JSON,
                    output_format=ContentType.JSON
                )
        
        # 其他类型的默认配置
        return IOConfig()
    
    @classmethod
    def register_edge_resource(cls, resource_name: str, resource_class: type):
        """注册新的Edge资源类型"""
        cls._edge_registry[resource_name] = resource_class
    
    @classmethod
    def list_available_resources(cls) -> List[str]:
        """列出可用的Edge资源"""
        return list(cls._edge_registry.keys())


# =============================================================================
# Factory Functions (向后兼容)
# =============================================================================

def create_modify_copy_edge_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyCopy Edge资源"""
    return EdgeResourceFactory.create_edge_resource("modify.copy")

def create_modify_convert2text_edge_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyConvert2Text Edge资源"""
    return EdgeResourceFactory.create_edge_resource("modify.convert2text")

def create_modify_convert2structured_edge_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyConvert2Structured Edge资源"""
    return EdgeResourceFactory.create_edge_resource("modify.convert2structured")

def create_modify_edit_text_edge_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyEditText Edge资源"""
    return EdgeResourceFactory.create_edge_resource("modify.edit_text")

def create_modify_edit_structured_edge_resource(resource_id: str = None) -> ExecutableResource:
    """创建ModifyEditStructured Edge资源"""
    return EdgeResourceFactory.create_edge_resource("modify.edit_structured")

def create_modify_edge_resource(modify_type: str, resource_id: str = None) -> ExecutableResource:
    """创建Modify Edge资源（通用工厂函数）"""
    resource_name = f"modify.{modify_type}"
    return EdgeResourceFactory.create_edge_resource(resource_name) 