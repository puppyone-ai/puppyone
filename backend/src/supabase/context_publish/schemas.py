"""
Context Publish 数据模型

定义 public.context_publish 表对应的 Pydantic 模型。
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ContextPublishBase(BaseModel):
    user_id: Optional[str] = None
    table_id: Optional[int] = None
    json_path: Optional[str] = None
    publish_key: Optional[str] = None
    status: Optional[bool] = None
    expires_at: Optional[datetime] = None


class ContextPublishCreate(ContextPublishBase):
    pass


class ContextPublishUpdate(BaseModel):
    status: Optional[bool] = None
    expires_at: Optional[datetime] = None


class ContextPublishResponse(ContextPublishBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


