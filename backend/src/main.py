"""
ContextBase Backend Server Entrypoint.
"""

import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

# 记录应用启动时间
APP_START_TIME = time.time()

# 加载 .env 文件（仅用于本地开发，生产环境直接使用系统环境变量）
from dotenv import load_dotenv
dotenv_start = time.time()
load_dotenv()
dotenv_duration = time.time() - dotenv_start

# 记录各模块导入时间
config_start = time.time()
from src.config import settings
config_duration = time.time() - config_start

exceptions_start = time.time()
from src.exceptions import AppException
from src.exception_handler import (
    app_exception_handler,
    http_exception_handler,
    validation_exception_handler,
    generic_exception_handler,
)
exceptions_duration = time.time() - exceptions_start

logger_start = time.time()
from src.utils.logger import log_info, log_error
logger_duration = time.time() - logger_start

# 记录各路由模块导入时间
table_router_start = time.time()
from src.table.router import router as table_router
table_router_duration = time.time() - table_router_start

mcp_router_start = time.time()
from src.mcp.router import router as mcp_router
mcp_router_duration = time.time() - mcp_router_start

# s3_router_start = time.time()
# from src.s3.router import router as s3_router
# s3_router_duration = time.time() - s3_router_start

etl_router = None
etl_router_duration = 0.0
if settings.etl_enabled:
    etl_router_start = time.time()
    from src.etl.router import router as etl_router
    etl_router_duration = time.time() - etl_router_start

project_router_start = time.time()
from src.project.router import router as project_router
project_router_duration = time.time() - project_router_start

connect_router_start = time.time()
from src.connect.router import router as connect_router
connect_router_duration = time.time() - connect_router_start

oauth_router_start = time.time()
from src.oauth.router import router as oauth_router
oauth_router_duration = time.time() - oauth_router_start

internal_router_start = time.time()
from src.internal.router import router as internal_router
internal_router_duration = time.time() - internal_router_start

