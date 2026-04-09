from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from src.infra.mcp_server.schemas import McpToolsDefinition, ToolTypeKey


class McpInstance(BaseModel):
    mcp_instance_id: str
    api_key: str
    created_by: Optional[str] = None  # nullable, was user_id
    project_id: str
    table_id: str
    name: Optional[str] = Field(default=None, description="MCP instance name")
    json_path: str = Field(
        default="",
        alias="json_pointer",
        description="JSON pointer path, represents the data path for this MCP instance, defaults to empty string for root path",
    )
    status: int = Field(default=..., description="MCP server status, 0 means disabled, 1 means enabled")
    port: Optional[int] = Field(
        default=None, deprecated=True, description="Port number, deprecated"
    )
    docker_info: Optional[Dict[Any, Any]] = Field(
        default=None, deprecated=True, description="Container or process info, deprecated"
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        default=None, description="(Optional) Dictionary of tool definitions"
    )
    register_tools: Optional[List[ToolTypeKey]] = Field(
        default=None, description="(Optional) List of registered tools, empty means register all"
    )
    preview_keys: Optional[List[str]] = Field(
        default=None,
        description="(Optional) Fields to filter for the preview_data tool, returns all fields when empty",
    )
