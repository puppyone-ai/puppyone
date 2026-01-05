from __future__ import annotations

import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from loguru import logger

from src.utils.request_context import (
    client_ip_var,
    method_var,
    path_var,
    request_id_var,
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    - Ensure every request has X-Request-Id (propagate if provided).
    - Store request context in contextvars for logging (request_id/method/path/client_ip).
    - Emit a structured access log line with latency + status_code.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        start = time.perf_counter()

        incoming = request.headers.get("x-request-id")
        request_id = incoming.strip() if incoming else uuid.uuid4().hex

        # Fill contextvars for the whole request lifetime
        token_rid = request_id_var.set(request_id)
        token_m = method_var.set(request.method)
        token_p = path_var.set(str(request.url.path))
        token_ip = client_ip_var.set(request.client.host if request.client else None)

        try:
            response = await call_next(request)
        finally:
            # 这里不要打异常堆栈：统一交给 FastAPI 的 exception_handler，
            # 避免重复记录同一异常的 traceback。
            pass

        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-Id"] = request_id

        logger.bind(
            status_code=response.status_code,
            latency_ms=round(elapsed_ms, 2),
        ).info("access")

        # Always reset contextvars to avoid leaking between requests
        request_id_var.reset(token_rid)
        method_var.reset(token_m)
        path_var.reset(token_p)
        client_ip_var.reset(token_ip)

        return response
