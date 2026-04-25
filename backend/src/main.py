"""
ContextBase Backend Server Entrypoint.
"""

# ruff: noqa: E402

import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.infra.mcp_server.dependencies import get_mcp_instance_service

# Record application start time
APP_START_TIME = time.time()

# Load .env file (for local development only; production uses system environment variables directly)
from dotenv import load_dotenv

dotenv_start = time.time()
load_dotenv(override=True)
dotenv_duration = time.time() - dotenv_start

# Initialize Loguru + intercept standard logging (including uvicorn.*)
from src.utils.logging_setup import setup_logging

setup_logging()

# Record module import times
config_start = time.time()
from src.config import settings

config_duration = time.time() - config_start

exceptions_start = time.time()
from src.exception_handler import (
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from src.exceptions import AppException

exceptions_duration = time.time() - exceptions_start

logger_start = time.time()
from src.utils.logger import log_error, log_info

logger_duration = time.time() - logger_start

# Record router module import times
table_router_start = time.time()
from src.content.table.router import router as table_router

table_router_duration = time.time() - table_router_start

tool_router_start = time.time()
from src.tool.router import router as tool_router

tool_router_duration = time.time() - tool_router_start

mcp_v3_router_start = time.time()
from src.connectors.agent.mcp.router import router as mcp_v3_router

mcp_v3_router_duration = time.time() - mcp_v3_router_start

agent_router_start = time.time()
from src.connectors.agent.config.router import router as agent_config_router
from src.connectors.agent.router import router as agent_router

agent_router_duration = time.time() - agent_router_start

context_publish_router_start = time.time()
from src.context_publish.router import public_router as context_publish_public_router
from src.context_publish.router import router as context_publish_router

context_publish_router_duration = time.time() - context_publish_router_start

# Unified ingest router (file + SaaS imports)
ingest_router_start = time.time()
from src.ingest.router import router as ingest_router

ingest_router_duration = time.time() - ingest_router_start

project_router_start = time.time()
from src.platform.project.router import router as project_router

project_router_duration = time.time() - project_router_start

from src.platform.organization.router import router as organization_router

oauth_router_start = time.time()
from src.connectors.datasource.oauth.router import router as oauth_router

oauth_router_duration = time.time() - oauth_router_start

internal_router_start = time.time()
from src.internal.router import router as internal_router

internal_router_duration = time.time() - internal_router_start

content_router_start = time.time()

content_router_duration = time.time() - content_router_start

analytics_router_start = time.time()
from src.platform.analytics.router import router as analytics_router

analytics_router_duration = time.time() - analytics_router_start

profile_router_start = time.time()
from src.platform.profile.router import router as profile_router

profile_router_duration = time.time() - profile_router_start

db_connector_router_start = time.time()
from src.connectors.database.router import router as db_connector_router

db_connector_router_duration = time.time() - db_connector_router_start

# Scheduler service import
scheduler_start = time.time()
from src.infra.scheduler.config import scheduler_settings
from src.infra.scheduler.service import get_scheduler_service

scheduler_import_duration = time.time() - scheduler_start



def _validate_security_baseline() -> None:
    """Validate critical security configuration in non-development environments."""
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
    + content_router_duration
    + analytics_router_duration
    + profile_router_duration
    + db_connector_router_duration
)


def _log_import_times() -> None:
    """Output module import time breakdown."""
    log_info("📦 Module import time breakdown:")
    log_info(f"  ├─ .env loading: {dotenv_duration * 1000:.2f}ms")
    log_info(f"  ├─ Config module (config): {config_duration * 1000:.2f}ms")
    log_info(f"  ├─ Exception handling module (exceptions): {exceptions_duration * 1000:.2f}ms")
    log_info(f"  ├─ Logging module (logger): {logger_duration * 1000:.2f}ms")
    log_info("  ├─ Router modules:")
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
    log_info(f"  │  └─ content_router: {content_router_duration * 1000:.2f}ms")
    log_info(f"  └─ Total router time: {routers_duration * 1000:.2f}ms")
    log_info(f"📊 Total import time: {(time.time() - APP_START_TIME) * 1000:.2f}ms")
    log_info("")


