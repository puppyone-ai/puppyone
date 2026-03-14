"""
Sync Module — Dependency injection.

Provides:
  - ConnectorRegistry (application-level singleton, built once at startup)
  - SyncEngine (unified execution engine)
  - SyncService (lifecycle + bootstrap + push)

Adding a new connector:
  1. Create  datasource/<provider>/connector.py  with a BaseConnector subclass
  2. Add the class to CONNECTOR_CLASSES in  datasource/__init__.py
  3. If OAuth, add an entry to OAUTH_SERVICE_MAP below
  That's it — the registry auto-discovers the rest from ConnectorSpec.
"""

from __future__ import annotations

import inspect
from typing import Any, Optional

from fastapi import Depends
from src.supabase.client import SupabaseClient
from src.connectors.datasource._base import AuthRequirement, BaseConnector
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.engine import SyncEngine
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.service import SyncService
from src.connectors.filesystem.watcher import FolderSourceService
from src.collaboration.dependencies import get_collaboration_service
from src.collaboration.service import CollaborationService
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.utils.logger import log_info, log_error


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


# ============================================================
# OAuth service mapping: oauth_type → (module_path, class_name)
# ============================================================

OAUTH_SERVICE_MAP: dict[str, tuple[str, str]] = {
    "gmail":                  ("src.oauth.gmail_service",           "GmailOAuthService"),
    "github":                 ("src.oauth.github_service",          "GithubOAuthService"),
    "drive":                  ("src.oauth.google_drive_service",    "GoogleDriveOAuthService"),
    "docs":                   ("src.oauth.google_docs_service",     "GoogleDocsOAuthService"),
    "sheets":                 ("src.oauth.google_sheets_service",   "GoogleSheetsOAuthService"),
    "calendar":               ("src.oauth.google_calendar_service", "GoogleCalendarOAuthService"),
}


# ============================================================
# Registry: application-level singleton
# ============================================================

_registry_instance: Optional[ConnectorRegistry] = None


def _resolve_oauth_service(oauth_type: str) -> Any | None:
    """Lazily import and instantiate an OAuth service by oauth_type."""
    entry = OAUTH_SERVICE_MAP.get(oauth_type)
    if not entry:
        return None
    module_path, class_name = entry
    import importlib
    mod = importlib.import_module(module_path)
    cls = getattr(mod, class_name)
    return cls()


def _instantiate_connector(
    cls: type[BaseConnector],
    *,
    node_service: ContentNodeService,
    s3_service: Any,
    oauth_services: dict[str, Any],
) -> BaseConnector:
    """
    Instantiate a connector by introspecting its __init__ signature.

    Connectors follow one of three patterns:
      - OAuth connectors: (node_service, <oauth_service>, s3_service)
      - Simple connectors: (node_service) or ()
    """
    sig = inspect.signature(cls.__init__)
    params = list(sig.parameters.keys())
    params = [p for p in params if p != "self"]

    if not params:
        return cls()

    kwargs: dict[str, Any] = {}
    for name in params:
        if name == "node_service":
            kwargs[name] = node_service
        elif name == "s3_service":
            kwargs[name] = s3_service
        elif name.endswith("_service"):
            # Match an OAuth service by looking up the connector's oauth_type
            temp = cls.__new__(cls)
            oauth_type = temp.spec().oauth_type
            if oauth_type and oauth_type in oauth_services:
                kwargs[name] = oauth_services[oauth_type]

    return cls(**kwargs)


def _build_registry(node_service: ContentNodeService) -> ConnectorRegistry:
    """
    Build a ConnectorRegistry by iterating CONNECTOR_CLASSES.
    OAuth services are resolved via OAUTH_SERVICE_MAP.
    """
    from src.s3.service import S3Service
    from src.connectors.datasource import CONNECTOR_CLASSES

    registry = ConnectorRegistry()
    s3 = S3Service()

    oauth_services: dict[str, Any] = {}
    for oauth_type in OAUTH_SERVICE_MAP:
        try:
            svc = _resolve_oauth_service(oauth_type)
            if svc:
                oauth_services[oauth_type] = svc
        except Exception as e:
            log_error(f"[Registry] Failed to load OAuth service '{oauth_type}': {e}")

    for cls in CONNECTOR_CLASSES:
        try:
            connector = _instantiate_connector(
                cls,
                node_service=node_service,
                s3_service=s3,
                oauth_services=oauth_services,
            )
            registry.register(connector)

            spec = connector.spec()
            if spec.oauth_type and spec.oauth_type in oauth_services:
                registry.register_oauth(spec.oauth_type, oauth_services[spec.oauth_type])
        except Exception as e:
            log_error(f"[Registry] Failed to register {cls.__name__}: {e}")

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
    from src.connectors.datasource.run_repository import SyncRunRepository
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

    from src.connectors.datasource.run_repository import SyncRunRepository

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
