"""
Sync Module — Dependency injection.

Provides:
  - ConnectorRegistry (application-level singleton, built once at startup)
  - SyncEngine (unified execution engine)
  - SyncService (lifecycle + bootstrap + push)
"""

from typing import Optional

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.sync.registry import ConnectorRegistry
from src.sync.engine import SyncEngine
from src.sync.repository import SyncRepository
from src.sync.service import SyncService
from src.filesystem.watcher import FolderSourceService
from src.collaboration.dependencies import get_collaboration_service
from src.collaboration.service import CollaborationService
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.utils.logger import log_info, log_error


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


# ============================================================
# Registry: application-level singleton
# ============================================================

_registry_instance: Optional[ConnectorRegistry] = None


def _build_registry(node_service: ContentNodeService) -> ConnectorRegistry:
    """
    Build a ConnectorRegistry with all available connectors and
    their corresponding OAuth services.
    """
    from src.s3.service import S3Service

    registry = ConnectorRegistry()
    s3 = S3Service()

    # --- Gmail ---
    try:
        from src.sync.connectors.gmail.connector import GmailConnector
        from src.oauth.gmail_service import GmailOAuthService
        gmail_oauth = GmailOAuthService()
        registry.register(GmailConnector(
            node_service=node_service,
            gmail_service=gmail_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("gmail", gmail_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register Gmail: {e}")

    # --- GitHub ---
    try:
        from src.sync.connectors.github.connector import GithubConnector
        from src.oauth.github_service import GithubOAuthService
        github_oauth = GithubOAuthService()
        registry.register(GithubConnector(
            node_service=node_service,
            github_service=github_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("github", github_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register GitHub: {e}")

    # --- Google Drive ---
    try:
        from src.sync.connectors.google_drive.connector import GoogleDriveConnector
        from src.oauth.google_drive_service import GoogleDriveOAuthService
        drive_oauth = GoogleDriveOAuthService()
        registry.register(GoogleDriveConnector(
            node_service=node_service,
            drive_service=drive_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("drive", drive_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register Google Drive: {e}")

    # --- Google Docs ---
    try:
        from src.sync.connectors.google_docs.connector import GoogleDocsConnector
        from src.oauth.google_docs_service import GoogleDocsOAuthService
        docs_oauth = GoogleDocsOAuthService()
        registry.register(GoogleDocsConnector(
            node_service=node_service,
            docs_service=docs_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("docs", docs_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register Google Docs: {e}")

    # --- Google Sheets ---
    try:
        from src.sync.connectors.google_sheets.connector import GoogleSheetsConnector
        from src.oauth.google_sheets_service import GoogleSheetsOAuthService
        sheets_oauth = GoogleSheetsOAuthService()
        registry.register(GoogleSheetsConnector(
            node_service=node_service,
            sheets_service=sheets_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("sheets", sheets_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register Google Sheets: {e}")

    # --- Google Calendar ---
    try:
        from src.sync.connectors.google_calendar.connector import GoogleCalendarConnector
        from src.oauth.google_calendar_service import GoogleCalendarOAuthService
        calendar_oauth = GoogleCalendarOAuthService()
        registry.register(GoogleCalendarConnector(
            node_service=node_service,
            calendar_service=calendar_oauth,
            s3_service=s3,
        ))
        registry.register_oauth("calendar", calendar_oauth)
    except Exception as e:
        log_error(f"[Registry] Failed to register Google Calendar: {e}")

    # --- Filesystem / OpenClaw (bidirectional, access-key auth) ---
    try:
        from src.sync.connectors.filesystem.connector import OpenClawConnector
        registry.register(OpenClawConnector())
    except Exception as e:
        log_error(f"[Registry] Failed to register Filesystem: {e}")

    # --- URL (no OAuth) ---
    try:
        from src.sync.connectors.url.connector import UrlConnector
        registry.register(UrlConnector(node_service=node_service))
    except Exception as e:
        log_error(f"[Registry] Failed to register URL: {e}")

    # --- Google Search Console (OAuth) ---
    try:
        from src.sync.connectors.google_search_console.connector import GoogleSearchConsoleConnector
        registry.register(GoogleSearchConsoleConnector())
    except Exception as e:
        log_error(f"[Registry] Failed to register Google Search Console: {e}")

    return registry


def init_registry() -> ConnectorRegistry:
    """
    Initialize the application-level ConnectorRegistry singleton.
    Called once during app startup (app_lifespan).
    """
    global _registry_instance

    from src.content_node.repository import ContentNodeRepository
    from src.s3.service import S3Service

    supabase = SupabaseClient()
    node_service = ContentNodeService(
        repo=ContentNodeRepository(supabase),
        s3_service=S3Service(),
    )

    _registry_instance = _build_registry(node_service)
    log_info(f"[Registry] Initialized with {len(_registry_instance.providers())} connectors: {_registry_instance.providers()}")
    return _registry_instance


# ============================================================
# FastAPI dependency providers
# ============================================================

def get_connector_registry() -> ConnectorRegistry:
    """Return the singleton registry. Falls back to building one if not initialized."""
    if _registry_instance is not None:
        return _registry_instance
    return init_registry()


def get_sync_engine(
    registry: ConnectorRegistry = Depends(get_connector_registry),
    collab_service: CollaborationService = Depends(get_collaboration_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncEngine:
    from src.sync.run_repository import SyncRunRepository
    return SyncEngine(
        registry=registry,
        collab_service=collab_service,
        sync_repo=SyncRepository(supabase),
        run_repo=SyncRunRepository(supabase),
    )


def get_sync_service(
    collab_service: CollaborationService = Depends(get_collaboration_service),
    registry: ConnectorRegistry = Depends(get_connector_registry),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncService:
    """SyncService still handles lifecycle, bootstrap, and push."""
    svc = SyncService(
        collab_service=collab_service,
        sync_repo=SyncRepository(supabase),
    )
    for provider in registry.providers():
        connector = registry.get(provider)
        if connector:
            svc.register_connector(connector)
    return svc


def get_folder_source_service(
    node_service: ContentNodeService = Depends(get_content_node_service),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> FolderSourceService:
    return FolderSourceService(
        node_service=node_service,
        sync_repo=SyncRepository(supabase),
    )


# ============================================================
# Standalone factory (for scheduler jobs, ARQ workers)
# ============================================================

def create_sync_engine() -> SyncEngine:
    """
    Build a SyncEngine outside of FastAPI request context.
    Used by scheduler jobs and ARQ workers.
    Reuses the singleton registry if available.
    """
    from src.collaboration.dependencies import create_collaboration_service

    from src.sync.run_repository import SyncRunRepository

    registry = get_connector_registry()
    collab_service = create_collaboration_service()
    supabase = SupabaseClient()
    sync_repo = SyncRepository(supabase)

    return SyncEngine(
        registry=registry,
        collab_service=collab_service,
        sync_repo=sync_repo,
        run_repo=SyncRunRepository(supabase),
    )
