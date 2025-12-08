from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional, Literal


class McpToolsDefinition(BaseModel):
    """
    工具定义模型
    用于自定义工具的名称和描述模板
    """

    tool_name: str = Field(
        ..., description="工具名称，例如：'query_table', 'create_element' 等"
    )
    tool_desc_template: str = Field(
        ...,
        description="工具描述模板，支持使用 {key} 格式的占位符，例如：'获取知识库内容。项目：{project_name}'",
    )
    tool_desc_parameters: List[Dict[str, Any]] = Field(
        ...,
        description='填充模板的参数列表，每个元素是一个字典，包含模板中占位符对应的值。例如：[{"project_name": "测试项目"}, {"table_name": "AI技术知识库"}]',
        examples=[[{"project_name": "测试项目"}, {"table_name": "AI技术知识库"}]],
    )


# 工具类型定义（注意：get已改为query，preview和select为新增工具）
ToolTypeKey = Literal["get", "query", "create", "update", "delete", "preview", "select"]


class McpCreate(BaseModel):
    """
    创建 MCP 实例请求模型
    """

    user_id: int = Field(..., description="用户ID")
    project_id: int = Field(..., description="项目ID, 暂时可以随便传")
    table_id: int = Field(
        ..., description="TableID, 对应前端“Table”的概念, 表示一整个JSON对象."
    )
    json_pointer: str = Field(
        default="",
        description="JSON路径, 对应用户选中的某个JSON节点. 表示该MCP实例的数据可见范围. 默认: 空字符串, 表示根路径, 会展示所有数据.",
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        ...,
        description="🔧工具定义配置, 支持用户自定义工具名字,工具描述模板,工具描述参数. 支持的key包括: query, create, update, delete, preview, select. 如果不提供, 将沿用默认的工具配置.",
        examples=[
            {
                "create": {
                    "tool_name": "create_element",
                    "tool_desc_template": "创建新元素到知识库：{context_name}",
                    "tool_desc_parameters": [{"context_name": "AI技术知识库"}],
                }
            }
        ],
    )
    register_tools: List[ToolTypeKey] = Field(
        default=["query", "create", "update", "delete"],
        description="🔧工具注册列表. 默认注册基础工具: ['query', 'create', 'update', 'delete']. 可以只选择部分工具进行注册。注意：'get'已改为'query'（仍兼容'get'）；'preview'和'select'工具只有在设置了preview_keys时才会自动注册。",
        examples=[["query", "create"], ["query", "update", "delete"]],
    )
    preview_keys: Optional[List[str]] = Field(
        default=None,
        description="🔍预览字段列表（可选）。当设置了此字段后，会额外注册preview_data和select_tables两个工具。preview_data工具会只返回指定字段的轻量级数据，select_tables工具可以根据字段值批量获取完整数据。为空时preview_data返回所有字段。",
        examples=[["id", "name", "title"], ["user_id", "username"]],
    )

    @field_validator("tools_definition")
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """验证 tools_definition 的 key 只能是 get/query/create/update/delete/preview/select"""
        if v is not None:
            valid_keys = {
                "get",
                "query",
                "create",
                "update",
                "delete",
                "preview",
                "select",
            }
            for key in v.keys():
                if key not in valid_keys:
                    raise ValueError(
                        f"Invalid tool type key: {key}. Must be one of {valid_keys}"
                    )
        return v

    @field_validator("register_tools")
    @classmethod
    def validate_register_tools(cls, v):
        """验证 register_tools 的值只能是 get/query/create/update/delete/preview/select"""
        if v is not None:
            valid_keys = {
                "get",
                "query",
                "create",
                "update",
                "delete",
                "preview",
                "select",
            }
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(
                    f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}"
                )
        return v


class McpUpdate(BaseModel):
    """
    更新 MCP 实例请求模型
    """

    status: Optional[int] = Field(None, description="实例状态，0表示关闭，1表示开启")
    json_pointer: Optional[str] = Field(
        None, description="JSON指针路径，表示该MCP实例对应的数据路径"
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        ...,
        description="🔧工具定义配置, 支持用户自定义工具名字,工具描述模板,工具描述参数. ⚠️重要: 目前仅支持'get', 'create', 'update', 'delete'这四个key. 如果不提供, 将沿用默认的工具配置.",
        examples=[
            {
                "get": {
                    "tool_name": "query_table",
                    "tool_desc_template": "获取知识库内容。项目：{project_name}，知识库：{table_name}",
                    "tool_desc_parameters": [
                        {"project_name": "测试项目"},
                        {"table_name": "AI技术知识库"},
                    ],
                },
                "create": {
                    "tool_name": "create_element",
                    "tool_desc_template": "创建新元素到知识库：{table_name}",
                    "tool_desc_parameters": [{"table_name": "AI技术知识库"}],
                },
            }
        ],
    )
    register_tools: List[ToolTypeKey] = Field(
        default=["query", "create", "update", "delete"],
        description="🔧工具注册列表. 默认注册基础工具: ['query', 'create', 'update', 'delete']. 可以只选择部分工具进行注册。注意：'get'已改为'query'（仍兼容'get'）；'preview'和'select'工具只有在设置了preview_keys时才会自动注册。",
        examples=[["query", "create"], ["query", "update", "delete"]],
    )
    preview_keys: Optional[List[str]] = Field(
        default=None,
        description="🔍预览字段列表（可选）。当设置了此字段后，会额外注册preview_data和select_tables两个工具。preview_data工具会只返回指定字段的轻量级数据，select_tables工具可以根据字段值批量获取完整数据。为空时preview_data返回所有字段。",
        examples=[["id", "name", "title"], ["user_id", "username"]],
    )

    @field_validator("tools_definition")
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """验证 tools_definition 的 key 只能是 get/query/create/update/delete/preview/select"""
        if v is not None:
            valid_keys = {
                "get",
                "query",
                "create",
                "update",
                "delete",
                "preview",
                "select",
            }
            for key in v.keys():
                if key not in valid_keys:
                    raise ValueError(
                        f"Invalid tool type key: {key}. Must be one of {valid_keys}"
                    )
        return v

    @field_validator("register_tools")
    @classmethod
    def validate_register_tools(cls, v):
        """验证 register_tools 的值只能是 get/query/create/update/delete/preview/select"""
        if v is not None:
            valid_keys = {
                "get",
                "query",
                "create",
                "update",
                "delete",
                "preview",
                "select",
            }
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(
                    f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}"
                )
        return v


class McpTokenPayload(BaseModel):
    user_id: int
    project_id: int
    table_id: int
    json_pointer: str = ""


class McpStatusResponse(BaseModel):
    status: int = Field(..., description="实例状态，0表示关闭，1表示开启")
    port: int = Field(..., description="端口信息")
    docker_info: Dict[Any, Any] = Field(
        ..., description="MCP实例运行信息, 目前主要是进程信息"
    )
    json_pointer: str = Field(..., description="JSONPath")
    tools_definition: Dict[ToolTypeKey, McpToolsDefinition] = Field(
        ..., description="工具定义"
    )
    register_tools: List[ToolTypeKey] = Field(..., description="已注册的工具列表")
    preview_keys: Optional[List[str]] = Field(None, description="预览字段列表")
