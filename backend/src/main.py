"""
ContextBase Backend Server Entrypoint.
"""

# ruff: noqa: E402

import time
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.mcp.dependencies import get_mcp_instance_service

# 记录应用启动时间
APP_START_TIME = time.time()

# 加载 .env 文件（仅用于本地开发，生产环境直接使用系统环境变量）
from dotenv import load_dotenv

dotenv_start = time.time()
load_dotenv(override=True)
dotenv_duration = time.time() - dotenv_start

# 初始化 Loguru + 拦截标准 logging（含 uvicorn.*）
from src.utils.logging_setup import setup_logging

setup_logging()

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

tool_router_start = time.time()
from src.tool.router import router as tool_router

tool_router_duration = time.time() - tool_router_start

mcp_v3_router_start = time.time()
from src.access.mcp.router import router as mcp_v3_router

mcp_v3_router_duration = time.time() - mcp_v3_router_start

agent_router_start = time.time()
from src.access.chat.router import router as agent_router
from src.access.config.router import router as agent_config_router

agent_router_duration = time.time() - agent_router_start

context_publish_router_start = time.time()
from src.context_publish.router import router as context_publish_router
from src.context_publish.router import public_router as context_publish_public_router

context_publish_router_duration = time.time() - context_publish_router_start

# Unified ingest router (file + SaaS imports)
ingest_router_start = time.time()
from src.upload.router import router as ingest_router

ingest_router_duration = time.time() - ingest_router_start

project_router_start = time.time()
from src.project.router import router as project_router

project_router_duration = time.time() - project_router_start

oauth_router_start = time.time()
from src.oauth.router import router as oauth_router

oauth_router_duration = time.time() - oauth_router_start

internal_router_start = time.time()
from src.internal.router import router as internal_router

internal_router_duration = time.time() - internal_router_start

content_node_router_start = time.time()
from src.content_node.router import router as content_node_router

content_node_router_duration = time.time() - content_node_router_start

analytics_router_start = time.time()
from src.analytics.router import router as analytics_router

analytics_router_duration = time.time() - analytics_router_start

profile_router_start = time.time()
from src.profile.router import router as profile_router

profile_router_duration = time.time() - profile_router_start

db_connector_router_start = time.time()
from src.db_connector.router import router as db_connector_router

db_connector_router_duration = time.time() - db_connector_router_start

# Scheduler service import
scheduler_start = time.time()
from src.scheduler.service import get_scheduler_service
from src.scheduler.config import scheduler_settings

scheduler_import_duration = time.time() - scheduler_start



def _validate_security_baseline() -> None:
    """在非开发环境校验关键安全配置。"""
    if settings.DEBUG:
        return

    if not (settings.INTERNAL_API_SECRET or "").strip():
        raise RuntimeError(
            "INTERNAL_API_SECRET must be configured when DEBUG is False"
        )

    if "*" in (settings.ALLOWED_HOSTS or []):
        raise RuntimeError(
            "ALLOWED_HOSTS cannot contain '*' when DEBUG is False"
        )


_validate_security_baseline()

