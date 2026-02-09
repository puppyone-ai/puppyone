"""DB Connector Models"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DBConnection(BaseModel):
    """外部数据库连接"""

    id: str = Field(..., description="连接 ID (UUID)")
    user_id: str = Field(..., description="所属用户 ID")
    project_id: str = Field(..., description="所属项目 ID")
    name: str = Field(..., description="连接名称")
    provider: str = Field("supabase", description="数据库类型: supabase | postgres | mysql")
    config: dict = Field(default_factory=dict, description="连接配置")
    is_active: bool = Field(True, description="是否有效")
    last_used_at: Optional[datetime] = None
    created_at: datetime = Field(...)
    updated_at: datetime = Field(...)

    class Config:
        from_attributes = True
