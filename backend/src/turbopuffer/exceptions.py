"""
Turbopuffer 模块异常

目标：
- 隔离第三方 SDK / HTTP client 的异常类型
- 上层不会因为 SDK 变动而被迫修改异常处理逻辑
- 不在异常/日志中泄露敏感信息（如 API Key）
"""

from __future__ import annotations

from typing import Any

import httpx

from src.exceptions import AppException, ErrorCode


class TurbopufferError(AppException):
    """模块基础异常类"""

    def __init__(
        self,
        message: str,
        *,
        code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
        status_code: int = 500,
        details: Any | None = None,
    ) -> None:
        super().__init__(
            code=code, message=message, status_code=status_code, details=details
        )


class TurbopufferConfigError(TurbopufferError):
    def __init__(self, message: str = "Turbopuffer is not configured") -> None:
        super().__init__(
            message=message, code=ErrorCode.INTERNAL_SERVER_ERROR, status_code=500
        )


class TurbopufferAuthError(TurbopufferError):
    def __init__(self, message: str = "Turbopuffer authentication failed") -> None:
        super().__init__(message=message, code=ErrorCode.UNAUTHORIZED, status_code=401)


class TurbopufferNotFound(TurbopufferError):
    def __init__(self, message: str = "Turbopuffer resource not found") -> None:
        super().__init__(message=message, code=ErrorCode.NOT_FOUND, status_code=404)


class TurbopufferRequestError(TurbopufferError):
    def __init__(
        self, message: str = "Turbopuffer request failed", *, status_code: int = 502
    ) -> None:
        # 作为外部依赖，默认按 502 处理更贴近语义（上层可统一映射）
        super().__init__(
            message=message,
            code=ErrorCode.INTERNAL_SERVER_ERROR,
            status_code=status_code,
        )


def map_external_exception(exc: Exception) -> TurbopufferError:
    """
    将第三方异常映射为模块异常。

    注意：不要使用 str(exc) 拼接原始异常信息（可能包含 request/headers 等敏感字段）。
    """

    if isinstance(exc, TurbopufferError):
        return exc

    if isinstance(exc, httpx.TimeoutException):
        return TurbopufferRequestError("Turbopuffer request timed out", status_code=504)

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return TurbopufferAuthError()
        if status == 404:
            return TurbopufferNotFound()
        # 不暴露 response 内容；仅返回 status 码
        return TurbopufferRequestError(
            f"Turbopuffer request failed (status={status})", status_code=502
        )

    if isinstance(exc, httpx.RequestError):
        return TurbopufferRequestError("Turbopuffer network error", status_code=502)

    # 兜底：不要泄露 exc 文本
    return TurbopufferRequestError("Turbopuffer request failed", status_code=502)
