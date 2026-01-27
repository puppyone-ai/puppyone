from __future__ import annotations

from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field


ToolCategory = Literal["builtin", "custom"]


class Tool(BaseModel):
    id: str
    created_at: datetime

    user_id: str
    node_id: Optional[str] = None  # 绑定的 content_nodes 节点 ID
    json_path: str = ""  # JSON 内部路径（如 /users/0）

    type: str  # 工具类型：get_data_schema, query_data, create, update, delete, shell_access, custom_script 等
    name: str
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = Field(default=None, description="JSON Schema (input)")
    output_schema: Optional[Any] = Field(
        default=None, description="JSON Schema (output)"
    )
    metadata: Optional[Any] = Field(default=None, description="扩展配置（自定义工具的多节点绑定存这里）")

    # 新增字段
    category: ToolCategory = "builtin"  # 工具分类：builtin（内置）或 custom（自定义）
    script_type: Optional[str] = None  # 脚本类型：python, javascript, shell（仅 custom 类型使用）
    script_content: Optional[str] = None  # 脚本代码内容（仅 custom 类型使用）
