"""
User 数据模型

定义 user_temp 表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class UserBase(BaseModel):
    """用户基础模型"""
    name: Optional[str] = None


class UserCreate(UserBase):
    """创建用户模型"""
    pass


class UserUpdate(UserBase):
    """更新用户模型"""
    name: Optional[str] = None


class UserResponse(UserBase):
    """用户响应模型"""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
