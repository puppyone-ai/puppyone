"""
ContextBase Backend Server Entrypoint.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.router import api_router
from app.core.config import settings
# from app.mcp_server.server import get_mcp_http_app
from app.utils.logger import log_info, log_error
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.core.exceptions import AppException
from app.core.exception_handler import (
    app_exception_handler,
    http_exception_handler,
    validation_exception_handler,
    generic_exception_handler
)


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    FastAPI 应用的生命周期管理
    
    可以在这里初始化数据库连接、缓存等资源
    """
    # 启动时的初始化逻辑
    log_info("ContextBase API 启动中...")
    
    # 恢复 MCP 实例状态（检查 repository 中的实例状态，同步进程状态）
    try:
        from app.core.dependencies import get_mcp_instance_service
        mcp_service = get_mcp_instance_service()
        recovery_result = await mcp_service.recover_instances_on_startup()
        log_info(f"MCP instances recovery completed: {recovery_result}")
    except Exception as e:
        log_error(f"Failed to recover MCP instances on startup: {e}")
    
    # TODO: 初始化数据库连接、缓存等
    yield
    # 关闭时的清理逻辑
    log_info("ContextBase API 关闭中...")
    # TODO: 关闭数据库连接、清理资源等


# 全局变量：MCP HTTP 应用实例
# _mcp_app = None


# def get_mcp_app():
#     """获取或创建 MCP HTTP 应用实例（单例模式）"""
#     global _mcp_app
#     if _mcp_app is None:
#         # 使用 "/" 作为内部路径，挂载时会自动处理路径拼接
#         _mcp_app = get_mcp_http_app(path="/")
#     return _mcp_app


# @asynccontextmanager
# async def combined_lifespan(app: FastAPI):
#     """
#     合并 FastAPI 和 MCP 服务器的生命周期
    
#     确保两个应用的生命周期都得到正确管理
#     """
#     # 获取 MCP HTTP 应用实例
#     mcp_app = get_mcp_app()
    
#     # 合并两个生命周期
#     async with app_lifespan(app):
#         async with mcp_app.lifespan(app):
#             yield


def create_app() -> FastAPI:
    """创建FastAPI应用实例"""
    
    # 获取 MCP HTTP 应用实例
    # mcp_app = get_mcp_app()
    
    # 初始化FastAPI应用，使用合并后的生命周期
    app = FastAPI(
        title="ContextBase API",
        description="可托管的上下文配置与导出平台",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )

    # 挂载 MCP 服务器到 FastAPI 应用
    # FastAPI 的 mount 会自动处理尾部斜杠，挂载到 "/mcp" 后，实际访问路径为 "/mcp/"（带尾部斜杠）
    # app.mount("/mcp", mcp_app)
    log_info("MCP 服务器已挂载到 /mcp 路径（实际访问路径: /mcp/）")
    
    # 配置中间件
    # 注意：根据 FastMCP 文档，如果使用 OAuth 认证，需要避免应用级别的 CORS 中间件
    # 但这里我们使用的是 API Key 认证，所以可以正常使用 CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_HOSTS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # 注册路由
    app.include_router(api_router)

    # 注册异常处理器
    app.add_exception_handler(AppException, app_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    
    return app

# 创建应用实例
app = create_app()

@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "service": "ContextBase API"}

# 启动命令: uv run uvicorn app.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