async def _init_mcp_health_check() -> None:
    """Check MCP Server health status."""
    mcp_init_start = time.time()
    try:
        log_info("🔌 Checking MCP Server health status...")
        from src.infra.mcp_server.dependencies import get_mcp_instance_service

        mcp_service = get_mcp_instance_service()
        health_result = await mcp_service.check_mcp_server_health()
        mcp_duration = time.time() - mcp_init_start
        if health_result.get("status", "") != "unhealthy":
            log_info(
                f"✅ MCP Server health check completed: {health_result} (took: {mcp_duration * 1000:.2f}ms)"
            )
        else:
            log_error(f"❌ MCP Server is down, health info: {health_result}")
    except Exception as e:
        mcp_duration = time.time() - mcp_init_start
        log_error(
            f"❌ MCP Server health check failed (took: {mcp_duration * 1000:.2f}ms): {e}"
        )


async def _init_scheduler() -> None:
    """Initialize Scheduler service."""
    scheduler_init_start = time.time()
    try:
        if scheduler_settings.enabled:
            log_info("⏰ Initializing Scheduler service...")
            scheduler_service = get_scheduler_service()
            await scheduler_service.start()
            scheduler_duration = time.time() - scheduler_init_start
            log_info(f"✅ Scheduler service started successfully (took: {scheduler_duration * 1000:.2f}ms)")
        else:
            log_info("⏭️  Scheduler service skipped (SCHEDULER_ENABLED is off)")
    except Exception as e:
        scheduler_duration = time.time() - scheduler_init_start
        log_error(f"❌ Scheduler service failed to start (took: {scheduler_duration * 1000:.2f}ms): {e}")


async def _init_file_ingest() -> None:
    """Initialize File Ingest service if ETL is enabled."""
    if not settings.etl_enabled:
        log_info("⏭️  File Ingest service skipped (ENABLE_ETL is off)")
        return
    file_ingest_init_start = time.time()
    try:
        log_info("📄 Initializing File Ingest service...")
        from pathlib import Path

        from src.ingest.file.dependencies import get_etl_service

        file_ingest_service = await get_etl_service()
        Path(".mineru_cache").mkdir(parents=True, exist_ok=True)
        Path(".etl_rules").mkdir(parents=True, exist_ok=True)
        await file_ingest_service.start()
        file_ingest_duration = time.time() - file_ingest_init_start
        log_info(f"✅ File Ingest service started successfully (took: {file_ingest_duration * 1000:.2f}ms)")
        if settings.DEBUG:
            log_info("   ℹ️  File workers started in DEBUG mode (for development testing)")
    except Exception as e:
        file_ingest_duration = time.time() - file_ingest_init_start
        log_error(f"❌ File Ingest service failed to start (took: {file_ingest_duration * 1000:.2f}ms): {e}")


def _init_connector_registry() -> None:
    """Initialize ConnectorRegistry singleton."""
    registry_init_start = time.time()
    try:
        log_info("🔌 Initializing ConnectorRegistry...")
        from src.connectors.datasource.dependencies import init_registry
        init_registry()
        registry_duration = time.time() - registry_init_start
        log_info(f"✅ ConnectorRegistry initialized successfully (took: {registry_duration * 1000:.2f}ms)")
    except Exception as e:
        registry_duration = time.time() - registry_init_start
        log_error(f"❌ ConnectorRegistry initialization failed (took: {registry_duration * 1000:.2f}ms): {e}")


async def _init_mut_trees() -> None:
    """Auto-initialize empty Mut tree for all projects with empty mut_root_hash."""
    mut_init_start = time.time()
    try:
        log_info("🌳 Checking and initializing Mut tree...")
        from src.infra.supabase.client import SupabaseClient as _SC
        from src.mut_engine.dependencies import create_mut_admin_service as _cms

        _sb = _SC()
        resp = (
            _sb.client.table("projects")
            .select("id")
            .or_("mut_root_hash.is.null,mut_root_hash.eq.")
            .execute()
        )
        uninit_projects = resp.data or []
        if uninit_projects:
            _writer = _cms()
            for row in uninit_projects:
                try:
                    await _writer.init_tree(row["id"])
                except Exception as init_err:
                    log_error(f"  ❌ Failed to init Mut tree for {row['id']}: {init_err}")
            log_info(f"  ✅ Initialized Mut tree for {len(uninit_projects)} project(s)")
        else:
            log_info("  ✅ All projects already have Mut tree")
        mut_init_duration = time.time() - mut_init_start
        log_info(f"✅ Mut tree check completed (took: {mut_init_duration * 1000:.2f}ms)")
    except Exception as e:
        mut_init_duration = time.time() - mut_init_start
        log_error(f"❌ Mut tree initialization failed (took: {mut_init_duration * 1000:.2f}ms): {e}")


