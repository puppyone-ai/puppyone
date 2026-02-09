from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field

from src.mcp.schemas import ToolTypeKey


ToolCategory = Literal["builtin", "custom"]


class ToolCreate(BaseModel):
    node_id: Optional[str] = Field(
        default=None,
        description="绑定的 content_nodes 节点 ID（内置工具必填，自定义多节点工具可为空）"
    )
    json_path: str = Field(
        default="",
        description="JSON Pointer 路径（挂载点，RFC6901）。空字符串表示根路径。",
        examples=["", "/articles", "/0/content"],
    )
    type: ToolTypeKey = Field(
        ...,
        description="Tool 类型（注意：shell_access 已移至 agent_bash 表管理）",
        examples=["search", "create", "query_data", "custom_script"],
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
            "- 自定义多节点工具的绑定信息存这里：bound_nodes: [{node_id, role, alias}]\n"
            "- 注意：Search Tool 的索引构建状态不再写入 tool.metadata，改由独立索引任务状态表维护。\n"
        ),
        examples=[{"preview_keys": ["id", "title"]}, {"bound_nodes": [{"node_id": "xxx", "role": "source"}]}],
    )

    # 新增字段
    category: ToolCategory = Field(
        default="builtin",
        description="工具分类：builtin（内置）或 custom（自定义脚本）"
    )
    script_type: Optional[str] = Field(
        default=None,
        description="脚本类型（仅 custom 类型使用）：python, javascript, shell"
    )
    script_content: Optional[str] = Field(
        default=None,
        description="脚本代码内容（仅 custom 类型使用）"
    )


class ToolUpdate(BaseModel):
    node_id: Optional[str] = None
    json_path: Optional[str] = None
    type: Optional[ToolTypeKey] = None

    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # 新增字段
    category: Optional[ToolCategory] = None
    script_type: Optional[str] = None
    script_content: Optional[str] = None


class ToolOut(BaseModel):
    id: str
    created_at: datetime

    user_id: str
    project_id: Optional[str] = None  # 所属项目 ID
    node_id: Optional[str] = None
    json_path: str = ""

    type: ToolTypeKey
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None

    # 新增字段
    category: ToolCategory = "builtin"
    script_type: Optional[str] = None
    script_content: Optional[str] = None
