"""
Table 数据模型

定义 table 表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


class TableBase(BaseModel):
    """表基础模型"""

    name: Optional[str] = None
    project_id: Optional[int] = None
    user_id: Optional[str] = None  # 直接关联用户，支持裸 Table
    description: Optional[str] = None
    data: Optional[Any] = None  # 支持任意JSON类型（Dict, List, str, int等）


class TableCreate(TableBase):
    """创建表模型"""

    pass


class TableUpdate(BaseModel):
    """更新表模型"""

    name: Optional[str] = None
    project_id: Optional[int] = None
    description: Optional[str] = None
    data: Optional[Any] = None  # 支持任意JSON类型（Dict, List, str, int等）


class TableResponse(TableBase):
    """表响应模型"""

    id: int
    created_at: datetime

    class Config:
        from_attributes = True
