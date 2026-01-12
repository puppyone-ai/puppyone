from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from src.mcp.schemas import ToolTypeKey


class ToolCreate(BaseModel):
    table_id: int = Field(..., description="Table ID（Context 所属知识库）")
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
            "- 对 `type=search`：服务端会写入/更新 `metadata.search_index`，用于标记索引构建状态与统计信息。\n"
            "  常见字段：\n"
            "  - configured_at: 创建时写入\n"
            "  - status: pending/indexing/ready/error\n"
            "  - indexed_at/nodes_count/chunks_count/indexed_chunks_count\n"
            "  - last_error: 失败原因（截断）\n"
        ),
        examples=[
            {
                "search_index": {
                    "configured_at": "2026-01-12T12:00:00+00:00",
                    "status": "pending",
                }
            }
        ],
    )


class ToolUpdate(BaseModel):
    table_id: Optional[int] = None
    json_path: Optional[str] = None
    type: Optional[ToolTypeKey] = None

    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None


class ToolOut(BaseModel):
    id: int
    created_at: datetime

    user_id: str
    table_id: Optional[int] = None
    json_path: str = ""

    type: ToolTypeKey
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None
