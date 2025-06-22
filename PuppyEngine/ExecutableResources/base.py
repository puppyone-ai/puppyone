"""
PuppyEngine ExecutableResources - Core Base Classes

统一资源架构基础:
- 支持URI格式的资源标识
- Edge和Block作为核心资源类型
- Modify作为Edge资源的一种实现
- 统一的内容适配器系统
"""

import hashlib
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


class ContentType(Enum):
    """内容类型枚举（严格按照设计文档 - 仅支持三种核心类型）"""
    TEXT = "text"
    JSON = "json"
    BINARY = "binary"


class ResourceType(Enum):
    """资源类型枚举 - 重构为核心资源类型"""
    EDGE = "edge"        # Edge资源：处理数据流转换
    BLOCK = "block"      # Block资源：数据存储和管理
    WORKFLOW = "workflow" # Workflow资源：流程编排
    API = "api"          # API资源：外部接口
    CHATBOT = "chatbot"  # Chatbot资源：对话系统


@dataclass
class GlobalResourceUID:
    """全球唯一资源标识符 - 支持URI格式和subtype"""
    namespace: str = "puppyagent"    # 组织命名空间
    resource_type: str = "edge"      # 资源类型
    resource_name: str = ""          # 资源名称（支持subtype，如modify.edit_text）
    version: str = "v1"              # 版本
    protocol: str = "resource"       # 协议类型（resource, vibe等）
    
    def __post_init__(self):
        if not self.resource_name:
            self.resource_name = f"resource_{str(uuid.uuid4())[:8]}"
        # 生成全球唯一ID
        self.uid = self._generate_uid()
        self.short_id = self.uid[:8]
        # 创建时间戳
        self.created_at = datetime.utcnow()
    
    def _generate_uid(self) -> str:
        """生成全球唯一标识符"""
        content = f"{self.namespace}:{self.resource_type}:{self.resource_name}:{self.version}"
        return hashlib.sha256(content.encode()).hexdigest()
    
    def to_url(self) -> str:
        """转换为URI格式"""
        return f"{self.protocol}://{self.namespace}/{self.resource_type}/{self.resource_name}@{self.version}"
    
    @classmethod
    def from_url(cls, url: str) -> 'GlobalResourceUID':
        """从URI解析资源UID"""
        if "://" not in url:
            raise ValueError(f"Invalid resource URI format: {url}")
        
        protocol, rest = url.split("://", 1)
        parts = rest.split("/")
        
        if len(parts) != 3:
            raise ValueError(f"Invalid resource URI structure: {url}")
            
        namespace = parts[0]
        resource_type = parts[1]
        name_version = parts[2].split("@")
        resource_name = name_version[0]
        version = name_version[1] if len(name_version) > 1 else "v1"
        
        return cls(namespace, resource_type, resource_name, version, protocol)
    
    @property
    def main_type(self) -> str:
        """获取主要类型（如modify.edit_text -> modify）"""
        return self.resource_name.split('.')[0] if '.' in self.resource_name else self.resource_name
    
    @property
    def sub_type(self) -> Optional[str]:
        """获取子类型（如modify.edit_text -> edit_text）"""
        parts = self.resource_name.split('.')
        return parts[1] if len(parts) > 1 else None
    
    def __str__(self) -> str:
        """字符串表示"""
        return self.to_url()
    
    def __eq__(self, other) -> bool:
        """相等性比较"""
        if not isinstance(other, GlobalResourceUID):
            return False
        return self.uid == other.uid


@dataclass
class ResourceMetadata:
    """资源元数据（按照设计文档）"""
    uid: GlobalResourceUID
    owner: str = "system"  # 资源所有者
    description: str = ""   # 资源描述
    tags: List[str] = field(default_factory=list)  # 资源标签
    public: bool = False    # 是否公开可发现
    server_location: Optional[str] = None  # 资源实际位置
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    
    def update_timestamp(self):
        """更新时间戳"""
        self.updated_at = datetime.utcnow()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "uid": str(self.uid),
            "owner": self.owner,
            "description": self.description,  
            "tags": self.tags,
            "public": self.public,
            "server_location": self.server_location,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


@dataclass
class ExecutionContext:
    """执行上下文"""
    resource_id: str
    workspace_id: str = "default"
    user_context: Dict[str, Any] = field(default_factory=dict)
    execution_metadata: Dict[str, Any] = field(default_factory=dict)
    server_location: Optional[str] = None
    service_registry: Dict[str, str] = field(default_factory=dict)


