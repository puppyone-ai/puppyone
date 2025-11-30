from enum import Enum
from typing import Any, Optional


class ErrorCode(int, Enum):
    """全局错误码定义"""

    SUCCESS = 0

    # 通用错误 (1000-1999)
    INTERNAL_SERVER_ERROR = 1000
    BAD_REQUEST = 1001
    UNAUTHORIZED = 1002
    FORBIDDEN = 1003
    NOT_FOUND = 1004
    METHOD_NOT_ALLOWED = 1005
    VALIDATION_ERROR = 1006

    # 用户/认证相关 (2000-2999)
    USER_NOT_FOUND = 2001
    USER_ALREADY_EXISTS = 2002
    INVALID_CREDENTIALS = 2003
    TOKEN_EXPIRED = 2004
    INVALID_TOKEN = 2005

    # MCP 相关 (3000-3999)
    MCP_INSTANCE_NOT_FOUND = 3001
    MCP_INSTANCE_CREATION_FAILED = 3002
    MCP_INSTANCE_UPDATE_FAILED = 3003
    MCP_INSTANCE_DELETE_FAILED = 3004
    MCP_SERVER_ERROR = 3005


class AppException(Exception):
    """应用基础异常类"""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int = 400,
        details: Optional[Any] = None,
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(self.message)


# 具体异常类 helper
class NotFoundException(AppException):
    def __init__(
        self, message: str = "Resource not found", code: ErrorCode = ErrorCode.NOT_FOUND
    ):
        super().__init__(code=code, message=message, status_code=404)


class ValidationException(AppException):
    def __init__(self, message: str = "Validation error", details: Any = None):
        super().__init__(
            code=ErrorCode.VALIDATION_ERROR,
            message=message,
            status_code=422,
            details=details,
        )


class AuthException(AppException):
    def __init__(
        self,
        message: str = "Authentication failed",
        code: ErrorCode = ErrorCode.UNAUTHORIZED,
    ):
        super().__init__(code=code, message=message, status_code=401)


class PermissionException(AppException):
    def __init__(
        self, message: str = "Permission denied", code: ErrorCode = ErrorCode.FORBIDDEN
    ):
        super().__init__(code=code, message=message, status_code=403)


class BusinessException(AppException):
    """业务逻辑错误"""

    def __init__(self, message: str, code: ErrorCode = ErrorCode.BAD_REQUEST):
        super().__init__(code=code, message=message, status_code=400)
