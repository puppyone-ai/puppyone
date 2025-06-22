"""
PuppyEngine ExecutableResources - Block Resources

Block资源实现系列:
- Text Block Resources: 文本数据存储和处理
- JSON Block Resources: 结构化数据存储和处理  
- Binary Block Resources: 二进制数据存储和处理
- 统一的Block资源架构
"""

import json
import uuid
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from .base import (
    BlockResource,
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
# Core Block Resources
# =============================================================================

class TextBlockResource(BlockResource):
    """文本Block资源 - 处理text类型的数据存储"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name="text",
                version="v1"
            )
        super().__init__(config, context)
    
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行文本Block特定逻辑"""
        if operation == "append":
            # 文本追加
            text_to_append = params.get("text", "")
            if isinstance(self._data.get("content"), str):
                self._data["content"] += str(text_to_append)
            else:
                self._data["content"] = str(text_to_append)
            
            return {"success": True, "new_length": len(self._data["content"])}
        
        elif operation == "replace":
            # 文本替换
            old_text = params.get("old", "")
            new_text = params.get("new", "")
            if isinstance(self._data.get("content"), str):
                self._data["content"] = self._data["content"].replace(old_text, new_text)
                return {"success": True, "content": self._data["content"]}
            
        elif operation == "slice":
            # 文本切片
            start = params.get("start", 0)
            end = params.get("end", None)
            if isinstance(self._data.get("content"), str):
                sliced_content = self._data["content"][start:end]
                return {"success": True, "sliced_content": sliced_content}
        
        elif operation == "search":
            # 文本搜索
            pattern = params.get("pattern", "")
            if isinstance(self._data.get("content"), str):
                import re
                matches = re.findall(pattern, self._data["content"])
                return {"success": True, "matches": matches}
        
        return {"success": False, "error": f"Unknown operation: {operation}"}
    
    async def get_text_content(self) -> str:
        """获取文本内容"""
        return self._data.get("content", "")
    
    async def set_text_content(self, content: str) -> bool:
        """设置文本内容"""
        self._data["content"] = str(content)
        self._metadata["last_updated"] = datetime.utcnow().isoformat()
        return True


class JSONBlockResource(BlockResource):
    """JSON Block资源 - 处理structured类型的数据存储"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name="json",
                version="v1"
            )
        super().__init__(config, context)
    
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行JSON Block特定逻辑"""
        if operation == "get_path":
            # 按路径获取值
            path = params.get("path", [])
            default = params.get("default")
            
            current = self._data.get("content", {})
            try:
                for key in path:
                    if isinstance(current, dict):
                        current = current[key]
                    elif isinstance(current, list):
                        current = current[int(key)]
                    else:
                        return {"success": False, "value": default}
                return {"success": True, "value": current}
            except (KeyError, IndexError, ValueError, TypeError):
                return {"success": False, "value": default}
        
        elif operation == "set_path":
            # 按路径设置值
            path = params.get("path", [])
            value = params.get("value")
            
            if not path:
                self._data["content"] = value
                return {"success": True}
            
            if "content" not in self._data:
                self._data["content"] = {}
            
            current = self._data["content"]
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
            
            self._metadata["last_updated"] = datetime.utcnow().isoformat()
            return {"success": True}
        
        elif operation == "merge":
            # 合并JSON数据
            data_to_merge = params.get("data", {})
            if isinstance(self._data.get("content"), dict) and isinstance(data_to_merge, dict):
                self._data["content"].update(data_to_merge)
                return {"success": True, "merged_keys": list(data_to_merge.keys())}
        
        elif operation == "keys":
            # 获取所有键
            if isinstance(self._data.get("content"), dict):
                return {"success": True, "keys": list(self._data["content"].keys())}
            elif isinstance(self._data.get("content"), list):
                return {"success": True, "keys": list(range(len(self._data["content"])))}
        
        return {"success": False, "error": f"Unknown operation: {operation}"}
    
    async def get_json_content(self) -> Union[Dict, List]:
        """获取JSON内容"""
        return self._data.get("content", {})
    
    async def set_json_content(self, content: Union[Dict, List]) -> bool:
        """设置JSON内容"""
        if isinstance(content, (dict, list)):
            self._data["content"] = content
            self._metadata["last_updated"] = datetime.utcnow().isoformat()
            return True
        return False


class BinaryBlockResource(BlockResource):
    """Binary Block资源 - 处理二进制数据存储"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name="binary",
                version="v1"
            )
        super().__init__(config, context)
    
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行Binary Block特定逻辑"""
        if operation == "encode":
            # 编码数据为二进制
            data = params.get("data")
            encoding = params.get("encoding", "utf-8")
            
            if isinstance(data, str):
                binary_data = data.encode(encoding)
            elif isinstance(data, (dict, list)):
                json_str = json.dumps(data)
                binary_data = json_str.encode(encoding)
            else:
                binary_data = bytes(data)
            
            self._data["content"] = binary_data
            self._metadata["encoding"] = encoding
            self._metadata["last_updated"] = datetime.utcnow().isoformat()
            return {"success": True, "size": len(binary_data)}
        
        elif operation == "decode":
            # 解码二进制数据
            encoding = params.get("encoding", "utf-8")
            decode_as = params.get("decode_as", "text")  # text, json
            
            if isinstance(self._data.get("content"), bytes):
                try:
                    decoded_str = self._data["content"].decode(encoding)
                    if decode_as == "json":
                        decoded_data = json.loads(decoded_str)
                        return {"success": True, "decoded_data": decoded_data}
                    else:
                        return {"success": True, "decoded_data": decoded_str}
                except (UnicodeDecodeError, json.JSONDecodeError) as e:
                    return {"success": False, "error": str(e)}
        
        elif operation == "size":
            # 获取二进制数据大小
            if isinstance(self._data.get("content"), bytes):
                return {"success": True, "size": len(self._data["content"])}
        
        return {"success": False, "error": f"Unknown operation: {operation}"}
    
    async def get_binary_content(self) -> bytes:
        """获取二进制内容"""
        content = self._data.get("content")
        if isinstance(content, bytes):
            return content
        return b""
    
    async def set_binary_content(self, content: bytes) -> bool:
        """设置二进制内容"""
        if isinstance(content, bytes):
            self._data["content"] = content
            self._metadata["last_updated"] = datetime.utcnow().isoformat()
            return True
        return False


# =============================================================================
# Specialized Block Resources
# =============================================================================

class EmbeddingBlockResource(JSONBlockResource):
    """向量嵌入Block资源 - 专门处理embedding数据"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name="embedding",
                version="v1"
            )
        super().__init__(config, context)
    
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行Embedding Block特定逻辑"""
        if operation == "add_embedding":
            # 添加向量嵌入
            vector = params.get("vector", [])
            metadata = params.get("metadata", {})
            
            if "embedding_view" not in self._data:
                self._data["embedding_view"] = []
            
            embedding_entry = {
                "vector": vector,
                "metadata": metadata,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            self._data["embedding_view"].append(embedding_entry)
            return {"success": True, "embedding_count": len(self._data["embedding_view"])}
        
        elif operation == "search_similar":
            # 搜索相似向量
            query_vector = params.get("query_vector", [])
            top_k = params.get("top_k", 5)
            
            if "embedding_view" not in self._data:
                return {"success": False, "error": "No embeddings available"}
            
            # 简单的余弦相似度计算
            similarities = []
            for i, embedding in enumerate(self._data["embedding_view"]):
                vector = embedding.get("vector", [])
                if len(vector) == len(query_vector):
                    # 计算余弦相似度
                    dot_product = sum(a * b for a, b in zip(query_vector, vector))
                    norm_a = sum(a * a for a in query_vector) ** 0.5
                    norm_b = sum(b * b for b in vector) ** 0.5
                    
                    if norm_a > 0 and norm_b > 0:
                        similarity = dot_product / (norm_a * norm_b)
                        similarities.append((i, similarity, embedding))
            
            # 排序并返回top_k
            similarities.sort(key=lambda x: x[1], reverse=True)
            top_results = similarities[:top_k]
            
            return {
                "success": True,
                "results": [
                    {"index": idx, "similarity": sim, "embedding": emb}
                    for idx, sim, emb in top_results
                ]
            }
        
        # 回退到父类处理
        return await super()._execute_block_logic(operation, params)


class FileBlockResource(BinaryBlockResource):
    """文件Block资源 - 专门处理文件数据"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        if not hasattr(config, 'resource_uid') or not config.resource_uid:
            config.resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name="file",
                version="v1"
            )
        super().__init__(config, context)
    
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行File Block特定逻辑"""
        if operation == "load_file":
            # 加载文件
            file_path = params.get("file_path", "")
            encoding = params.get("encoding", "utf-8")
            
            try:
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                
                self._data["content"] = file_content
                self._metadata.update({
                    "file_path": file_path,
                    "file_size": len(file_content),
                    "encoding": encoding,
                    "last_updated": datetime.utcnow().isoformat()
                })
                
                return {"success": True, "file_size": len(file_content)}
            except Exception as e:
                return {"success": False, "error": str(e)}
        
        elif operation == "save_file":
            # 保存文件
            file_path = params.get("file_path", "")
            
            try:
                with open(file_path, 'wb') as f:
                    f.write(self._data.get("content", b""))
                
                self._metadata["saved_to"] = file_path
                return {"success": True, "saved_to": file_path}
            except Exception as e:
                return {"success": False, "error": str(e)}
        
        elif operation == "get_file_info":
            # 获取文件信息
            return {
                "success": True,
                "file_info": {
                    "size": len(self._data.get("content", b"")),
                    "metadata": self._metadata
                }
            }
        
        # 回退到父类处理
        return await super()._execute_block_logic(operation, params)


# =============================================================================
# Block Resource Factory
# =============================================================================

class BlockResourceFactory:
    """Block资源工厂 - 支持URI格式创建"""
    
    _block_registry = {
        # Core Block Resources
        "text": TextBlockResource,
        "json": JSONBlockResource,
        "binary": BinaryBlockResource,
        
        # Specialized Block Resources
        "embedding": EmbeddingBlockResource,
        "file": FileBlockResource,
        
        # 兼容既有WorkFlow的block类型
        "structured": JSONBlockResource,  # structured映射到json
    }
    
    @classmethod
    def create_block_resource(
        cls, 
        block_type_or_uri: str, 
        config: ResourceConfigProtocol = None,
        context: ExecutionContext = None
    ) -> BlockResource:
        """根据类型或URI创建Block资源"""
        
        # 解析资源标识
        if "://" in block_type_or_uri:
            # URI格式
            resource_uid = GlobalResourceUID.from_url(block_type_or_uri)
            resource_key = resource_uid.resource_name
        else:
            # 传统格式或简单名称
            resource_key = block_type_or_uri
            resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="block",
                resource_name=resource_key,
                version="v1"
            )
        
        # 查找资源类
        resource_class = cls._block_registry.get(resource_key)
        if not resource_class:
            raise ValueError(f"No block resource found for: {resource_key}")
        
        # 创建配置和上下文（如果未提供）
        if config is None:
            config = cls._create_default_config(resource_uid)
        if context is None:
            context = ExecutionContext(resource_id=f"block_{uuid.uuid4().hex[:8]}")
        
        return resource_class(config, context)
    
    @classmethod
    def _create_default_config(cls, resource_uid: GlobalResourceUID) -> ResourceConfig:
        """创建默认资源配置"""
        # 根据资源类型推断I/O格式
        io_config = cls._infer_io_config(resource_uid)
        
        return ResourceConfig(
            resource_id=f"resource_{resource_uid.short_id}",
            resource_uid=resource_uid,
            resource_type=ResourceType.BLOCK,
            io_config=io_config
        )
    
    @classmethod
    def _infer_io_config(cls, resource_uid: GlobalResourceUID) -> IOConfig:
        """根据资源类型推断I/O配置"""
        resource_name = resource_uid.resource_name
        
        if resource_name in ["text"]:
            return IOConfig(
                input_format=ContentType.TEXT,
                output_format=ContentType.TEXT
            )
        elif resource_name in ["json", "structured", "embedding"]:
            return IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON
            )
        elif resource_name in ["binary", "file"]:
            return IOConfig(
                input_format=ContentType.BINARY,
                output_format=ContentType.BINARY
            )
        
        # 默认配置
        return IOConfig()
    
    @classmethod
    def register_block_resource(cls, resource_name: str, resource_class: type):
        """注册新的Block资源类型"""
        cls._block_registry[resource_name] = resource_class
    
    @classmethod
    def list_available_resources(cls) -> List[str]:
        """列出可用的Block资源"""
        return list(cls._block_registry.keys())
    
    @classmethod
    def create_from_workflow_block(cls, block_data: Dict[str, Any]) -> BlockResource:
        """从WorkFlow的block数据创建Block资源"""
        block_type = block_data.get("type", "text")
        block_label = block_data.get("label", "")
        block_content = block_data.get("data", {})
        
        # 创建Block资源
        block_resource = cls.create_block_resource(block_type)
        
        # 设置内容
        if block_type == "text":
            content = block_content.get("content", "")
            block_resource._data = {"content": content}
        elif block_type in ["structured", "json"]:
            content = block_content.get("content", {})
            embedding_view = block_content.get("embedding_view", [])
            block_resource._data = {
                "content": content,
                "embedding_view": embedding_view
            }
        
        # 设置元数据
        block_resource._metadata = {
            "label": block_label,
            "original_type": block_type,
            "created_from_workflow": True,
            "created_at": datetime.utcnow().isoformat()
        }
        
        return block_resource


# =============================================================================
# Factory Functions (向后兼容)
# =============================================================================

def create_text_block_resource(resource_id: str = None) -> BlockResource:
    """创建Text Block资源"""
    return BlockResourceFactory.create_block_resource("text")

def create_json_block_resource(resource_id: str = None) -> BlockResource:
    """创建JSON Block资源"""
    return BlockResourceFactory.create_block_resource("json")

def create_binary_block_resource(resource_id: str = None) -> BlockResource:
    """创建Binary Block资源"""
    return BlockResourceFactory.create_block_resource("binary")

def create_embedding_block_resource(resource_id: str = None) -> BlockResource:
    """创建Embedding Block资源"""
    return BlockResourceFactory.create_block_resource("embedding")

def create_file_block_resource(resource_id: str = None) -> BlockResource:
    """创建File Block资源"""
    return BlockResourceFactory.create_block_resource("file") 