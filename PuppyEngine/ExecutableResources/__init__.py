"""
PuppyEngine ExecutableResources - Unified Resource Architecture

统一资源架构:
- Edge Resources: 数据流处理和转换
- Block Resources: 数据存储和管理
- Protocol Adapters: 协议适配和转换
- Factory Systems: 资源创建和管理

重构成果:
- 去除多层级设计，改为平级架构
- 统一URI格式的资源标识
- 内化I/O处理，提升性能
- 完整的向后兼容支持
"""

# Core Base Classes
from .base import (
    # Enums
    ContentType,
    ResourceType,
    
    # Core Classes
    GlobalResourceUID,
    ResourceMetadata,
    ExecutionContext,
    
    # Protocol Definitions
    IOConfigProtocol,
    ResourceConfigProtocol,
    ContentAdapterProtocol,
    ExecutableResourceProtocol,
    BlockResourceProtocol,
    
    # Configuration Classes
    IOConfig,
    ResourceConfig,
    
    # Content/Block Adapters
    BaseContentAdapter,
    JSONContentAdapter,
    TextContentAdapter,
    BinaryContentAdapter,
    BlockAdapterFactory,
    
    # Resource Base Classes
    ExecutableResource,
    BlockResource,
    
    # Backward Compatibility
    ContentAdapterFactory  # Alias for BlockAdapterFactory
)

# Edge Resources
from .edge_resources import (
    # Edge Resource Classes
    ModifyEdgeResource,
    ModifyCopyEdgeResource,
    ModifyConvert2TextEdgeResource,
    ModifyConvert2StructuredEdgeResource,
    ModifyEditTextEdgeResource,
    ModifyEditStructuredEdgeResource,
    
    # Edge Factory
    EdgeResourceFactory,
    
    # Factory Functions (Backward Compatibility)
    create_modify_copy_edge_resource,
    create_modify_convert2text_edge_resource,
    create_modify_convert2structured_edge_resource,
    create_modify_edit_text_edge_resource,
    create_modify_edit_structured_edge_resource,
    create_modify_edge_resource
)

# Block Resources
from .block_resources import (
    # Block Resource Classes
    TextBlockResource,
    JSONBlockResource,
    BinaryBlockResource,
    EmbeddingBlockResource,
    FileBlockResource,
    
    # Block Factory
    BlockResourceFactory,
    
    # Factory Functions (Backward Compatibility)
    create_text_block_resource,
    create_json_block_resource,
    create_binary_block_resource,
    create_embedding_block_resource,
    create_file_block_resource
)

# Protocol Adapters
from .edge_protocol_adapter import (
    EdgeProtocolAdapter,
    EdgeProtocolValidator,
    create_example_protocols,
    test_protocol_adapter
)

# Legacy Compatibility (from original modify_resources.py and compatibility_adapter.py)
try:
    from .modify_resources import (
        # Legacy Resource Classes (for backward compatibility)
        ModifyCopyResource,
        ModifyConvert2TextResource,
        ModifyConvert2StructuredResource,
        ModifyEditTextResource,
        ModifyEditStructuredResource,
        
        # Legacy Factory Functions
        create_modify_copy_resource,
        create_modify_convert2text_resource,
        create_modify_convert2structured_resource,
        create_modify_edit_text_resource,
        create_modify_edit_structured_resource,
        create_modify_resource
    )
except ImportError:
    # If legacy files don't exist, create aliases
    ModifyCopyResource = ModifyCopyEdgeResource
    ModifyConvert2TextResource = ModifyConvert2TextEdgeResource
    ModifyConvert2StructuredResource = ModifyConvert2StructuredEdgeResource
    ModifyEditTextResource = ModifyEditTextEdgeResource
    ModifyEditStructuredResource = ModifyEditStructuredEdgeResource
    
    create_modify_copy_resource = create_modify_copy_edge_resource
    create_modify_convert2text_resource = create_modify_convert2text_edge_resource
    create_modify_convert2structured_resource = create_modify_convert2structured_edge_resource
    create_modify_edit_text_resource = create_modify_edit_text_edge_resource
    create_modify_edit_structured_resource = create_modify_edit_structured_edge_resource
    create_modify_resource = create_modify_edge_resource

try:
    from .compatibility_adapter import (
        LegacyModifierFactoryAdapter
    )
except ImportError:
    # Create a simple compatibility adapter if the original doesn't exist
    class LegacyModifierFactoryAdapter:
        """简化的兼容性适配器"""
        
        @staticmethod
        def execute(modify_type: str, content: any, extra_configs: dict = None):
            """执行修改操作（兼容旧接口）"""
            edge_resource = EdgeResourceFactory.create_edge_resource(f"modify.{modify_type}")
            
            inputs = {"content": content}
            if extra_configs:
                inputs.update(extra_configs)
            
            import asyncio
            result = asyncio.run(edge_resource.execute(inputs))
            return result.get("result")


