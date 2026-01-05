from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from src.exceptions import AppException, ErrorCode
from src.common_schemas import ApiResponse
from loguru import logger
from src.utils.request_context import request_id_var


async def app_exception_handler(request: Request, exc: AppException):
    """处理自定义应用异常"""
    # 注意：AppException（4xx/业务错误）默认也应该记录日志，便于排障。
    # 之前只返回响应不打日志，会造成“看不到任何报错”的错觉。
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
    """处理 FastAPI/Starlette 的 HTTPException"""
    resp = JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.error(
            code=ErrorCode.BAD_REQUEST,  # 默认映射为 BAD_REQUEST，或者根据 exc.status_code 细分
            message=str(exc.detail),
        ).model_dump(),
    )
    rid = request_id_var.get()
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求参数验证异常"""
    # 将 Pydantic 的 error list 转换为更易读的格式
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
    """处理所有未捕获的异常"""
    # 记录完整堆栈；request 上下文（request_id/path/method 等）由 middleware + patcher 注入
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
