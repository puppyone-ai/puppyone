from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional, Literal


class McpToolsDefinition(BaseModel):
    """
    Tool definition model
    Used to customize tool name and description template
    """

    name: str = Field(..., description="Tool name")
    description: str = Field(
        ...,
        description="Tool description",
    )


# Tool type definitions (note: get has been renamed to query, preview and select are new tools)
# NOTE: shell_access and shell_access_readonly have been moved to the agent_bash table, no longer a Tool type
ToolTypeKey = Literal[
    "get_data_schema",
    "get_all_data",
    "query_data",
    "create",
    "update",
    "delete",
    "preview",
    "select",
    "search",
    "custom_script",  # User-defined script tool
]


class McpCreate(BaseModel):
    """
    Create MCP instance request model
    """

    name: str = Field(..., description="MCP instance name (required)")
    project_id: str = Field(..., description="Project ID (UUID)")
    table_id: str = Field(
        ..., description="Table ID (UUID), corresponds to the frontend 'Table' concept, represents an entire JSON object."
    )
    json_pointer: str = Field(
        default="",
        description="JSON path, corresponds to a JSON node selected by the user. Represents the data visibility scope of this MCP instance. Default: empty string, meaning root path, shows all data.",
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        ...,
        description="Tool definition configuration, supports custom tool names, description templates, and description parameters. Supported keys include: get_data_schema, get_all_data, query_data, create, update, delete, preview, select. If not provided, default tool configuration will be used.",
        examples=[
            {
                "create": {
                    "name": "create_element",
                    "description": "Create a new element in the knowledge base",
                }
            }
        ],
    )
    register_tools: List[ToolTypeKey] = Field(
        default=[
            "get_data_schema",
            "create",
            "update",
            "delete",
            "get_all_data",
            "query_data",
        ],
        description="Tool registration list. Default registered tools: ['get_data_schema', 'create', 'update', 'delete', 'get_all_data', 'query_data']. You can register only a subset of tools. If preview_keys is set, preview_data and select_data tools will be automatically registered.",
        examples=[
            ["get_data_schema", "create"],
            ["get_data_schema", "update", "delete"],
        ],
    )
    preview_keys: Optional[List[str]] = Field(
        default=None,
        description="Preview field list (optional). When set, preview_data and select_data tools will be additionally registered. The preview_data tool returns only lightweight data for specified fields, the select_tables tool can batch-fetch full data by field values. When empty, preview_data returns all fields.",
        examples=[["id", "name", "title"], ["user_id", "username"]],
    )

    @field_validator("tools_definition")
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """Validate that tools_definition keys are valid Tool types"""
        if v is not None:
            valid_keys = {
                "get_data_schema",
                "get_all_data",
                "query_data",
                "create",
                "update",
                "delete",
                "preview",
                "select",
                "search",
                "custom_script",
            }
            for key in v:
                if key not in valid_keys:
                    raise ValueError(
                        f"Invalid tool type key: {key}. Must be one of {valid_keys}"
                    )
        return v

    @field_validator("register_tools")
    @classmethod
    def validate_register_tools(cls, v):
        """Validate that register_tools values are valid Tool types"""
        if v is not None:
            valid_keys = {
                "get_data_schema",
                "get_all_data",
                "query_data",
                "create",
                "update",
                "delete",
                "preview",
                "select",
                "search",
                "custom_script",
            }
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(
                    f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}"
                )
        return v


class McpUpdate(BaseModel):
    """
    Update MCP instance request model
    """

    name: Optional[str] = Field(None, description="MCP instance name (optional)")
    status: Optional[int] = Field(None, description="Instance status, 0 means disabled, 1 means enabled")
    json_pointer: Optional[str] = Field(
        None, description="JSON pointer path, represents the data path for this MCP instance"
    )
    tools_definition: Optional[Dict[ToolTypeKey, McpToolsDefinition]] = Field(
        None,
        description="Tool definition configuration, supports custom tool names, description templates, and description parameters. Important: currently only supports 'get', 'create', 'update', 'delete' keys. If not provided, default tool configuration will be used.",
        examples=[
            {
                "get": {
                    "tool_name": "query_table",
                    "tool_desc_template": "Get knowledge base content. Project: {project_name}, Knowledge base: {table_name}",
                    "tool_desc_parameters": [
                        {"project_name": "Test Project"},
                        {"table_name": "AI Tech Knowledge Base"},
                    ],
                },
                "create": {
                    "tool_name": "create_element",
                    "tool_desc_template": "Create new element in knowledge base: {table_name}",
                    "tool_desc_parameters": [{"table_name": "AI Tech Knowledge Base"}],
                },
            }
        ],
    )
    register_tools: Optional[List[ToolTypeKey]] = Field(
        None,
        description="Tool registration list. Default registered tools: ['query', 'create', 'update', 'delete']. You can register only a subset of tools. Note: 'get' has been renamed to 'query' (still compatible with 'get'); 'preview' and 'select' tools are only auto-registered when preview_keys is set.",
        examples=[["query", "create"], ["query", "update", "delete"]],
    )
    preview_keys: Optional[List[str]] = Field(
        None,
        description="Preview field list (optional). When set, preview_data and select_tables tools will be additionally registered. The preview_data tool returns only lightweight data for specified fields, the select_tables tool can batch-fetch full data by field values. When empty, preview_data returns all fields.",
        examples=[["id", "name", "title"], ["user_id", "username"]],
    )

    @field_validator("tools_definition")
    @classmethod
    def validate_tools_definition_keys(cls, v):
        """Validate that tools_definition keys are valid Tool types"""
        if v is not None:
            valid_keys = {
                "get_data_schema",
                "get_all_data",
                "query_data",
                "create",
                "update",
                "delete",
                "preview",
                "select",
                "search",
                "custom_script",
            }
            for key in v:
                if key not in valid_keys:
                    raise ValueError(
                        f"Invalid tool type key: {key}. Must be one of {valid_keys}"
                    )
        return v

    @field_validator("register_tools")
    @classmethod
    def validate_register_tools(cls, v):
        """Validate that register_tools values are valid Tool types"""
        if v is not None:
            valid_keys = {
                "get_data_schema",
                "get_all_data",
                "query_data",
                "create",
                "update",
                "delete",
                "preview",
                "select",
                "search",
                "custom_script",
            }
            invalid_keys = set(v) - valid_keys
            if invalid_keys:
                raise ValueError(
                    f"Invalid tool type keys in register_tools: {invalid_keys}. Must be one of {valid_keys}"
                )
        return v


class McpTokenPayload(BaseModel):
    user_id: str
    project_id: str
    table_id: str
    json_pointer: str = ""


class McpStatusResponse(BaseModel):
    name: Optional[str] = Field(None, description="MCP instance name")
    status: int = Field(..., description="Instance status, 0 means disabled, 1 means enabled")
    port: int = Field(..., description="Port information")
    docker_info: Dict[Any, Any] = Field(
        ..., description="MCP instance runtime info, currently mainly process info"
    )
    json_pointer: str = Field(..., description="JSONPath")
    tools_definition: Dict[ToolTypeKey, McpToolsDefinition] = Field(
        ..., description="Tool definitions"
    )
    register_tools: List[ToolTypeKey] = Field(..., description="List of registered tools")
    preview_keys: Optional[List[str]] = Field(None, description="Preview field list")
