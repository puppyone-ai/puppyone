"""
Edge适配器系统 - 为既有Edge提供Content Adapter支持

在不修改原始ModularEdges代码的前提下，通过适配器模式为Edge提供新的内容处理能力。
基于POP（Protocol-Oriented Programming）设计。
"""

import asyncio
from typing import Dict, Any, Protocol, runtime_checkable, Optional, Callable
from abc import ABC, abstractmethod

from .base import (
    ContentAdapterFactory, 
    ContentType, 
    ExecutionContext,
    GlobalResourceUID,
    ResourceMetadata
)


@runtime_checkable
class EdgeAdapterProtocol(Protocol):
    """Edge适配器协议（POP设计）"""
    
    async def adapt_inputs(self, raw_inputs: Dict[str, Any], block_configs: Dict[str, Any]) -> Dict[str, Any]:
        """适配输入数据"""
        ...
    
    async def adapt_outputs(self, raw_outputs: Any, output_block_types: Dict[str, str]) -> Any:
        """适配输出数据"""
        ...
    
    def should_use_adapter(self) -> bool:
        """判断是否应该使用适配器"""
        ...
    
    def get_edge_type(self) -> str:
        """获取Edge类型"""
        ...


class BaseEdgeAdapter(ABC):
    """Edge适配器基类"""
    
    def __init__(self, edge_type: str):
        self.edge_type = edge_type
        self.context: Optional[ExecutionContext] = None
        self.metadata: Optional[ResourceMetadata] = None
    
    def set_context(self, context: ExecutionContext):
        """设置执行上下文"""
        self.context = context
    
    def set_metadata(self, metadata: ResourceMetadata):
        """设置资源元数据"""
        self.metadata = metadata
    
    def get_edge_type(self) -> str:
        """获取Edge类型"""
        return self.edge_type
    
    @abstractmethod
    async def adapt_inputs(self, raw_inputs: Dict[str, Any], block_configs: Dict[str, Any]) -> Dict[str, Any]:
        """适配输入数据"""
        pass
    
    @abstractmethod
    async def adapt_outputs(self, raw_outputs: Any, output_block_types: Dict[str, str]) -> Any:
        """适配输出数据"""
        pass
    
    @abstractmethod
    def should_use_adapter(self) -> bool:
        """判断是否应该使用适配器"""
        pass


class DefaultEdgeAdapter(BaseEdgeAdapter):
    """默认Edge适配器（不做任何处理）"""
    
    def __init__(self, edge_type: str):
        super().__init__(edge_type)
    
    async def adapt_inputs(self, raw_inputs: Dict[str, Any], block_configs: Dict[str, Any]) -> Dict[str, Any]:
        """默认输入适配（直接返回原始数据）"""
        return raw_inputs
    
    async def adapt_outputs(self, raw_outputs: Any, output_block_types: Dict[str, str]) -> Any:
        """默认输出适配（直接返回原始数据）"""
        return raw_outputs
    
    def should_use_adapter(self) -> bool:
        """默认不使用适配器"""
        return False


class ModifyEdgeAdapter(BaseEdgeAdapter):
    """ModifyEdge专用适配器 - 集成Content Adapter系统"""
    
    def __init__(self):
        super().__init__("modify")
    
    async def adapt_inputs(self, raw_inputs: Dict[str, Any], block_configs: Dict[str, Any]) -> Dict[str, Any]:
        """适配ModifyEdge的输入数据"""
        adapted_inputs = {}
        
        for key, value in raw_inputs.items():
            # 检查是否有对应的block配置
            if key in block_configs:
                block_config = block_configs[key]
                block_type = self._get_block_type(block_config)
                content = block_config.get("content")
                
                # 根据block类型选择Content Adapter
                adapter = self._get_content_adapter(block_type)
                
                # 规范化数据
                adapted_inputs[key] = await adapter.normalize(content)
            else:
                # 没有block配置的情况，直接使用原值
                adapted_inputs[key] = value
        
        return adapted_inputs
    
    async def adapt_outputs(self, raw_outputs: Any, output_block_types: Dict[str, str]) -> Any:
        """适配ModifyEdge的输出数据"""
        # ModifyEdge通常返回单个值，需要根据输出block类型进行适配
        if not output_block_types:
            return raw_outputs
        
        # 如果只有一个输出block，直接适配
        if len(output_block_types) == 1:
            block_type = next(iter(output_block_types.values()))
            adapter = self._get_content_adapter(block_type)
            return await adapter.normalize(raw_outputs)
        
        # 多个输出block的情况（较少见）
        adapted_outputs = {}
        for block_id, block_type in output_block_types.items():
            adapter = self._get_content_adapter(block_type)
            adapted_outputs[block_id] = await adapter.normalize(raw_outputs)
        
        return adapted_outputs
    
    def should_use_adapter(self) -> bool:
        """ModifyEdge使用适配器"""
        return True
    
    def _get_block_type(self, block_config: Dict[str, Any]) -> str:
        """从block配置中获取类型"""
        # 优先从block配置中获取type
        if "type" in block_config:
            return block_config["type"]
        
        # 如果没有显式type，根据content推断
        content = block_config.get("content")
        if isinstance(content, (dict, list)):
            return "structured"
        else:
            return "text"
    
    def _get_content_adapter(self, block_type: str):
        """根据block类型获取Content Adapter"""
        if block_type == "text":
            return ContentAdapterFactory.create_adapter(ContentType.TEXT)
        elif block_type == "structured":
            return ContentAdapterFactory.create_adapter(ContentType.JSON)
        else:
            # 默认使用TEXT适配器
            return ContentAdapterFactory.create_adapter(ContentType.TEXT)


