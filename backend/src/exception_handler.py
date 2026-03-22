from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from src.exceptions import AppException, ErrorCode
from src.common_schemas import ApiResponse
from loguru import logger
from src.utils.request_context import request_id_var


async def app_exception_handler(request: Request, exc: AppException):
    “””Handle custom application exceptions”””
    # Note: AppException (4xx/business errors) should also be logged by default for troubleshooting.
    # Previously only returning the response without logging created the illusion of “no errors visible”.
    rid = request_id_var.get()
    log = logger.bind(
        err_code=int(exc.code),
        err_status=exc.status_code,
        err_message=exc.message,
        request_id=rid,
    )
    if exc.status_code >= 500:
        log.error("AppException")
    else:
        log.warning("AppException")

    resp = JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.error(
            code=exc.code, message=exc.message, data=exc.details
        ).model_dump(),
    )
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle FastAPI/Starlette HTTPException"""
    resp = JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.error(
            code=ErrorCode.BAD_REQUEST,  # Default mapping to BAD_REQUEST, or subdivide by exc.status_code
            message=str(exc.detail),
        ).model_dump(),
    )
    rid = request_id_var.get()
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle request parameter validation exceptions"""
    # Convert Pydantic's error list to a more readable format
    errors = []
    for error in exc.errors():
        loc = ".".join([str(x) for x in error["loc"]])
        msg = error["msg"]
        errors.append(f"{loc}: {msg}")

    resp = JSONResponse(
        status_code=422,
        content=ApiResponse.error(
            code=ErrorCode.VALIDATION_ERROR, message="Validation Error", data=errors
        ).model_dump(),
    )
    rid = request_id_var.get()
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp


async def generic_exception_handler(request: Request, exc: Exception):
    """Handle all uncaught exceptions"""
    # Log full stack trace; request context (request_id/path/method etc.) injected by middleware + patcher
    logger.exception("Unhandled exception")
    resp = JSONResponse(
        status_code=500,
        content=ApiResponse.error(
            code=ErrorCode.INTERNAL_SERVER_ERROR, message="Internal Server Error"
        ).model_dump(),
    )
    rid = request_id_var.get()
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp
