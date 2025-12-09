"""
Project 数据模型

定义 project 表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ProjectBase(BaseModel):
    """项目基础模型"""
    name: str
    description: Optional[str] = None
    user_id: Optional[int] = None


class ProjectCreate(ProjectBase):
    """创建项目模型"""
    pass


class ProjectUpdate(BaseModel):
    """更新项目模型"""
    name: Optional[str] = None
    description: Optional[str] = None
    user_id: Optional[int] = None


class ProjectResponse(ProjectBase):
    """项目响应模型"""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