async def _shutdown_services() -> None:
    """Shutdown cleanup logic."""
    log_info("ContextBase API shutting down...")

    if scheduler_settings.enabled:
        try:
            scheduler_service = get_scheduler_service()
            await scheduler_service.shutdown()
            log_info("Scheduler service stopped successfully")
        except Exception as e:
            log_error(f"Failed to stop Scheduler service: {e}")

    log_info("Filesystem sync: client-side, no cleanup needed")

    if settings.etl_enabled:
        try:
            from src.ingest.file.dependencies import get_etl_service

            file_ingest_service = await get_etl_service()
            await file_ingest_service.stop()
            log_info("File Ingest service stopped successfully")
        except Exception as e:
            log_error(f"Failed to stop File Ingest service: {e}")


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    """
    FastAPI application lifecycle management.

    Database connections, caches, and other resources can be initialized here.
    """
    log_info("=" * 80)
    log_info("🚀 ContextBase API starting...")
    log_info("=" * 80)

    _log_import_times()

    await _init_mcp_health_check()
    await _init_scheduler()
    await _init_file_ingest()
    _init_connector_registry()
    await _init_mut_trees()

    log_info("📁 Filesystem sync: client-side via MUT protocol (no server init needed)")

    total_startup_time = time.time() - APP_START_TIME
    log_info("")
    log_info("=" * 80)
    log_info(
        f"✨ ContextBase API startup complete! Total time: {total_startup_time * 1000:.2f}ms ({total_startup_time:.3f}s)"
    )
    log_info("=" * 80)
    log_info("")

    yield
    await _shutdown_services()


