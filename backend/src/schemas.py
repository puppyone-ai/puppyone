from typing import Generic, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Unified API response format"""

    code: int  # Business status code, 0 means success
    message: str  # Response message
    data: Optional[T] = None  # Response data

    @classmethod
    def success(cls, data: T = None, message: str = "success") -> "ApiResponse[T]":
        """Create a success response"""
        return cls(code=0, message=message, data=data)

    @classmethod
    def error(cls, code: int, message: str, data: T = None) -> "ApiResponse[T]":
        """Create an error response"""
        return cls(code=code, message=message, data=data)
