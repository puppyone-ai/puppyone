"""
Supabase 数据模型

定义数据库表对应的 Pydantic 模型，用于类型检查和数据验证。
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel


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
    user_id: Optional[str] = None  # UUID 字符串格式


class ProjectCreate(ProjectBase):
    """创建项目模型"""
    pass


class ProjectUpdate(BaseModel):
    """更新项目模型"""
    name: Optional[str] = None
    description: Optional[str] = None
    user_id: Optional[str] = None  # UUID 字符串格式


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


# MCP 相关模型
class McpBase(BaseModel):
    """MCP 基础模型"""
    api_key: Optional[str] = None
    user_id: Optional[str] = None  # UUID 字符串格式
    project_id: Optional[int] = None
    table_id: Optional[int] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpCreate(McpBase):
    """创建 MCP 实例模型"""
    pass


class McpUpdate(BaseModel):
    """更新 MCP 实例模型"""
    api_key: Optional[str] = None
    user_id: Optional[str] = None  # UUID 字符串格式
    project_id: Optional[int] = None
    table_id: Optional[int] = None
    json_path: Optional[str] = None
    status: Optional[bool] = None
    port: Optional[int] = None
    docker_info: Optional[Dict[str, Any]] = None
    tools_definition: Optional[Dict[str, Any]] = None
    register_tools: Optional[List[str]] = None
    preview_keys: Optional[List[str]] = None


class McpResponse(McpBase):
    """MCP 响应模型"""
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
