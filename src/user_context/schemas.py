from pydantic import BaseModel, Field
from typing import List, Any, Optional


class UserContextCreate(BaseModel):
    user_id: str
    project_id: str
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict


class UserContextUpdate(BaseModel):
    context_name: str
    context_description: str
    context_data: Optional[dict] = None
    metadata: dict


class UserContextOut(BaseModel):
    context_id: str
    user_id: str
    project_id: str
    context_name: str
    context_description: str
    context_data: dict
    metadata: dict


# Context Data 相关的 Schema
class ContextDataElement(BaseModel):
    """context_data 操作的元素"""

    key: str = Field(..., description="数据项的键名")
    content: Any = Field(
        ...,
        description="数据项的内容，可以是任意JSON对象结构（dict、list、str、int、float、bool等）",
    )


class ContextDataCreate(BaseModel):
    """创建 context_data 的请求"""

    mounted_json_pointer_path: str = Field(
        ...,
        description='JSON指针路径，数据将挂载到此路径下。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 context_data 的根路径下添加 key',
    )
    elements: List[ContextDataElement] = Field(..., description="要创建的元素数组")


class ContextDataUpdate(BaseModel):
    """更新 context_data 的请求"""

    json_pointer_path: str = Field(
        ...,
        description='JSON指针路径。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 context_data 的根路径下更新 key',
    )
    elements: List[ContextDataElement] = Field(..., description="要更新的元素数组")


class ContextDataDelete(BaseModel):
    """删除 context_data 的请求"""

    json_pointer_path: str = Field(
        ...,
        description='JSON指针路径。使用RFC 6901标准格式（例如："/users"、"/users/123"）。根路径使用空字符串 "" 可以在 context_data 的根路径下删除 key',
    )
    keys: List[str] = Field(..., description="要删除的键列表")


class ContextDataGet(BaseModel):
    """获取 context_data 的响应"""

    data: Any = Field(
        ...,
        description="获取到的JSON数据，可以是任意类型（dict、list、str、int、float、bool等）",
    )