@runtime_checkable
class IOConfigProtocol(Protocol):
    """I/O配置协议"""
    input_format: ContentType
    output_format: ContentType
    input_validation: List[str]
    input_preprocessing: List[str]
    output_postprocessing: List[str]
    output_metadata: List[str]
    shared_adapters: bool


@dataclass
class IOConfig:
    """I/O配置实现（实用主义设计）"""
    input_format: ContentType = ContentType.JSON
    output_format: ContentType = ContentType.JSON
    input_validation: List[str] = field(default_factory=list)
    input_preprocessing: List[str] = field(default_factory=list)
    output_postprocessing: List[str] = field(default_factory=list)
    output_metadata: List[str] = field(default_factory=list)
    shared_adapters: bool = True
    
    def __post_init__(self):
        # 运行时协议检查
        assert isinstance(self, IOConfigProtocol)


@runtime_checkable
class ResourceConfigProtocol(Protocol):
    """资源配置协议"""
    resource_id: str
    resource_uid: GlobalResourceUID
    resource_type: ResourceType
    io_config: IOConfigProtocol
    internal_config: Dict[str, Any]
    child_resources: Optional[List['ResourceConfigProtocol']]


@dataclass
class ResourceConfig:
    """资源配置实现"""
    resource_id: str
    resource_uid: GlobalResourceUID
    resource_type: ResourceType
    io_config: IOConfigProtocol
    internal_config: Dict[str, Any] = field(default_factory=dict)
    child_resources: Optional[List['ResourceConfigProtocol']] = None
    
    def __post_init__(self):
        # 运行时协议检查
        assert isinstance(self, ResourceConfigProtocol)


@runtime_checkable
class ContentAdapterProtocol(Protocol):
    """内容适配器协议（对称设计）- 现在作为Block适配器"""
    content_type: ContentType
    
    async def encode(self, data: Any) -> bytes:
        """编码数据（输出时使用）"""
        ...
    
    async def decode(self, raw_data: bytes) -> Any:
        """解码数据（输入时使用）"""
        ...
    
    async def validate(self, data: Any) -> bool:
        """验证数据格式"""
        ...
    
    async def normalize(self, data: Any) -> Any:
        """规范化数据"""
        ...