routers_duration = (
    table_router_duration
    + tool_router_duration
    + mcp_v3_router_duration
    + agent_router_duration
    + context_publish_router_duration
    + ingest_router_duration
    + project_router_duration
    + oauth_router_duration
    + internal_router_duration
    + content_node_router_duration
    + analytics_router_duration
    + profile_router_duration
    + db_connector_router_duration
)


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    FastAPI 应用的生命周期管理

    可以在这里初始化数据库连接、缓存等资源
    """
    # 启动时的初始化逻辑
    log_info("=" * 80)
    log_info("🚀 ContextBase API 启动中...")
    log_info("=" * 80)

    # 输出模块导入时间
    log_info("📦 模块导入耗时统计:")
    log_info(f"  ├─ .env 加载: {dotenv_duration * 1000:.2f}ms")
    log_info(f"  ├─ 配置模块 (config): {config_duration * 1000:.2f}ms")
    log_info(f"  ├─ 异常处理模块 (exceptions): {exceptions_duration * 1000:.2f}ms")
    log_info(f"  ├─ 日志模块 (logger): {logger_duration * 1000:.2f}ms")
    log_info("  ├─ 路由模块:")
    log_info(f"  │  ├─ table_router: {table_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ tool_router: {tool_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ mcp_router(v3): {mcp_v3_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ agent_router: {agent_router_duration * 1000:.2f}ms")
    log_info(
        f"  │  ├─ context_publish_router: {context_publish_router_duration * 1000:.2f}ms"
    )
    log_info(f"  │  ├─ ingest_router: {ingest_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ project_router: {project_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ oauth_router: {oauth_router_duration * 1000:.2f}ms")
    log_info(f"  │  ├─ internal_router: {internal_router_duration * 1000:.2f}ms")
    log_info(f"  │  └─ content_node_router: {content_node_router_duration * 1000:.2f}ms")
    log_info(f"  └─ 路由总耗时: {routers_duration * 1000:.2f}ms")
    log_info(f"📊 总导入时间: {(time.time() - APP_START_TIME) * 1000:.2f}ms")
    log_info("")

    # 1. MCP模块: 检查 MCP Server 健康状态
    mcp_init_start = time.time()
    try:
        log_info("🔌 检查 MCP Server 健康状态...")
        from src.mcp.dependencies import get_mcp_instance_service

        mcp_service = get_mcp_instance_service()
        health_result = await mcp_service.check_mcp_server_health()
        mcp_duration = time.time() - mcp_init_start
        if health_result.get("status", "") != "unhealthy":
            log_info(
                f"✅ MCP Server 健康检查完成: {health_result} (耗时: {mcp_duration * 1000:.2f}ms)"
            )
        else:
            log_error(f"❌ MCP Server停机, 健康信息: {health_result}")
    except Exception as e:
        mcp_duration = time.time() - mcp_init_start
        log_error(
            f"❌ MCP Server 健康检查失败 (耗时: {mcp_duration * 1000:.2f}ms): {e}"
        )

    # 2. 初始化 Scheduler 服务
    scheduler_init_start = time.time()
    try:
        if scheduler_settings.enabled:
            log_info("⏰ 初始化 Scheduler 服务...")
            scheduler_service = get_scheduler_service()
            await scheduler_service.start()
            scheduler_duration = time.time() - scheduler_init_start
            log_info(f"✅ Scheduler 服务启动成功 (耗时: {scheduler_duration * 1000:.2f}ms)")
        else:
            log_info("⏭️  Scheduler 服务已跳过（SCHEDULER_ENABLED 关闭）")
    except Exception as e:
        scheduler_duration = time.time() - scheduler_init_start
        log_error(f"❌ Scheduler 服务启动失败 (耗时: {scheduler_duration * 1000:.2f}ms): {e}")

    # 3. 初始化 File Ingest 服务（需要启用）
    if settings.etl_enabled:
        file_ingest_init_start = time.time()
        try:
            log_info("📄 初始化 File Ingest 服务...")
            from src.upload.file.dependencies import get_etl_service
            from pathlib import Path

            file_ingest_service = await get_etl_service()

            # 创建必要的目录
            Path(".mineru_cache").mkdir(parents=True, exist_ok=True)
            Path(".etl_rules").mkdir(parents=True, exist_ok=True)

            # 启动 File Ingest 控制面（worker 由独立进程启动）
            await file_ingest_service.start()
            file_ingest_duration = time.time() - file_ingest_init_start
            log_info(f"✅ File Ingest 服务启动成功 (耗时: {file_ingest_duration * 1000:.2f}ms)")
            if settings.DEBUG:
                log_info("   ℹ️  DEBUG 模式下 File workers 已启动（用于开发测试）")
        except Exception as e:
            file_ingest_duration = time.time() - file_ingest_init_start
            log_error(f"❌ File Ingest 服务启动失败 (耗时: {file_ingest_duration * 1000:.2f}ms): {e}")
    else:
        log_info("⏭️  File Ingest 服务已跳过（ENABLE_ETL 关闭）")

    # 4. 初始化 FolderSourceService + FolderAccessService（启动文件夹同步）
    sync_init_start = time.time()
    try:
        log_info("🔄 初始化 Folder Sync Services...")
        from src.sync.handlers.folder_source import FolderSourceService
        from src.access.openclaw.folder_access import FolderAccessService
        from src.sync.repository import SyncSourceRepository, NodeSyncRepository
        from src.collaboration.service import CollaborationService
        from src.collaboration.lock_service import LockService
        from src.collaboration.conflict_service import ConflictService
        from src.collaboration.version_service import VersionService as CollabVersionService
        from src.collaboration.version_repository import FileVersionRepository, FolderSnapshotRepository
        from src.collaboration.audit_service import AuditService
        from src.collaboration.audit_repository import AuditRepository
        from src.content_node.repository import ContentNodeRepository
        from src.content_node.service import ContentNodeService
        from src.s3.service import S3Service
        from src.supabase.client import SupabaseClient

        supabase = SupabaseClient()
        node_repo = ContentNodeRepository(supabase)
        s3_service = S3Service()
        version_svc = CollabVersionService(
            node_repo=node_repo,
            version_repo=FileVersionRepository(supabase),
            snapshot_repo=FolderSnapshotRepository(supabase),
            s3_service=s3_service,
        )
        node_svc = ContentNodeService(repo=node_repo, s3_service=s3_service, version_service=version_svc)

        collab_svc = CollaborationService(
            node_repo=node_repo,
            lock_service=LockService(node_repo),
            conflict_service=ConflictService(),
            version_service=version_svc,
            audit_service=AuditService(audit_repo=AuditRepository(supabase)),
        )

        source_repo = SyncSourceRepository(supabase)
        node_sync_repo = NodeSyncRepository(supabase)

        folder_source = FolderSourceService(
            node_service=node_svc,
            source_repo=source_repo,
            node_sync_repo=node_sync_repo,
        )
        await folder_source.start()

        folder_access = FolderAccessService(
            collab_service=collab_svc,
            node_service=node_svc,
            source_repo=source_repo,
            node_sync_repo=node_sync_repo,
        )
        await folder_access.start()

        sync_duration = time.time() - sync_init_start
        log_info(f"✅ Folder Sync Services 启动成功 (耗时: {sync_duration * 1000:.2f}ms)")
    except Exception as e:
        sync_duration = time.time() - sync_init_start
        log_error(f"❌ Folder Sync Services 启动失败 (耗时: {sync_duration * 1000:.2f}ms): {e}")

    # 输出总启动时间
    total_startup_time = time.time() - APP_START_TIME
    log_info("")
    log_info("=" * 80)
    log_info(
        f"✨ ContextBase API 启动完成! 总耗时: {total_startup_time * 1000:.2f}ms ({total_startup_time:.3f}s)"
    )
    log_info("=" * 80)
    log_info("")

    yield
    # 关闭时的清理逻辑
    log_info("ContextBase API 关闭中...")

    # 停止 Scheduler 服务
    if scheduler_settings.enabled:
        try:
            scheduler_service = get_scheduler_service()
            await scheduler_service.shutdown()
            log_info("Scheduler service stopped successfully")
        except Exception as e:
            log_error(f"Failed to stop Scheduler service: {e}")

    # 停止 Folder Sync Services
    try:
        from src.sync.handlers.folder_source import FolderSourceService
        from src.access.openclaw.folder_access import FolderAccessService
        fs = FolderSourceService.get_instance()
        if fs:
            await fs.stop()
        fa = FolderAccessService.get_instance()
        if fa:
            await fa.stop()
        log_info("Folder Sync Services stopped successfully")
    except Exception as e:
        log_error(f"Failed to stop Folder Sync Services: {e}")

    # 停止 File Ingest 服务
    if settings.etl_enabled:
        try:
            from src.upload.file.dependencies import get_etl_service

            file_ingest_service = await get_etl_service()
            await file_ingest_service.stop()
            log_info("File Ingest service stopped successfully")
        except Exception as e:
            log_error(f"Failed to stop File Ingest service: {e}")


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

    # Request context + access log（X-Request-Id / latency / status_code）
    from src.utils.middleware import RequestContextMiddleware

    app.add_middleware(RequestContextMiddleware)

    # 注册路由
    router_register_start = time.time()
    app.include_router(table_router, prefix="/api/v1", tags=["tables"])
    app.include_router(tool_router, prefix="/api/v1", tags=["tools"])
    app.include_router(mcp_v3_router, prefix="/api/v1", tags=["mcp"])
    app.include_router(agent_router, prefix="/api/v1", tags=["agents"])
    app.include_router(agent_config_router, prefix="/api/v1", tags=["agent-config"])
    app.include_router(context_publish_router, prefix="/api/v1", tags=["publishes"])
    # public short link: /p/{publish_key}
    app.include_router(context_publish_public_router, tags=["publishes"])
    
    # Unified ingest router (file + SaaS imports)
    app.include_router(ingest_router, prefix="/api/v1", tags=["ingest"])
    
    app.include_router(project_router, prefix="/api/v1", tags=["projects"])
    app.include_router(oauth_router, prefix="/api/v1", tags=["oauth"])
    app.include_router(
        internal_router, tags=["internal"]
    )  # Internal API不加/api/v1前缀
    app.include_router(content_node_router, prefix="/api/v1", tags=["content-nodes"])
    from src.content_node.version_router import router as version_router
    app.include_router(version_router, prefix="/api/v1", tags=["content-node-versions"])
    from src.collaboration.router import router as collab_router
    app.include_router(collab_router, prefix="/api/v1", tags=["collaboration"])
    from src.workspace.router import router as workspace_router
    app.include_router(workspace_router, prefix="/api/v1", tags=["workspace"])
    from src.sync.router import router as sync_router
    app.include_router(sync_router, prefix="/api/v1", tags=["sync"])
    from src.access.openclaw.router import router as openclaw_router
    app.include_router(openclaw_router, tags=["access-openclaw"])
    from src.auth.router import router as auth_router
    app.include_router(auth_router, prefix="/api/v1", tags=["auth"])
    app.include_router(analytics_router, tags=["analytics"])
    app.include_router(profile_router, tags=["profile"])
    app.include_router(db_connector_router, prefix="/api/v1", tags=["db-connector"])
    router_register_duration = time.time() - router_register_start

    # 注册异常处理器
    exception_handler_start = time.time()
    app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    exception_handler_duration = time.time() - exception_handler_start

    app_create_duration = time.time() - app_create_start

    # 统一用日志输出（已在文件顶部 setup_logging）
    log_info("⚙️  FastAPI 应用创建耗时统计:")
    log_info(f"  ├─ FastAPI 实例化: {fastapi_duration * 1000:.2f}ms")
    log_info(f"  ├─ CORS 中间件配置: {cors_duration * 1000:.2f}ms")
    log_info(f"  ├─ 路由注册: {router_register_duration * 1000:.2f}ms")
    log_info(f"  └─ 异常处理器注册: {exception_handler_duration * 1000:.2f}ms")
    log_info(f"📦 应用创建总耗时: {app_create_duration * 1000:.2f}ms")
    log_info("")

    return app


# 创建应用实例
app = create_app()


async def _build_readiness_report(mcp_service) -> dict:
    import os

    env_status = {
        "supabase_configured": bool(
            os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY")
        ),
        "s3_configured": bool(os.getenv("S3_BUCKET_NAME")),
        "mineru_configured": bool(os.getenv("MINERU_API_KEY")),
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
        "e2b_configured": bool(os.getenv("E2B_API_KEY")),
        "internal_api_secret_configured": bool(
            (settings.INTERNAL_API_SECRET or "").strip()
        ),
    }

    config_errors: list[str] = []
    dependency_errors: list[str] = []

    if not settings.DEBUG and not env_status["internal_api_secret_configured"]:
        config_errors.append("INTERNAL_API_SECRET is empty while DEBUG is False")

    try:
        mcp_status = await mcp_service.check_mcp_server_health()
    except Exception as e:
        mcp_status = {"status": "unhealthy", "error": str(e)}

    mcp_state = str(mcp_status.get("status", "")).strip().lower()
    if mcp_state in {"", "unhealthy", "error", "down", "unavailable"}:
        dependency_errors.append("MCP server is unhealthy")

    if config_errors:
        status = "unhealthy"
    elif dependency_errors:
        status = "degraded"
    else:
        status = "ready"

    return {
        "status": status,
        "service": "ContextBase API",
        "version": settings.VERSION,
        "environment": env_status,
        "mcp_status": mcp_status,
        "errors": {
            "config": config_errors,
            "dependencies": dependency_errors,
        },
    }


@app.get("/live")
async def live_check():
    """Liveness: 仅表示进程存活。"""
    return {
        "status": "alive",
        "service": "ContextBase API",
        "version": settings.VERSION,
    }


@app.get("/ready")
async def ready_check(
    response: Response,
    mcp_service=Depends(get_mcp_instance_service),
):
    """Readiness: 表示服务是否可接收流量。"""
    report = await _build_readiness_report(mcp_service)
    if report["status"] != "ready":
        response.status_code = 503
    return report


@app.get("/health")
async def health_check(
    response: Response,
    mcp_service=Depends(get_mcp_instance_service),
):
    """兼容入口：返回 readiness 结果。"""
    report = await _build_readiness_report(mcp_service)
    if report["status"] != "ready":
        response.status_code = 503
    return report


# 启动命令示例:
# uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log
