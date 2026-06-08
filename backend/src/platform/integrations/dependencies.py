"""Dependency providers for Integration."""

from __future__ import annotations

from typing import Optional

from fastapi import Depends

from src.connectors.datasource.dependencies import get_connector_registry
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.run_repository import SyncRunRepository
from src.infra.supabase.client import SupabaseClient
from src.platform.integrations.engine import IntegrationEngine
from src.platform.integrations.repository import IntegrationRepository
from src.platform.integrations.service import IntegrationService


def _get_supabase_client() -> SupabaseClient:
    return SupabaseClient()


def get_integration_engine(
    registry: ConnectorRegistry = Depends(get_connector_registry),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> IntegrationEngine:
    return IntegrationEngine(
        registry=registry,
        repository=IntegrationRepository(supabase),
        run_repo=SyncRunRepository(supabase),
    )


def get_integration_service(
    registry: ConnectorRegistry = Depends(get_connector_registry),
    supabase: SupabaseClient = Depends(_get_supabase_client),
) -> IntegrationService:
    return _build_integration_service(
        registry=registry,
        supabase=supabase,
    )


def _build_integration_service(
    registry: Optional[ConnectorRegistry] = None,
    supabase: Optional[SupabaseClient] = None,
) -> IntegrationService:
    registry = registry or get_connector_registry()
    svc = IntegrationService(
        repository=IntegrationRepository(supabase or SupabaseClient()),
    )
    for provider in registry.providers():
        connector = registry.get(provider)
        if connector:
            svc.register_connector(connector)
    return svc


def create_integration_engine() -> IntegrationEngine:
    registry = get_connector_registry()
    supabase = SupabaseClient()
    return IntegrationEngine(
        registry=registry,
        repository=IntegrationRepository(supabase),
        run_repo=SyncRunRepository(supabase),
    )


__all__ = [
    "create_integration_engine",
    "get_connector_registry",
    "get_integration_engine",
    "get_integration_service",
]