def create_app() -> FastAPI:
    """Create FastAPI application instance."""
    app_create_start = time.time()

    # Initialize FastAPI application
    fastapi_start = time.time()
    app = FastAPI(
        title="ContextBase API",
        description="Hostable context configuration and export platform",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=app_lifespan,
    )
    fastapi_duration = time.time() - fastapi_start

    # Configure CORS middleware
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

    # Register routes
    router_register_start = time.time()
    app.include_router(table_router, prefix="/api/v1", tags=["tables"])
    app.include_router(tool_router, prefix="/api/v1", tags=["tools"])
    app.include_router(mcp_v3_router, prefix="/api/v1", tags=["mcp"])
    app.include_router(agent_router, prefix="/api/v1", tags=["agents"])
    app.include_router(agent_config_router, prefix="/api/v1", tags=["agent-config"])
    from src.connectors.agent.chat.router import router as chat_router
    app.include_router(chat_router, prefix="/api/v1", tags=["chat"])
    app.include_router(context_publish_router, prefix="/api/v1", tags=["publishes"])
    # public short link: /p/{publish_key}
    app.include_router(context_publish_public_router, tags=["publishes"])

    # Unified ingest router (file + SaaS imports)
    app.include_router(ingest_router, prefix="/api/v1", tags=["ingest"])

    app.include_router(project_router, prefix="/api/v1", tags=["projects"])
    app.include_router(oauth_router, prefix="/api/v1", tags=["oauth"])
    app.include_router(
        internal_router, tags=["internal"]
    )  # Internal API does not use /api/v1 prefix
    from src.mut_engine.routers.content_router import router as content_router
    app.include_router(content_router, prefix="/api/v1", tags=["content"])
    from src.mut_engine.routers.audit_router import router as audit_router
    app.include_router(audit_router, prefix="/api/v1", tags=["audit-logs"])
    from src.mut_engine.routers.protocol_router import router as mut_protocol_router
    app.include_router(mut_protocol_router, tags=["mut-protocol"])
    from src.mut_engine.routers.access_point import ap_router
    # Canonical public URL: /api/v1/mut/ap/{access_key}/{clone|push|pull|negotiate|...}
    # See backend/src/mut_engine/_routes.py for the contract.
    app.include_router(ap_router, prefix="/api/v1", tags=["access-point"])
    # Backward-compat: mut clients <= v0.1.6 hit /mut/ap/* directly. Mounting
    # the same router again under the legacy prefix keeps them working without
    # a forced upgrade. Remove once telemetry shows < 1% legacy traffic.
    app.include_router(
        ap_router, tags=["access-point-legacy"], include_in_schema=False
    )
    from src.platform.workspace.router import router as workspace_router
    app.include_router(workspace_router, prefix="/api/v1", tags=["workspace"])
    from src.connectors.datasource.router import router as sync_router
    app.include_router(sync_router, prefix="/api/v1", tags=["sync"])
    from src.connectors.filesystem.router import router as filesystem_router
    app.include_router(filesystem_router, tags=["filesystem"])
    from src.platform.auth.router import router as auth_router
    app.include_router(auth_router, prefix="/api/v1", tags=["auth"])
    app.include_router(analytics_router, tags=["analytics"])
    app.include_router(profile_router, tags=["profile"])
    app.include_router(db_connector_router, prefix="/api/v1", tags=["db-connector"])
    app.include_router(organization_router, prefix="/api/v1", tags=["organizations"])
    from src.connectors.mcp_endpoint.router import router as mcp_endpoint_router
    app.include_router(mcp_endpoint_router, prefix="/api/v1", tags=["mcp-endpoints"])
    from src.connectors.sandbox_endpoint.router import router as sandbox_endpoint_router
    app.include_router(sandbox_endpoint_router, prefix="/api/v1", tags=["sandbox-endpoints"])
    from src.platform.project.dashboard_router import router as dashboard_router
    app.include_router(dashboard_router, prefix="/api/v1", tags=["projects"])
    from src.connectors.manager.router import router as access_router
    app.include_router(access_router, prefix="/api/v1", tags=["access"])
    from src.connectors.gateway.router import router as gateway_router
    app.include_router(gateway_router, prefix="/api/v1", tags=["gateways"])
    router_register_duration = time.time() - router_register_start

    # Register exception handlers
    exception_handler_start = time.time()
    app.add_exception_handler(AppException, app_exception_handler)  # type: ignore
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, generic_exception_handler)  # type: ignore
    exception_handler_duration = time.time() - exception_handler_start

    app_create_duration = time.time() - app_create_start

    # Unified logging output (setup_logging already called at top of file)
    log_info("⚙️  FastAPI app creation time breakdown:")
    log_info(f"  ├─ FastAPI instantiation: {fastapi_duration * 1000:.2f}ms")
    log_info(f"  ├─ CORS middleware config: {cors_duration * 1000:.2f}ms")
    log_info(f"  ├─ Route registration: {router_register_duration * 1000:.2f}ms")
    log_info(f"  └─ Exception handler registration: {exception_handler_duration * 1000:.2f}ms")
    log_info(f"📦 Total app creation time: {app_create_duration * 1000:.2f}ms")
    log_info("")

    return app


# Create application instance
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

    # Cache MCP health check to avoid blocking every /health call (~12s timeout)
    import time as _time
    _now = _time.time()
    if not hasattr(_build_readiness_report, "_mcp_cache") or _now - _build_readiness_report._mcp_cache_time > 60:
        try:
            mcp_status = await mcp_service.check_mcp_server_health()
        except Exception as e:
            mcp_status = {"status": "unhealthy", "error": str(e)}
        _build_readiness_report._mcp_cache = mcp_status
        _build_readiness_report._mcp_cache_time = _now
    else:
        mcp_status = _build_readiness_report._mcp_cache

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
    """Liveness: only indicates the process is alive."""
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
    """Readiness: indicates whether the service can accept traffic."""
    report = await _build_readiness_report(mcp_service)
    if report["status"] != "ready":
        response.status_code = 503
    return report


@app.get("/health")
async def health_check(
    response: Response,
):
    """Fast health check — skips slow MCP probe to avoid blocking traffic."""
    report = {
        "status": "ready",
        "service": "ContextBase API",
        "version": settings.VERSION,
    }
    if report["status"] != "ready":
        response.status_code = 503
    return report


# Startup command example:
# uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log
