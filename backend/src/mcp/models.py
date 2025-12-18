from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from src.mcp.schemas import McpToolsDefinition, ToolTypeKey


class McpInstance(BaseModel):
    mcp_instance_id: str
    api_key: str
    user_id: str
    project_id: int
    table_id: int
    name: Optional[str] = Field(
        default=None,
        description="MCP实例名称"
    )
    json_pointer: str = Field(
        default="",
        alias="json_path",
        description="JSON指针路径，表示该MCP实例对应的数据路径，默认为空字符串表示根路径"
    )
    status: int = Field(
        default=...,
        description="MCP server状态，0表示关闭，1表示开启"
    )
    port: Optional[int] = Field(
        default=None,
        deprecated=True,
        description="端口号，已废弃"
    )
    docker_info: Optional[Dict[Any, Any]] = Field(
        default=None,
        deprecated=True,
        description="容器信息或进程信息，已废弃"
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        default=None,
        description="(可选) 工具定义的字典"
    )
    register_tools: Optional[List[ToolTypeKey]] = Field(
        default=None,
        description="(可选) 已注册的工具列表，为空表示都注册"
    )
    preview_keys: Optional[List[str]] = Field(
        default=None,
        description="(可选) 用于preview_data工具过滤字段, 为空时返回所有字段"
    )