@runtime_checkable
class ExecutableResourceProtocol(Protocol):
    """可执行资源协议"""
    config: ResourceConfigProtocol
    context: ExecutionContext
    
    async def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行资源"""
        ...
    
    async def deploy(self) -> bool:
        """部署资源"""
        ...
    
    async def health_check(self) -> bool:
        """健康检查"""
        ...


@runtime_checkable
class BlockResourceProtocol(Protocol):
    """Block资源协议"""
    config: ResourceConfigProtocol
    context: ExecutionContext
    
    async def read(self) -> Dict[str, Any]:
        """读取Block内容"""
        ...
    
    async def write(self, data: Dict[str, Any]) -> bool:
        """写入Block内容"""
        ...
    
    async def validate(self) -> bool:
        """验证Block内容"""
        ...


class BaseContentAdapter(ABC):
    """基础内容适配器 - 现在作为Block适配器"""
    
    def __init__(self, content_type: ContentType):
        self.content_type = content_type
    
    @abstractmethod
    async def encode(self, data: Any) -> bytes:
        """编码数据（输出时使用）"""
        pass
    
    @abstractmethod
    async def decode(self, raw_data: bytes) -> Any:
        """解码数据（输入时使用）"""
        pass
    
    async def validate(self, data: Any) -> bool:
        """验证数据格式"""
        return data is not None
    
    async def normalize(self, data: Any) -> Any:
        """规范化数据"""
        return data


class JSONContentAdapter(BaseContentAdapter):
    """JSON内容适配器 - Block适配器实现"""
    
    def __init__(self):
        super().__init__(ContentType.JSON)
    
    async def encode(self, data: Any) -> bytes:
        """编码为JSON"""
        import json
        return json.dumps(data, ensure_ascii=False).encode('utf-8')
    
    async def decode(self, raw_data: bytes) -> Any:
        """从JSON解码"""
        import json
        return json.loads(raw_data.decode('utf-8'))


class TextContentAdapter(BaseContentAdapter):
    """TEXT内容适配器 - Block适配器实现"""
    
    def __init__(self):
        super().__init__(ContentType.TEXT)
    
    async def encode(self, data: Any) -> bytes:
        """编码为文本字节"""
        return str(data).encode('utf-8')
    
    async def decode(self, raw_data: bytes) -> Any:
        """解码文本字节"""
        return raw_data.decode('utf-8')
    
    async def normalize(self, data: Any) -> Any:
        """规范化文本数据 - 兼容既有Edge的text block"""
        if isinstance(data, (dict, list)):
            # 兼容structured类型转为text - 既有Edge会遇到此情况
            import json
            return json.dumps(data, ensure_ascii=False)
        return str(data)


class BinaryContentAdapter(BaseContentAdapter):
    """BINARY内容适配器 - Block适配器实现"""
    
    def __init__(self):
        super().__init__(ContentType.BINARY)
    
    async def encode(self, data: Any) -> bytes:
        """编码为二进制"""
        if isinstance(data, bytes):
            return data
        elif isinstance(data, str):
            return data.encode('utf-8')
        else:
            # 对复杂数据类型先JSON序列化再编码
            import json
            return json.dumps(data).encode('utf-8')
    
    async def decode(self, raw_data: bytes) -> Any:
        """解码二进制数据"""
        return raw_data
    
    async def validate(self, data: Any) -> bool:
        """验证二进制数据"""
        return isinstance(data, bytes) or data is not None


class BlockAdapterFactory:
    """Block适配器工厂（原ContentAdapterFactory）"""
    
    _adapters = {
        ContentType.JSON: JSONContentAdapter,
        ContentType.TEXT: TextContentAdapter,
        ContentType.BINARY: BinaryContentAdapter,
    }
    
    _shared_instances: Dict[ContentType, BaseContentAdapter] = {}
    
    @classmethod
    def create_adapter(cls, content_type: ContentType, shared: bool = True) -> BaseContentAdapter:
        """创建Block适配器"""
        if content_type not in cls._adapters:
            raise ValueError(f"Unsupported content type: {content_type}")
        
        if shared:
            if content_type not in cls._shared_instances:
                cls._shared_instances[content_type] = cls._adapters[content_type]()
            return cls._shared_instances[content_type]
        else:
            return cls._adapters[content_type]()
    
    @classmethod
    def get_block_adapter(cls, block_type: str) -> BaseContentAdapter:
        """根据既有Edge的block类型获取适配器（兼容性方法）"""
        # 兼容既有WorkFlow中的block类型
        if block_type == "text":
            return cls.create_adapter(ContentType.TEXT)
        elif block_type == "structured":
            return cls.create_adapter(ContentType.JSON)  # structured用JSON处理
        else:
            # 默认使用TEXT适配器
            return cls.create_adapter(ContentType.TEXT)


class ExecutableResource(ABC):
    """可执行资源基类 - Edge资源的基础实现"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        self.config = config
        self.context = context
        
        # 内化的I/O适配器（使用Block适配器）
        self.input_adapter = BlockAdapterFactory.create_adapter(
            config.io_config.input_format, 
            config.io_config.shared_adapters
        )
        self.output_adapter = BlockAdapterFactory.create_adapter(
            config.io_config.output_format,
            config.io_config.shared_adapters
        )
        
        # 子资源（仅业务逻辑）
        self.child_resources = {}
        
        # 初始化业务子资源
        self._initialize_business_children()
    
    def _initialize_business_children(self):
        """初始化业务子资源（子类重写）"""
        pass
    
    async def execute(self, raw_inputs: Dict[str, Any]) -> Dict[str, Any]:
        """统一执行接口（内化I/O处理）"""
        
        # 1. 输入适配（内化）
        processed_inputs = await self._process_inputs(raw_inputs)
        
        # 2. 输入验证
        if not await self._validate_inputs(processed_inputs):
            raise ValueError("Invalid inputs")
        
        # 3. 执行业务逻辑
        business_outputs = await self._execute_business_logic(processed_inputs)
        
        # 4. 输出适配（内化）
        formatted_outputs = await self._format_outputs(business_outputs)
        
        # 5. 添加元数据
        return await self._add_metadata(formatted_outputs)
    
    async def _process_inputs(self, raw_inputs: Dict[str, Any]) -> Dict[str, Any]:
        """处理输入数据 - 兼容既有Edge的block类型"""
        processed = {}
        input_adapter = BlockAdapterFactory.create_adapter(self.config.io_config.input_format)
        
        for key, value in raw_inputs.items():
            # **兼容既有Edge的数据处理**
            # 既有的WorkFlow会传递block的content直接作为value
            if isinstance(value, dict) and "content" in value:
                # 既有Edge格式：{"content": actual_data, ...}
                actual_data = value["content"]
            else:
                # 新格式或简单数据
                actual_data = value
            
            # 根据数据类型自动选择适配器（兼容既有Edge）
            if isinstance(actual_data, str):
                # 字符串数据使用TEXT适配器
                adapter = BlockAdapterFactory.create_adapter(ContentType.TEXT)
            elif isinstance(actual_data, (dict, list)):
                # 结构化数据使用JSON适配器
                adapter = BlockAdapterFactory.create_adapter(ContentType.JSON)
            else:
                # 其他类型使用配置的适配器
                adapter = input_adapter
            
            # 规范化处理
            processed[key] = await adapter.normalize(actual_data)
            
            # 应用预处理
            for preprocessing in self.config.io_config.input_preprocessing:
                processed[key] = await self._apply_preprocessing(processed, preprocessing)
        
        return processed
    
    async def _validate_inputs(self, inputs: Dict[str, Any]) -> bool:
        """验证输入"""
        for validation in self.config.io_config.input_validation:
            if not await self._apply_validation(inputs, validation):
                return False
        return True
    
    async def _format_outputs(self, outputs: Dict[str, Any]) -> Dict[str, Any]:
        """格式化输出数据 - 兼容既有Edge的block类型期望"""
        formatted = {}
        output_adapter = BlockAdapterFactory.create_adapter(self.config.io_config.output_format)
        
        for key, value in outputs.items():
            # 根据输出值类型自动选择适配器
            if isinstance(value, str):
                adapter = BlockAdapterFactory.create_adapter(ContentType.TEXT)
            elif isinstance(value, (dict, list)):
                adapter = BlockAdapterFactory.create_adapter(ContentType.JSON)
            else:
                adapter = output_adapter
            
            # 规范化处理
            formatted[key] = await adapter.normalize(value)
            
            # 应用后处理  
            for postprocessing in self.config.io_config.output_postprocessing:
                formatted[key] = await self._apply_postprocessing(formatted, postprocessing)
        
        return formatted
    
    async def _add_metadata(self, outputs: Dict[str, Any]) -> Dict[str, Any]:
        """添加执行元数据"""
        metadata = {
            "resource_uid": str(self.config.resource_uid),
            "resource_type": self.config.resource_type.value,
            "execution_context": {
                "resource_id": self.context.resource_id,
                "workspace_id": self.context.workspace_id
            },
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # 添加配置的元数据
        for metadata_key in self.config.io_config.output_metadata:
            if metadata_key in outputs:
                metadata[metadata_key] = outputs[metadata_key]
        
        outputs["_metadata"] = metadata
        return outputs
    
    async def _apply_preprocessing(self, data: Dict[str, Any], preprocessing: str) -> Dict[str, Any]:
        """应用预处理"""
        # 子类可以重写实现具体的预处理逻辑
        return data
    
    async def _apply_validation(self, data: Dict[str, Any], validation: str) -> bool:
        """应用验证"""
        # 子类可以重写实现具体的验证逻辑
        return True
    
    async def _apply_postprocessing(self, data: Dict[str, Any], postprocessing: str) -> Dict[str, Any]:
        """应用后处理"""
        # 子类可以重写实现具体的后处理逻辑
        return data
    
    @abstractmethod
    async def _execute_business_logic(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """执行业务逻辑（子类必须实现）"""
        pass
    
    async def deploy(self) -> bool:
        """部署资源"""
        return True
    
    async def health_check(self) -> bool:
        """健康检查"""
        return True


class BlockResource(ABC):
    """Block资源基类 - 数据存储和管理"""
    
    def __init__(self, config: ResourceConfigProtocol, context: ExecutionContext):
        self.config = config
        self.context = context
        
        # Block内容适配器
        self.content_adapter = BlockAdapterFactory.create_adapter(
            config.io_config.input_format,
            config.io_config.shared_adapters
        )
        
        # Block数据存储
        self._data: Dict[str, Any] = {}
        self._metadata: Dict[str, Any] = {}
    
    async def read(self) -> Dict[str, Any]:
        """读取Block内容"""
        return {
            "data": self._data,
            "metadata": self._metadata,
            "resource_uid": str(self.config.resource_uid)
        }
    
    async def write(self, data: Dict[str, Any]) -> bool:
        """写入Block内容"""
        try:
            # 验证数据
            if await self.content_adapter.validate(data):
                self._data = data
                self._metadata["last_updated"] = datetime.utcnow().isoformat()
                return True
            return False
        except Exception:
            return False
    
    async def validate(self) -> bool:
        """验证Block内容"""
        return await self.content_adapter.validate(self._data)
    
    @abstractmethod
    async def _execute_block_logic(self, operation: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行Block特定逻辑（子类实现）"""
        pass


# 向后兼容的别名
ContentAdapterFactory = BlockAdapterFactory 