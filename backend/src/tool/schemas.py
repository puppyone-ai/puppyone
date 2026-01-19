from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.mcp.schemas import ToolTypeKey


class ToolCreate(BaseModel):
    table_id: str = Field(..., description="Table ID（Context 所属知识库，UUID）")
    json_path: str = Field(
        default="",
        description="JSON Pointer 路径（挂载点，RFC6901）。空字符串表示根路径。",
        examples=["", "/articles", "/0/content"],
    )
    type: ToolTypeKey = Field(
        ...,
        description="Tool 类型",
        examples=["search", "create", "query_data"],
    )

    name: str = Field(..., description="工具唯一调用名（建议在同一 MCP 内唯一）")
    alias: Optional[str] = Field(default=None, description="前端展示名（可重复）")
    description: Optional[str] = Field(default=None, description="工具描述")

    input_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (input), 非自定义Tool则为空"
    )
    output_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (output), 非自定义Tool则为空"
    )
    metadata: Optional[Any] = Field(
        default=None,
        description=(
            "扩展配置（按 tool.type 约定）。\n\n"
            "- 注意：Search Tool 的索引构建状态不再写入 tool.metadata，改由独立索引任务状态表维护。\n"
        ),
        examples=[{"preview_keys": ["id", "title"]}],
    )


class ToolUpdate(BaseModel):
    table_id: Optional[str] = None
    json_path: Optional[str] = None
    type: Optional[ToolTypeKey] = None

    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None


class ToolOut(BaseModel):
    id: str
    created_at: datetime

    user_id: str
    table_id: Optional[str] = None
    json_path: str = ""

    type: ToolTypeKey
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None