# Resource Registry for Dynamic Discovery
RESOURCE_REGISTRY = {
    # Edge Resources
    "edge": {
        "factory": EdgeResourceFactory,
        "resources": EdgeResourceFactory.list_available_resources()
    },
    
    # Block Resources  
    "block": {
        "factory": BlockResourceFactory,
        "resources": BlockResourceFactory.list_available_resources()
    }
}


def get_resource_factory(resource_type: str):
    """获取资源工厂"""
    if resource_type in RESOURCE_REGISTRY:
        return RESOURCE_REGISTRY[resource_type]["factory"]
    else:
        raise ValueError(f"Unknown resource type: {resource_type}")


def list_available_resources(resource_type: str = None) -> dict:
    """列出可用资源"""
    if resource_type:
        if resource_type in RESOURCE_REGISTRY:
            return {resource_type: RESOURCE_REGISTRY[resource_type]["resources"]}
        else:
            return {}
    else:
        return {k: v["resources"] for k, v in RESOURCE_REGISTRY.items()}


def create_resource_from_uri(uri: str, config=None, context=None):
    """从URI创建资源"""
    try:
        resource_uid = GlobalResourceUID.from_url(uri)
        resource_type = resource_uid.resource_type
        
        factory = get_resource_factory(resource_type)
        
        if resource_type == "edge":
            return factory.create_edge_resource(uri, config, context)
        elif resource_type == "block":
            return factory.create_block_resource(uri, config, context)
        else:
            raise ValueError(f"Unsupported resource type: {resource_type}")
            
    except Exception as e:
        raise ValueError(f"Failed to create resource from URI '{uri}': {str(e)}")


# Version and Metadata
__version__ = "2.0.0"
__architecture__ = "Unified Resource Architecture"
__compatibility__ = "Full backward compatibility with ModifyEdge"

__all__ = [
    # Core Classes
    "ContentType", "ResourceType", "GlobalResourceUID", "ResourceMetadata", "ExecutionContext",
    
    # Protocols
    "IOConfigProtocol", "ResourceConfigProtocol", "ContentAdapterProtocol", 
    "ExecutableResourceProtocol", "BlockResourceProtocol",
    
    # Configurations
    "IOConfig", "ResourceConfig",
    
    # Adapters and Base Classes
    "BaseContentAdapter", "JSONContentAdapter", "TextContentAdapter", "BinaryContentAdapter",
    "BlockAdapterFactory", "ContentAdapterFactory",
    "ExecutableResource", "BlockResource",
    
    # Edge Resources
    "ModifyEdgeResource", "ModifyCopyEdgeResource", "ModifyConvert2TextEdgeResource",
    "ModifyConvert2StructuredEdgeResource", "ModifyEditTextEdgeResource", "ModifyEditStructuredEdgeResource",
    "EdgeResourceFactory",
    
    # Block Resources
    "TextBlockResource", "JSONBlockResource", "BinaryBlockResource", 
    "EmbeddingBlockResource", "FileBlockResource", "BlockResourceFactory",
    
    # Protocol Adapters
    "EdgeProtocolAdapter", "EdgeProtocolValidator",
    
    # Legacy Compatibility
    "ModifyCopyResource", "ModifyConvert2TextResource", "ModifyConvert2StructuredResource",
    "ModifyEditTextResource", "ModifyEditStructuredResource", "LegacyModifierFactoryAdapter",
    
    # Factory Functions
    "create_modify_copy_edge_resource", "create_modify_convert2text_edge_resource",
    "create_modify_convert2structured_edge_resource", "create_modify_edit_text_edge_resource",
    "create_modify_edit_structured_edge_resource", "create_modify_edge_resource",
    "create_text_block_resource", "create_json_block_resource", "create_binary_block_resource",
    "create_embedding_block_resource", "create_file_block_resource",
    
    # Legacy Factory Functions
    "create_modify_copy_resource", "create_modify_convert2text_resource",
    "create_modify_convert2structured_resource", "create_modify_edit_text_resource",
    "create_modify_edit_structured_resource", "create_modify_resource",
    
    # Utility Functions
    "get_resource_factory", "list_available_resources", "create_resource_from_uri",
    "create_example_protocols", "test_protocol_adapter",
    
    # Registry
    "RESOURCE_REGISTRY",
    
    # Metadata
    "__version__", "__architecture__", "__compatibility__"
] 