from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from src.exceptions import AppException, ErrorCode
from src.common_schemas import ApiResponse
from src.utils.logger import log_error


async def app_exception_handler(request: Request, exc: AppException):
    """处理自定义应用异常"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.error(
            code=exc.code, message=exc.message, data=exc.details
        ).model_dump(),
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """处理 FastAPI/Starlette 的 HTTPException"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.error(
            code=ErrorCode.BAD_REQUEST,  # 默认映射为 BAD_REQUEST，或者根据 exc.status_code 细分
            message=str(exc.detail),
        ).model_dump(),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求参数验证异常"""
    # 将 Pydantic 的 error list 转换为更易读的格式
    errors = []
    for error in exc.errors():
        loc = ".".join([str(x) for x in error["loc"]])
        msg = error["msg"]
        errors.append(f"{loc}: {msg}")

    return JSONResponse(
        status_code=422,
        content=ApiResponse.error(
            code=ErrorCode.VALIDATION_ERROR, message="Validation Error", data=errors
        ).model_dump(),
    )


async def generic_exception_handler(request: Request, exc: Exception):
    """处理所有未捕获的异常"""
    log_error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content=ApiResponse.error(
            code=ErrorCode.INTERNAL_SERVER_ERROR, message="Internal Server Error"
        ).model_dump(),
    )
