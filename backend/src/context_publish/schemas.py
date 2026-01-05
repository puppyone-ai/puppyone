from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PublishCreate(BaseModel):
    table_id: int = Field(..., description="目标 table_id")
    json_path: str = Field(default="", description="JSON Pointer 路径")
    expires_at: Optional[datetime] = Field(
        default=None, description="可选过期时间；不传则默认 7 天"
    )


class PublishUpdate(BaseModel):
    status: Optional[bool] = Field(default=None, description="启用/禁用（revoke）")
    expires_at: Optional[datetime] = Field(default=None, description="更新过期时间")


class PublishOut(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    user_id: str
    table_id: int
    json_path: str
    publish_key: str
    status: bool
    expires_at: datetime
    url: str
