from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field

ToolTypeKey = Literal[
    "get_data_schema",
    "get_all_data",
    "query_data",
    "search",
    "create",
    "update",
    "delete",
    "preview",
    "select",
]


ToolCategory = Literal["builtin", "custom"]


class ToolCreate(BaseModel):
    path: Optional[str] = Field(
        default=None,
        description="MUT path (required for built-in tools, optional for custom multi-node tools)"
    )
    json_path: str = Field(
        default="",
        description="JSON Pointer path (mount point, RFC6901). Empty string means root path.",
        examples=["", "/articles", "/0/content"],
    )
    type: ToolTypeKey = Field(
        ...,
        description="Tool type (note: shell_access has been moved to the agent_bash table)",
        examples=["search", "create", "query_data", "custom_script"],
    )

    name: str = Field(..., description="Unique tool invocation name (should be unique within the same MCP)")
    alias: Optional[str] = Field(default=None, description="Display name for frontend (can be duplicated)")
    description: Optional[str] = Field(default=None, description="Tool description")

    input_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (input), empty for non-custom Tools"
    )
    output_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (output), empty for non-custom Tools"
    )
    metadata: Optional[Any] = Field(
        default=None,
        description=(
            "Extension config (by tool.type convention).\n\n"
            "- Binding info for custom multi-node tools is stored here: bound_nodes: [{path, role, alias}]\n"
            "- Note: Search Tool index build status is no longer written to tool.metadata; it is maintained by a separate index task status table.\n"
        ),
        examples=[{"preview_keys": ["id", "title"]}, {"bound_nodes": [{"path": "xxx", "role": "source"}]}],
    )

    # Additional fields
    category: ToolCategory = Field(
        default="builtin",
        description="Tool category: builtin or custom (custom script)"
    )
    script_type: Optional[str] = Field(
        default=None,
        description="Script type (only for custom category): python, javascript, shell"
    )
    script_content: Optional[str] = Field(
        default=None,
        description="Script code content (only for custom category)"
    )


class ToolUpdate(BaseModel):
    path: Optional[str] = None
    json_path: Optional[str] = None
    type: Optional[ToolTypeKey] = None

    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # Additional fields
    category: Optional[ToolCategory] = None
    script_type: Optional[str] = None
    script_content: Optional[str] = None


class ToolOut(BaseModel):
    id: str
    created_at: datetime

    created_by: Optional[str] = None
    org_id: str
    project_id: Optional[str] = None  # Associated project ID
    path: Optional[str] = None
    json_path: str = ""

    type: ToolTypeKey
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # Additional fields
    category: ToolCategory = "builtin"
    script_type: Optional[str] = None
    script_content: Optional[str] = None
