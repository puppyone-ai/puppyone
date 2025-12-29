"""
Tool 数据模型

定义 public.tool 表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class ToolBase(BaseModel):
    """Tool 基础模型"""

    user_id: Optional[str] = None
    table_id: Optional[int] = None
    json_path: Optional[str] = None

    type: Optional[str] = None
    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None


class ToolCreate(ToolBase):
    """创建 Tool 模型"""

    pass


class ToolUpdate(BaseModel):
    """更新 Tool 模型"""

    table_id: Optional[int] = None
    json_path: Optional[str] = None

    type: Optional[str] = None
    name: Optional[str] = None
    alias: Optional[str] = None
    description: Optional[str] = None

    input_schema: Optional[Any] = None
    output_schema: Optional[Any] = None
    metadata: Optional[Any] = None


class ToolResponse(ToolBase):
    """Tool 响应模型"""

    id: int
    created_at: datetime

    class Config:
        from_attributes = True


