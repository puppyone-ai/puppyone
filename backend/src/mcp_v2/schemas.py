from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator


class McpV2Create(BaseModel):
    name: Optional[str] = Field(default=None, description="MCP v2 实例名称")


class McpV2Update(BaseModel):
    name: Optional[str] = None
    status: Optional[bool] = None


class McpV2Out(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime

    user_id: str
    name: Optional[str] = None
    api_key: str
    status: bool


class BindToolRequest(BaseModel):
    tool_id: int = Field(..., description="要绑定的 Tool ID")
    status: bool = Field(default=True, description="绑定是否启用")


class UpdateBindingRequest(BaseModel):
    status: bool = Field(..., description="绑定是否启用")


class BindToolsRequest(BaseModel):
    """
    绑定 Tool 到 MCP v2（批量）。
    """
    bindings: List[BindToolRequest] = Field(
        ...,
        min_length=1,
        description="批量绑定列表（至少 1 个）",
    )

    @field_validator("bindings")
    @classmethod
    def _validate_unique_tool_ids(cls, v: List[BindToolRequest]):
        tool_ids = [b.tool_id for b in v]
        if len(tool_ids) != len(set(tool_ids)):
            raise ValueError("bindings 中 tool_id 必须唯一")
        return v


class McpV2CreateWithBindings(BaseModel):
    name: Optional[str] = Field(default=None, description="MCP v2 实例名称")
    bindings: List[BindToolRequest] = Field(
        ...,
        min_length=1,
        description="创建时要绑定的 Tool 列表（至少 1 个）",
    )

    @field_validator("bindings")
    @classmethod
    def _validate_unique_tool_ids(cls, v: List[BindToolRequest]):
        tool_ids = [b.tool_id for b in v]
        if len(tool_ids) != len(set(tool_ids)):
            raise ValueError("bindings 中 tool_id 必须唯一")
        return v


class McpV2CreateWithBindingsOut(BaseModel):
    id: int
    api_key: str
    tool_ids: List[int]


class BoundToolOut(BaseModel):
    tool_id: int
    binding_id: int
    binding_status: bool

    created_at: datetime
    user_id: str

    name: str
    type: str
    table_id: Optional[int] = None
    json_path: str = ""

    alias: Optional[str] = None
    description: Optional[str] = None
    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None