class EdgeAdapterFactory:
    """Edge适配器工厂"""
    
    _adapters = {
        "modify": ModifyEdgeAdapter,
        "llm": DefaultEdgeAdapter,
        "search": DefaultEdgeAdapter,
        "code": DefaultEdgeAdapter,
        "save": DefaultEdgeAdapter,
        "load": DefaultEdgeAdapter,
        "chunk": DefaultEdgeAdapter,
        "rerank": DefaultEdgeAdapter,
        "ifelse": DefaultEdgeAdapter,
        "generator": DefaultEdgeAdapter,
        "query_rewrite": DefaultEdgeAdapter,
    }
    
    @classmethod
    def create_adapter(cls, edge_type: str) -> BaseEdgeAdapter:
        """创建Edge适配器"""
        adapter_class = cls._adapters.get(edge_type, DefaultEdgeAdapter)
        
        if adapter_class == DefaultEdgeAdapter:
            return adapter_class(edge_type)
        else:
            return adapter_class()
    
    @classmethod
    def register_adapter(cls, edge_type: str, adapter_class: type):
        """注册新的Edge适配器"""
        cls._adapters[edge_type] = adapter_class


class EdgeExecutorWrapper:
    """Edge执行器包装器 - 为既有EdgeExecutor提供适配器支持"""
    
    def __init__(self, edge_executor_class):
        self.edge_executor_class = edge_executor_class
    
    async def execute_with_adapter(
        self,
        edge_type: str,
        edge_configs: Dict[str, Any],
        block_configs: Dict[str, Any],
        output_block_types: Optional[Dict[str, str]] = None
    ) -> Any:
        """带适配器的Edge执行"""
        
        # 1. 创建适配器
        adapter = EdgeAdapterFactory.create_adapter(edge_type)
        
        # 2. 设置执行上下文和元数据
        context = ExecutionContext(
            resource_id=f"{edge_type}_execution",
            workspace_id="default"
        )
        adapter.set_context(context)
        
        # 创建资源元数据
        uid = GlobalResourceUID(
            namespace="puppyengine",
            resource_type="edge",
            resource_name=edge_type,
            version="v1"
        )
        metadata = ResourceMetadata(
            uid=uid,
            owner="system",
            description=f"Edge adapter for {edge_type}",
            tags=[edge_type, "edge", "adapter"],
            public=False,
            server_location="local"
        )
        adapter.set_metadata(metadata)
        
        # 3. 检查是否需要使用适配器
        if adapter.should_use_adapter():
            # 4. 适配输入数据
            adapted_inputs = await adapter.adapt_inputs(edge_configs, block_configs)
            
            # 5. 执行原始Edge（使用适配后的输入）
            executor = self.edge_executor_class(
                edge_type=edge_type,
                edge_configs=adapted_inputs,
                block_configs=block_configs
            )
            raw_result = executor.execute()
            
            # 6. 适配输出数据
            adapted_result = await adapter.adapt_outputs(
                raw_result.result if hasattr(raw_result, 'result') else raw_result,
                output_block_types or {}
            )
            
            # 7. 更新结果
            if hasattr(raw_result, 'result'):
                raw_result.result = adapted_result
                return raw_result
            else:
                return adapted_result
        else:
            # 传统执行方式（不使用适配器）
            executor = self.edge_executor_class(
                edge_type=edge_type,
                edge_configs=edge_configs,
                block_configs=block_configs
            )
            return executor.execute()


def create_edge_executor_wrapper():
    """创建Edge执行器包装器的工厂函数"""
    try:
        # 动态导入EdgeExecutor
        from ModularEdges.EdgeExecutor import EdgeExecutor
        return EdgeExecutorWrapper(EdgeExecutor)
    except ImportError:
        raise ImportError("Cannot import EdgeExecutor from ModularEdges")


# 异步执行的辅助函数
def run_async_adapter(coro):
    """运行异步适配器函数的辅助函数"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    return loop.run_until_complete(coro) 