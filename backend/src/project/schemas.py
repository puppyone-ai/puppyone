"""
Project API Schemas

定义前端 API 请求/响应模型，匹配前端 ProjectInfo 类型。
"""

from typing import Optional, List, Any
from pydantic import BaseModel


class TableInfo(BaseModel):
    """表信息（简化版，用于项目列表）"""
    id: str
    name: str
    rows: Optional[int] = None


class ProjectOut(BaseModel):
    """项目输出模型 - 匹配前端 ProjectInfo 类型"""
    id: str
    name: str
    description: Optional[str] = None
    tables: List[TableInfo] = []


class ProjectCreate(BaseModel):
    """创建项目请求"""
    name: str
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    """更新项目请求"""
    name: Optional[str] = None
    description: Optional[str] = None


class TableOut(BaseModel):
    """表输出模型"""
    id: str
    name: str
    rows: Optional[int] = None
    data: Optional[List[Any]] = None

