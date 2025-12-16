from typing import Generic, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """统一的API响应格式"""

    code: int  # 业务状态码，0表示成功
    message: str  # 响应消息
    data: Optional[T] = None  # 响应数据

    @classmethod
    def success(cls, data: T = None, message: str = "success") -> "ApiResponse[T]":
        """创建成功响应"""
        return cls(code=0, message=message, data=data)

    @classmethod
    def error(cls, code: int, message: str, data: T = None) -> "ApiResponse[T]":
        """创建错误响应"""
        return cls(code=code, message=message, data=data)
