from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional, Literal

class McpToolsDefinition(BaseModel):
    """
    工具定义模型
    用于自定义工具的名称和描述模板
    """
    tool_name: str = Field(..., description="工具名称，例如：'get_context', 'create_element' 等")
    tool_desc_template: str = Field(..., description="工具描述模板，支持使用 {key} 格式的占位符，例如：'获取知识库内容。项目：{project_name}'")
    tool_desc_parameters: List[Dict[str, Any]] = Field(
        ...,
        description="填充模板的参数列表，每个元素是一个字典，包含模板中占位符对应的值。例如：[{\"project_name\": \"测试项目\"}, {\"context_name\": \"AI技术知识库\"}]",
        examples=[
            [
                {"project_name": "测试项目"},
                {"context_name": "AI技术知识库"}
            ]
        ]
    )

# 工具类型定义
ToolTypeKey = Literal["get", "create", "update", "delete"]

class McpCreate(BaseModel):
    """
    创建 MCP 实例请求模型
    """
    user_id: str = Field(..., description="用户ID")
    project_id: str = Field(..., description="项目ID, 暂时可以随便传")
    context_id: str = Field(..., description="ContextID, 对应前端“Table”的概念, 表示一整个JSON对象.")
    json_pointer: str = Field(
        default="",
        description="JSON路径, 对应用户选中的某个JSON节点. 表示该MCP实例的数据可见范围. 默认: 空字符串, 表示根路径, 会展示所有数据."
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        ...,
        description="🔧工具定义配置, 支持用户自定义工具名字,工具描述模板,工具描述参数. ⚠️重要: 目前仅支持'get', 'create', 'update', 'delete'这四个key. 如果不提供, 将沿用默认的工具配置.",
        examples=[
            {
                "get": {
                    "tool_name": "get_context",
                    "tool_desc_template": "获取知识库内容。项目：{project_name}，知识库：{context_name}",
                    "tool_desc_parameters": [
                        {"project_name": "测试项目"},
                        {"context_name": "AI技术知识库"}
                    ]
                },
                "create": {
                    "tool_name": "create_element",
                    "tool_desc_template": "创建新元素到知识库：{context_name}",
                    "tool_desc_parameters": [
                        {"context_name": "AI技术知识库"}
                    ]
                }
            }
        ]
    )
    register_tools: List[ToolTypeKey] = Field(
        default=["get", "create", "update", "delete"],
        description="🔧工具注册列表. 默认注册所有工具: ['get', 'create', 'update', 'delete']. 可以只选择部分工具进行注册。",
        examples=[["get", "create"], ["get", "update", "delete"]]
    )
    
    @field_validator('tools_definition')
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """验证 tools_definition 的 key 只能是 get/create/update/delete"""
        if v is not None:
            valid_keys = {"get", "create", "update", "delete"}
            for key in v.keys():
                if key not in valid_keys:
                    raise ValueError(f"Invalid tool type key: {key}. Must be one of {valid_keys}")
        return v
    
    @field_validator('register_tools')
    @classmethod
    def validate_register_tools(cls, v):
        """验证 register_tools 的值只能是 get/create/update/delete"""
        if v is not None:
            valid_keys = {"get", "create", "update", "delete"}
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}")
        return v

class McpUpdate(BaseModel):
    """
    更新 MCP 实例请求模型
    """
    status: Optional[int] = Field(None, description="实例状态，0表示关闭，1表示开启")
    json_pointer: Optional[str] = Field(None, description="JSON指针路径，表示该MCP实例对应的数据路径")
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        ...,
        description="🔧工具定义配置, 支持用户自定义工具名字,工具描述模板,工具描述参数. ⚠️重要: 目前仅支持'get', 'create', 'update', 'delete'这四个key. 如果不提供, 将沿用默认的工具配置.",
        examples=[
            {
                "get": {
                    "tool_name": "get_context",
                    "tool_desc_template": "获取知识库内容。项目：{project_name}，知识库：{context_name}",
                    "tool_desc_parameters": [
                        {"project_name": "测试项目"},
                        {"context_name": "AI技术知识库"}
                    ]
                },
                "create": {
                    "tool_name": "create_element",
                    "tool_desc_template": "创建新元素到知识库：{context_name}",
                    "tool_desc_parameters": [
                        {"context_name": "AI技术知识库"}
                    ]
                }
            }
        ]
    )
    register_tools: List[ToolTypeKey] = Field(
        default=["get", "create", "update", "delete"],
        description="🔧工具注册列表. 默认注册所有工具: ['get', 'create', 'update', 'delete']. 可以只选择部分工具进行注册。",
        examples=[["get", "create"], ["get", "update", "delete"]]
    ) 
    @field_validator('tools_definition')
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """验证 tools_definition 的 key 只能是 get/create/update/delete"""
        if v is not None:
            valid_keys = {"get", "create", "update", "delete"}
            for key in v.keys():
                if key not in valid_keys:
                    raise ValueError(f"Invalid tool type key: {key}. Must be one of {valid_keys}")
        return v
    
    @field_validator('register_tools')
    @classmethod
    def validate_register_tools(cls, v):
        """验证 register_tools 的值只能是 get/create/update/delete"""
        if v is not None:
            valid_keys = {"get", "create", "update", "delete"}
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}")
        return v

class McpTokenPayload(BaseModel):
    user_id: str
    project_id: str
    context_id: str
    json_pointer: str = ""

class McpStatusResponse(BaseModel):
    status: int = Field(..., description="实例状态，0表示关闭，1表示开启")
    port: int = Field(..., description="端口信息")
    docker_info: Dict[Any, Any] = Field(..., description="MCP实例运行信息, 目前主要是进程信息")
    json_pointer: str = Field(..., description="JSONPath")
    tools_definition: Dict[ToolTypeKey, McpToolsDefinition] = Field(..., description="工具定义")
    register_tools: List[ToolTypeKey] = Field(..., description="已注册的工具列表")
