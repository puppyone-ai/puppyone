from pydantic import BaseModel, Field
from typing import List, Optional

class TableInfo(BaseModel):
    """表信息模型"""
    id: str = Field(..., description="表ID")
    name: str = Field(..., description="表名称")
    rows: Optional[int] = Field(None, description="行数")

class Project(BaseModel):
    """项目模型"""
    id: str = Field(..., description="项目ID")
    name: str = Field(..., description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")
    tables: List[TableInfo] = Field(default_factory=list, description="表列表")

