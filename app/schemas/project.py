from pydantic import BaseModel, Field
from typing import List, Optional

class TableInfo(BaseModel):
    """表信息"""
    id: str = Field(..., description="表ID")
    name: str = Field(..., description="表名称")
    rows: Optional[int] = Field(None, description="行数")

class ProjectCreate(BaseModel):
    """创建项目的请求"""
    name: str = Field(..., description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")

class ProjectUpdate(BaseModel):
    """更新项目的请求"""
    name: Optional[str] = Field(None, description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")

class ProjectOut(BaseModel):
    """项目输出"""
    id: str = Field(..., description="项目ID")
    name: str = Field(..., description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")
    tables: List[TableInfo] = Field(default_factory=list, description="表列表")

class TableCreate(BaseModel):
    """创建表的请求"""
    name: str = Field(..., description="表名称")
    data: Optional[List[dict]] = Field(default_factory=list, description="初始数据")

class TableUpdate(BaseModel):
    """更新表的请求"""
    name: Optional[str] = Field(None, description="表名称")

class TableOut(BaseModel):
    """表输出"""
    id: str = Field(..., description="表ID")
    name: str = Field(..., description="表名称")
    rows: int = Field(..., description="行数")
    data: List[dict] = Field(..., description="表数据")

class FolderImportRequest(BaseModel):
    """导入文件夹的请求"""
    table_name: str = Field(..., description="表名称")
    folder_structure: dict = Field(..., description="文件夹结构JSON对象")

