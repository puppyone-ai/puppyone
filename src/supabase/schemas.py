"""
Supabase 数据模型

定义数据库表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# User 相关模型
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


# Project 相关模型
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


# Table 相关模型
class TableBase(BaseModel):
    """表基础模型"""
    name: Optional[str] = None
    project_id: Optional[int] = None
    description: Optional[str] = None


class TableCreate(TableBase):
    """创建表模型"""
    pass


class TableUpdate(BaseModel):
    """更新表模型"""
    name: Optional[str] = None
    project_id: Optional[int] = None
    description: Optional[str] = None


class TableResponse(TableBase):
    """表响应模型"""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
