"""
Sync Module — Dependency injection.

Provides:
  - ConnectorRegistry (application-level singleton, built once at startup)
  - SyncEngine (unified execution engine)
  - SyncService (lifecycle + bootstrap + push)

Adding a new connector:
  1. Create  datasource/<provider>/connector.py  with a BaseConnector subclass
  2. Add a  setup(deps) -> ConnectorSetup  function in that file
  That's it — the registry auto-discovers everything at startup.
"""

from __future__ import annotations

import importlib
import pathlib
from typing import Optional

from fastapi import Depends
from src.infra.supabase.client import SupabaseClient
from src.connectors.datasource._base import ConnectorDeps, ConnectorSetup
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.engine import SyncEngine
from src.connectors.datasource.repository import SyncRepository
from src.connectors.datasource.service import SyncService
from src.utils.logger import log_info, log_error


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


# ============================================================
# Auto-discovery: scan connector directories for setup()
# ============================================================

_SCAN_PATHS: list[tuple[str, str]] = [
    ("connectors/datasource", "src.connectors.datasource"),
    ("connectors/filesystem", "src.connectors.filesystem"),
]


def _discover_connectors(deps: ConnectorDeps) -> list[ConnectorSetup]:
    """
    Scan connector directories for modules with a setup(deps) function.
    Each connector.py that exports setup() is called to produce a ConnectorSetup.
    """
    src_dir = pathlib.Path(__file__).resolve().parent.parent.parent  # backend/src/
    setups: list[ConnectorSetup] = []

    for rel_path, module_prefix in _SCAN_PATHS:
        scan_dir = src_dir / rel_path
        if not scan_dir.is_dir():
            continue

        for child in sorted(scan_dir.iterdir()):
            connector_file = child / "connector.py" if child.is_dir() else None

            if child.name == "connector.py" and not child.is_dir():
                connector_file = child

            if connector_file is None or not connector_file.exists():
                continue

            if child.is_dir():
                module_name = f"{module_prefix}.{child.name}.connector"
            else:
                module_name = f"{module_prefix}.connector"

            try:
                mod = importlib.import_module(module_name)
                setup_fn = getattr(mod, "setup", None)
                if setup_fn is None:
                    continue
                result = setup_fn(deps)
                setups.append(result)
                log_info(f"[Registry] Discovered connector: {result.connector.spec().provider}")
            except Exception as e:
                log_error(f"[Registry] Failed to load {module_name}: {e}")

    return setups


# ============================================================
# Registry: application-level singleton
# ============================================================

_registry_instance: Optional[ConnectorRegistry] = None


def _build_registry() -> ConnectorRegistry:
    """Build a ConnectorRegistry by auto-discovering connector modules."""
    from src.infra.s3.service import S3Service

    registry = ConnectorRegistry()
    deps = ConnectorDeps(s3_service=S3Service())

    for setup_result in _discover_connectors(deps):
        try:
            registry.register(setup_result.connector)
            for oauth_type, oauth_svc in setup_result.oauth_bindings.items():
                registry.register_oauth(oauth_type, oauth_svc)
        except Exception as e:
            provider = setup_result.connector.spec().provider
            log_error(f"[Registry] Failed to register {provider}: {e}")

    return registry


def init_registry() -> ConnectorRegistry:
    """
    Initialize the application-level ConnectorRegistry singleton.
    Called once during app startup (app_lifespan).
    """
    global _registry_instance
    _registry_instance = _build_registry()
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
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncEngine:
    from src.connectors.datasource.run_repository import SyncRunRepository
    return SyncEngine(
        registry=registry,
        sync_repo=SyncRepository(supabase),
        run_repo=SyncRunRepository(supabase),
    )


def get_sync_service(
    registry: ConnectorRegistry = Depends(get_connector_registry),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> SyncService:
    svc = SyncService(
        sync_repo=SyncRepository(supabase),
    )
    for provider in registry.providers():
        connector = registry.get(provider)
        if connector:
            svc.register_connector(connector)
    return svc


# ============================================================
# Standalone factory (for scheduler jobs, ARQ workers)
# ============================================================

def _build_sync_service(registry: Optional[ConnectorRegistry] = None) -> SyncService:
    """
    Build a SyncService outside of FastAPI request context.
    Used by the unified POST /api/v1/access endpoint and other non-DI callers.
    """
    if registry is None:
        registry = get_connector_registry()
    supabase = SupabaseClient()
    svc = SyncService(
        sync_repo=SyncRepository(supabase),
    )
    for provider in registry.providers():
        connector = registry.get(provider)
        if connector:
            svc.register_connector(connector)
    return svc


def create_sync_engine() -> SyncEngine:
    """
    Build a SyncEngine outside of FastAPI request context.
    Used by scheduler jobs and ARQ workers.
    """
    from src.connectors.datasource.run_repository import SyncRunRepository

    registry = get_connector_registry()
    supabase = SupabaseClient()
    sync_repo = SyncRepository(supabase)

    return SyncEngine(
        registry=registry,
        sync_repo=sync_repo,
        run_repo=SyncRunRepository(supabase),
    )
