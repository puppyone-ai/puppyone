"""
Project 数据模型

定义 Project 的业务领域模型
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class Project(BaseModel):
    """项目领域模型"""

    id: int = Field(..., description="项目ID")
    name: str = Field(..., description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")
    user_id: Optional[str] = Field(None, description="所属用户ID")
    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True
