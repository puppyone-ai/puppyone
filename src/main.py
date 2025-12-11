"""
ContextBase Backend Server Entrypoint.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.config import settings
from src.exceptions import AppException
from src.exception_handler import (
    app_exception_handler,
    http_exception_handler,
    validation_exception_handler,
    generic_exception_handler,
)
from src.utils.logger import log_info, log_error
from src.table.router import router as table_router
from src.mcp.router import router as mcp_router
from src.s3.router import router as s3_router
from src.etl.router import router as etl_router
from src.project.router import router as project_router


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    FastAPI 应用的生命周期管理

    可以在这里初始化数据库连接、缓存等资源
    """
    # 启动时的初始化逻辑
    log_info("Initializing ContextBase API...")

    # 1. MCP模块: 恢复 MCP 实例状态 (后续抽出单独的微服务)
    try:
        from src.mcp.dependencies import get_mcp_instance_service

        mcp_service = get_mcp_instance_service()
        recovery_result = await mcp_service.recover_instances_on_startup()
        log_info(f"MCP instances recovery completed: {recovery_result}")
    except Exception as e:
        log_error(f"Failed to recover MCP instances on startup: {e}")

    # 初始化 ETL 服务
    try:
        from src.etl.dependencies import get_etl_service
        from pathlib import Path

        etl_service = get_etl_service()
        
        # 创建必要的目录
        Path(".mineru_cache").mkdir(parents=True, exist_ok=True)
        Path(".etl_rules").mkdir(parents=True, exist_ok=True)
        
        # 启动 ETL workers
        await etl_service.start()
        log_info("ETL service started successfully")
    except Exception as e:
        log_error(f"Failed to start ETL service: {e}")

    yield
    # 关闭时的清理逻辑
    log_info("ContextBase API 关闭中...")
    
    # 1. 停止所有 MCP 实例
    try:
        from src.mcp.dependencies import get_mcp_instance_service
        
        mcp_service = get_mcp_instance_service()
        shutdown_result = await mcp_service.shutdown_all_instances()
        log_info(f"MCP instances shutdown completed: {shutdown_result}")
    except Exception as e:
        log_error(f"Failed to shutdown MCP instances: {e}")
    
    # 2. 停止 ETL 服务
    try:
        from src.etl.dependencies import get_etl_service
        
        etl_service = get_etl_service()
        await etl_service.stop()
        log_info("ETL service stopped successfully")
    except Exception as e:
        log_error(f"Failed to stop ETL service: {e}")


def create_app() -> FastAPI:
    """创建FastAPI应用实例"""

    # 初始化FastAPI应用
    app = FastAPI(
        title="ContextBase API",
        description="可托管的上下文配置与导出平台",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )

    # 配置CORS中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_HOSTS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    app.include_router(table_router, prefix="/api/v1", tags=["tables"])
    app.include_router(mcp_router, prefix="/api/v1", tags=["mcp"])
    app.include_router(s3_router, prefix="/api/v1")
    app.include_router(etl_router, prefix="/api/v1", tags=["etl"])
    app.include_router(project_router, prefix="/api/v1", tags=["projects"])

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


# 启动命令: uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
