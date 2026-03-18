from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field


class Project(BaseModel):
    """
    Project表示项目，对应Supabase数据库中的project表.
    """

    id: str = Field(..., description="主键，表示项目的ID (UUID)")
    org_id: str = Field(..., description="所属组织ID")
    created_by: Optional[str] = Field(None, description="创建者用户ID")
    name: Optional[str] = Field(None, description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")
    created_at: datetime = Field(..., description="创建时间")

    model_config = ConfigDict(from_attributes=True)


class Table(BaseModel):
    """
    Table表示知识库，对应Supabase数据库中的table表.
    """

    id: str = Field(..., description="主键，表示知识库的ID (UUID)")
    name: Optional[str] = Field(
        None, description="知识库名称，在MCP服务中可以提供给Agent"
    )
    project_id: Optional[str] = Field(
        None, description="外键，对应项目表，表示知识库所属的项目ID (UUID)"
    )
    created_by: Optional[str] = Field(
        None, description="创建者用户ID，支持裸Table（不属于任何Project）"
    )
    description: Optional[str] = Field(
        None, description="知识库的描述，在MCP服务中可以提供给Agent"
    )
    data: Optional[Any] = Field(
        None,
        description="关键存储数据的字段，本质上存储一个JSON对象（jsonb类型），可以是Dict、List或其他JSON类型",
    )
    created_at: datetime = Field(..., description="创建时间")

    model_config = ConfigDict(from_attributes=True)
