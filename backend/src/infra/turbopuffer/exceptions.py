"""
Turbopuffer module exceptions.

Goals:
- Isolate third-party SDK / HTTP client exception types
- Upper layers won't be forced to modify exception handling due to SDK changes
- Don't leak sensitive information (e.g. API Key) in exceptions/logs
"""

from __future__ import annotations

from typing import Any

import httpx

from src.exceptions import AppException, ErrorCode


class TurbopufferError(AppException):
    """Module base exception class"""

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
        # As an external dependency, 502 is semantically closer by default (upper layers can remap)
        super().__init__(
            message=message,
            code=ErrorCode.INTERNAL_SERVER_ERROR,
            status_code=status_code,
        )


def map_external_exception(exc: Exception) -> TurbopufferError:
    """
    Map third-party exceptions to module exceptions.

    Note: Do not use str(exc) to concatenate original exception info (may contain sensitive fields like request/headers).
    """

    if isinstance(exc, TurbopufferError):
        return exc

    # turbopuffer SDK exceptions (no hard dependency on import; loosely matched by class name/module name)
    exc_type = type(exc)
    exc_mod = getattr(exc_type, "__module__", "") or ""
    exc_name = getattr(exc_type, "__name__", "") or ""
    if exc_mod.startswith("turbopuffer"):
        if exc_name in {"AuthenticationError"}:
            return TurbopufferAuthError()
        if exc_name in {"RateLimitError"}:
            return TurbopufferRequestError("Turbopuffer rate limited", status_code=429)
        if exc_name in {"APIConnectionError"}:
            return TurbopufferRequestError("Turbopuffer network error", status_code=502)
        if exc_name in {"NotFoundError"}:
            return TurbopufferNotFound()
        if exc_name in {"APIStatusError"}:
            # Try to extract status_code (field name may differ across versions)
            status = getattr(exc, "status_code", None)
            if status is None and hasattr(exc, "response"):
                status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (401, 403):
                return TurbopufferAuthError()
            if status == 404:
                return TurbopufferNotFound()
            if isinstance(status, int):
                return TurbopufferRequestError(
                    f"Turbopuffer request failed (status={status})", status_code=502
                )
            return TurbopufferRequestError(
                "Turbopuffer request failed", status_code=502
            )
        # APIError / other errors: fallback
        return TurbopufferRequestError("Turbopuffer request failed", status_code=502)

    if isinstance(exc, httpx.TimeoutException):
        return TurbopufferRequestError("Turbopuffer request timed out", status_code=504)

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return TurbopufferAuthError()
        if status == 404:
            return TurbopufferNotFound()
        # Don't expose response content; only return status code
        return TurbopufferRequestError(
            f"Turbopuffer request failed (status={status})", status_code=502
        )

    if isinstance(exc, httpx.RequestError):
        return TurbopufferRequestError("Turbopuffer network error", status_code=502)

    # Fallback: don't leak exc text
    return TurbopufferRequestError("Turbopuffer request failed", status_code=502)
