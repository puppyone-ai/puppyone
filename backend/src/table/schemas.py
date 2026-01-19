from datetime import datetime
from pydantic import BaseModel, Field
from typing import List, Any, Optional


class TableCreate(BaseModel):
    """创建Table的请求"""

    project_id: Optional[str] = Field(None, description="项目ID（可选，不传则创建裸Table）")
    name: str = Field(..., description="Table名称")
    description: str = Field(default="", description="Table描述")
    data: Any = Field(
        default_factory=dict, description="Table数据（可以是Dict、List或其他JSON类型）"
    )


class TableUpdate(BaseModel):
    """更新Table的请求"""

    name: Optional[str] = Field(None, description="Table名称")
    description: Optional[str] = Field(None, description="Table描述")
    data: Optional[Any] = Field(
        None, description="Table数据（可选，可以是Dict、List或其他JSON类型）"
    )


class TableOut(BaseModel):
    """Table响应模型"""

    id: str = Field(..., description="Table ID (UUID)")
    name: Optional[str] = Field(None, description="Table名称")
    project_id: Optional[str] = Field(None, description="项目ID (UUID)")
    user_id: Optional[str] = Field(None, description="用户ID")
    description: Optional[str] = Field(None, description="Table描述")
    data: Optional[Any] = Field(
        None, description="Table数据（JSON数据，可以是Dict、List或其他JSON类型）"
    )
    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True


# Context Data 相关的 Schema（保持命名不变以兼容API）
class ContextDataElement(BaseModel):
    """data 字段操作的元素"""

    key: str = Field(..., description="数据项的键名")
    content: Any = Field(
        ...,
        description="数据项的内容，可以是任意JSON对象结构（dict、list、str、int、float、bool等）",
    )


class ContextDataCreate(BaseModel):
    """创建 data 字段数据的请求"""

    mounted_json_pointer_path: str = Field(
        ...,
        description='JSON指针路径，数据将挂载到此路径下。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 data 的根路径下添加 key',
    )
    elements: List[ContextDataElement] = Field(..., description="要创建的元素数组")


class ContextDataUpdate(BaseModel):
    """更新 data 字段数据的请求"""

    json_pointer_path: str = Field(
        ...,
        description='JSON指针路径。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 data 的根路径下更新 key',
    )
    elements: List[ContextDataElement] = Field(..., description="要更新的元素数组")


class ContextDataDelete(BaseModel):
    """删除 data 字段数据的请求"""

    json_pointer_path: str = Field(
        ...,
        description='JSON指针路径。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 data 的根路径下删除 key',
    )
    keys: List[str] = Field(..., description="要删除的键列表")


class ContextDataGet(BaseModel):
    """获取 data 字段数据的响应"""

    data: Any = Field(
        ...,
        description="获取到的JSON数据，可以是任意类型（dict、list、str、int、float、bool等）",
    )


class ProjectWithTables(BaseModel):
    """包含项目信息和其下所有表格的响应模型"""

    id: str = Field(..., description="项目ID (UUID)")
    name: Optional[str] = Field(None, description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")
    user_id: Optional[str] = Field(None, description="用户ID")
    created_at: datetime = Field(..., description="创建时间")
    tables: List[TableOut] = Field(
        default_factory=list, description="该项目下的所有表格列表"
    )

    class Config:
        from_attributes = True
