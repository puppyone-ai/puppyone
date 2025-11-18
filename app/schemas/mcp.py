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
    user_id: int = Field(..., description="用户ID")
    project_id: int = Field(..., description="项目ID")
    context_id: int = Field(..., description="上下文ID")
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        None,
        description="工具定义字典（可选）。\n\n**重要：字典的 key 必须是以下值之一：'get', 'create', 'update', 'delete'**\n\n每个 key 对应一个工具定义，用于自定义该工具的名称和描述模板。如果不提供，将使用默认的工具定义。",
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

class McpUpdate(BaseModel):
    """
    更新 MCP 实例请求模型
    """
    status: int = Field(..., description="实例状态，0表示关闭，1表示开启")
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        None,
        description="工具定义字典（可选）。\n\n**重要：字典的 key 必须是以下值之一：'get', 'create', 'update', 'delete'**\n\n每个 key 对应一个工具定义，用于自定义该工具的名称和描述模板。如果不提供，将保持原有的工具定义不变。",
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

class McpTokenPayload(BaseModel):
    user_id: str
    project_id: str
    context_id: str

class McpStatusResponse(BaseModel):
    status: int # 0表示关闭，1表示开启
    port: Optional[int] = None
    docker_info: Optional[Dict[Any, Any]] = None # 容器信息
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = None # 工具定义字典（可选），key只能是get/create/update/delete
