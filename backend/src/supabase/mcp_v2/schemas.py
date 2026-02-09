"""
MCP v2 数据模型

定义 public.mcp 表对应的 Pydantic 模型。
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class McpV2Base(BaseModel):
    user_id: Optional[str] = None
    name: Optional[str] = None
    api_key: Optional[str] = None
    status: Optional[bool] = None


class McpV2Create(McpV2Base):
    pass


class McpV2Update(BaseModel):
    name: Optional[str] = None
    api_key: Optional[str] = None
    status: Optional[bool] = None


class McpV2Response(McpV2Base):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
