"""
MCP Binding 数据模型

定义 public.mcp_binding 表对应的 Pydantic 模型。
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class McpBindingBase(BaseModel):
    mcp_id: Optional[int] = None
    tool_id: Optional[int] = None
    status: Optional[bool] = None


class McpBindingCreate(McpBindingBase):
    pass


class McpBindingUpdate(BaseModel):
    status: Optional[bool] = None


class McpBindingResponse(McpBindingBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