routers_duration = (table_router_duration + mcp_router_duration +
                   etl_router_duration + project_router_duration + connect_router_duration + oauth_router_duration + internal_router_duration)


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    FastAPI 应用的生命周期管理

    可以在这里初始化数据库连接、缓存等资源
    """
    # 启动时的初始化逻辑
    lifespan_start = time.time()
    log_info("=" * 80)
    log_info("🚀 ContextBase API 启动中...")
    log_info("=" * 80)
    
    # 输出模块导入时间
    log_info(f"📦 模块导入耗时统计:")
    log_info(f"  ├─ .env 加载: {dotenv_duration*1000:.2f}ms")
    log_info(f"  ├─ 配置模块 (config): {config_duration*1000:.2f}ms")
    log_info(f"  ├─ 异常处理模块 (exceptions): {exceptions_duration*1000:.2f}ms")
    log_info(f"  ├─ 日志模块 (logger): {logger_duration*1000:.2f}ms")
    log_info(f"  ├─ 路由模块:")
    log_info(f"  │  ├─ table_router: {table_router_duration*1000:.2f}ms")
    log_info(f"  │  ├─ mcp_router: {mcp_router_duration*1000:.2f}ms")
    if settings.etl_enabled:
        log_info(f"  │  ├─ etl_router: {etl_router_duration*1000:.2f}ms")
    else:
        log_info("  │  ├─ etl_router: skipped (ENABLE_ETL=0 or DEBUG auto)")
    log_info(f"  │  ├─ project_router: {project_router_duration*1000:.2f}ms")
    log_info(f"  │  ├─ connect_router: {connect_router_duration*1000:.2f}ms")
    log_info(f"  │  ├─ oauth_router: {oauth_router_duration*1000:.2f}ms")
    log_info(f"  │  └─ internal_router: {internal_router_duration*1000:.2f}ms")
    log_info(f"  └─ 路由总耗时: {routers_duration*1000:.2f}ms")
    log_info(f"📊 总导入时间: {(time.time() - APP_START_TIME)*1000:.2f}ms")
    log_info("")

    # 1. MCP模块: 恢复 MCP 实例状态 (后续抽出单独的微服务)
    mcp_init_start = time.time()
    try:
        log_info("🔌 初始化 MCP 模块...")
        from src.mcp.dependencies import get_mcp_instance_service

        mcp_service = get_mcp_instance_service()
        recovery_result = await mcp_service.recover_instances_on_startup()
        mcp_duration = time.time() - mcp_init_start
        log_info(f"✅ MCP 实例恢复完成: {recovery_result} (耗时: {mcp_duration*1000:.2f}ms)")
    except Exception as e:
        mcp_duration = time.time() - mcp_init_start
        log_error(f"❌ MCP 实例恢复失败 (耗时: {mcp_duration*1000:.2f}ms): {e}")

    # 初始化 ETL 服务（需要启用 ETL，且非 DEBUG 才启动）
    if settings.etl_enabled and not settings.DEBUG:
        etl_init_start = time.time()
        try:
            log_info("📄 初始化 ETL 服务...")
            from src.etl.dependencies import get_etl_service
            from pathlib import Path

            etl_service = get_etl_service()
            
            # 创建必要的目录
            Path(".mineru_cache").mkdir(parents=True, exist_ok=True)
            Path(".etl_rules").mkdir(parents=True, exist_ok=True)
            
            # 启动 ETL workers
            await etl_service.start()
            etl_duration = time.time() - etl_init_start
            log_info(f"✅ ETL 服务启动成功 (耗时: {etl_duration*1000:.2f}ms)")
        except Exception as e:
            etl_duration = time.time() - etl_init_start
            log_error(f"❌ ETL 服务启动失败 (耗时: {etl_duration*1000:.2f}ms): {e}")
    else:
        log_info("⏭️  ETL 服务已跳过（ENABLE_ETL 关闭或 DEBUG 模式）")

    # 输出总启动时间
    total_startup_time = time.time() - APP_START_TIME
    log_info("")
    log_info("=" * 80)
    log_info(f"✨ ContextBase API 启动完成! 总耗时: {total_startup_time*1000:.2f}ms ({total_startup_time:.3f}s)")
    log_info("=" * 80)
    log_info("")

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
    
    # 2. 停止 ETL 服务（需要启用 ETL，且非 DEBUG 才停止）
    if settings.etl_enabled and not settings.DEBUG:
        try:
            from src.etl.dependencies import get_etl_service
            
            etl_service = get_etl_service()
            await etl_service.stop()
            log_info("ETL service stopped successfully")
        except Exception as e:
            log_error(f"Failed to stop ETL service: {e}")


def create_app() -> FastAPI:
    """创建FastAPI应用实例"""
    app_create_start = time.time()

    # 初始化FastAPI应用
    fastapi_start = time.time()
    app = FastAPI(
        title="ContextBase API",
        description="可托管的上下文配置与导出平台",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )
    fastapi_duration = time.time() - fastapi_start

    # 配置CORS中间件
    cors_start = time.time()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_HOSTS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    cors_duration = time.time() - cors_start

    # 注册路由
    router_register_start = time.time()
    app.include_router(table_router, prefix="/api/v1", tags=["tables"])
    app.include_router(mcp_router, prefix="/api/v1", tags=["mcp"])
    # app.include_router(s3_router, prefix="/api/v1")
    if etl_router is not None:
        app.include_router(etl_router, prefix="/api/v1", tags=["etl"])
    app.include_router(project_router, prefix="/api/v1", tags=["projects"])
    app.include_router(connect_router, prefix="/api/v1", tags=["connect"])
    app.include_router(oauth_router, prefix="/api/v1", tags=["oauth"])
    app.include_router(internal_router, tags=["internal"])  # Internal API不加/api/v1前缀
    router_register_duration = time.time() - router_register_start

    # 注册异常处理器
    exception_handler_start = time.time()
    app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    exception_handler_duration = time.time() - exception_handler_start

    app_create_duration = time.time() - app_create_start
    
    # 使用 print 输出，因为此时 logger 可能还未完全初始化
    print(f"⚙️  FastAPI 应用创建耗时统计:")
    print(f"  ├─ FastAPI 实例化: {fastapi_duration*1000:.2f}ms")
    print(f"  ├─ CORS 中间件配置: {cors_duration*1000:.2f}ms")
    print(f"  ├─ 路由注册: {router_register_duration*1000:.2f}ms")
    print(f"  └─ 异常处理器注册: {exception_handler_duration*1000:.2f}ms")
    print(f"📦 应用创建总耗时: {app_create_duration*1000:.2f}ms")
    print("")

    return app


# 创建应用实例
app = create_app()


@app.get("/health")
async def health_check():
    """健康检查接口"""
    import os
    
    # 检查关键环境变量
    env_status = {
        "supabase_configured": bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY")),
        "s3_configured": bool(os.getenv("S3_BUCKET_NAME")),
        "mineru_configured": bool(os.getenv("MINERU_API_KEY")),
    }
    
    return {
        "status": "healthy",
        "service": "ContextBase API",
        "version": settings.VERSION,
        "environment": env_status
    }


# 启动命令: uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
