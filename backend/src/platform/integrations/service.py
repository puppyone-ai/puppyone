"""Integration lifecycle service.

The service owns product semantics: durable connection lifecycle, target path,
trigger configuration, and initial execution handoff. Provider connectors stay
storage-agnostic.
"""

from __future__ import annotations

from typing import Any, Optional

from src.connectors.datasource._base import BaseConnector
from src.connectors.datasource.schemas import ResourceInfo
from src.platform.integrations.paths import (
    canonical_provider,
    join_path,
    normalize_path,
    safe_filename,
)
from src.platform.integrations.repository import (
    IntegrationConnection,
    IntegrationRepository,
)
from src.utils.logger import log_error, log_info


class IntegrationService:
    def __init__(self, repository: IntegrationRepository):
        self.repository = repository
        # Compatibility for old helpers that receive a service-like object.
        self.sync_repo = repository
        self._connectors: dict[str, BaseConnector] = {}

    def register_connector(self, connector: BaseConnector) -> None:
        self._connectors[canonical_provider(connector.spec().provider)] = connector

    def _get_connector(self, provider: str) -> Optional[BaseConnector]:
        return self._connectors.get(canonical_provider(provider))

    def remove_sync(self, connection_id: str) -> None:
        self.repository.delete(connection_id)
        log_info(f"[Integration] Removed connection #{connection_id}")

    def pause_sync(self, connection_id: str) -> None:
        self.repository.update_status(connection_id, "paused")

    def resume_sync(self, connection_id: str) -> None:
        self.repository.update_status(connection_id, "active")

    def _default_target_path(
        self,
        *,
        provider: str,
        config: dict,
        fallback_name: str,
        target_folder_path: Optional[str],
    ) -> str:
        explicit = (
            config.get("target_path")
            or config.get("path")
            or target_folder_path
        )
        if explicit is not None:
            resolved = normalize_path(str(explicit))
            if resolved:
                return resolved
        source = config.get("source") if isinstance(config.get("source"), dict) else {}
        name = source.get("resource_name") or fallback_name or provider
        return safe_filename(str(name), fallback=provider)

    async def bootstrap(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_path: Optional[str] = None,
        credentials_ref: Optional[str] = None,
        direction: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "manual",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> list[IntegrationConnection]:
        if sync_mode == "import_once":
            raise ValueError("One-time imports must use ImportJob, not Integration")

        canonical = canonical_provider(provider)
        connector = self._get_connector(canonical)
        if not connector:
            raise ValueError(f"No integration connector for provider: {provider}")
        if connector.spec().creation_mode != "bootstrap":
            raise ValueError(
                f"Connector {canonical} must use direct connection creation"
            )

        trigger_data = dict(trigger or {})
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        temp_connection = IntegrationConnection(
            id="",
            project_id=project_id,
            path=normalize_path(target_folder_path),
            direction=direction,
            provider=canonical,
            config=config,
            credentials_ref=credentials_ref,
        )
        resources = await connector.list_resources(temp_connection)
        created: list[IntegrationConnection] = []

        for resource in resources:
            existing = self.repository.find_by_config_key(
                canonical, "external_resource_id", resource.external_resource_id,
            )
            if existing:
                continue

            target_path = self._target_path_for_resource(
                target_folder_path=target_folder_path,
                resource=resource,
            )
            source = dict((config or {}).get("source") or {})
            source.update({
                "provider": canonical,
                "resource_type": resource.node_type,
                "resource_id": resource.external_resource_id,
                "resource_name": resource.name,
            })
            connection_config = {
                **config,
                "source": source,
                "options": dict((config or {}).get("options") or {}),
                "target_path": target_path,
            }
            if user_id:
                connection_config["user_id"] = user_id

            connection = self.repository.create(
                project_id=project_id,
                path=target_path,
                direction=direction,
                provider=canonical,
                config=connection_config,
                credentials_ref=credentials_ref,
                conflict_strategy=conflict_strategy,
                trigger=trigger_data,
                created_by=user_id,
            )
            created.append(connection)
            log_info(
                f"[Integration] Bound {canonical}:{resource.external_resource_id} "
                f"-> {target_path}"
            )

        return created

    def _target_path_for_resource(
        self,
        *,
        target_folder_path: Optional[str],
        resource: ResourceInfo,
    ) -> str:
        base = normalize_path(target_folder_path)
        name = safe_filename(resource.name, resource.external_resource_id)
        return join_path(base, name) if base else name

    async def create_sync(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_folder_path: Optional[str] = None,
        *,
        credentials_ref: Optional[str] = None,
        direction: str = "inbound",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "manual",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> IntegrationConnection:
        return await self.create_connection(
            project_id=project_id,
            provider=provider,
            config=config,
            target_path=target_folder_path,
            credentials_ref=credentials_ref,
            direction=direction,
            conflict_strategy=conflict_strategy,
            sync_mode=sync_mode,
            trigger=trigger,
            user_id=user_id,
        )

    async def create_connection(
        self,
        project_id: str,
        provider: str,
        config: dict,
        target_path: Optional[str] = None,
        *,
        credentials_ref: Optional[str] = None,
        direction: str = "inbound",
        conflict_strategy: str = "three_way_merge",
        sync_mode: str = "manual",
        trigger: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> IntegrationConnection:
        if sync_mode == "import_once":
            raise ValueError("One-time imports must use ImportJob, not Integration")

        canonical = canonical_provider(provider)
        connector = self._get_connector(canonical)
        if not connector:
            raise ValueError(f"No integration connector for provider: {provider}")

        spec = connector.spec()
        if spec.creation_mode != "direct":
            raise ValueError(
                f"Connector {canonical} must be created via Integration bootstrap"
            )

        connection_config = dict(config or {})
        connection_config["options"] = dict(connection_config.get("options") or {})
        resolved_target_path = self._default_target_path(
            provider=canonical,
            config=connection_config,
            fallback_name=spec.display_name,
            target_folder_path=target_path,
        )
        connection_config["target_path"] = resolved_target_path
        if user_id:
            connection_config["user_id"] = user_id

        trigger_data = dict(trigger or {})
        if not trigger_data.get("type"):
            trigger_data["type"] = sync_mode

        connection = self.repository.create(
            project_id=project_id,
            path=resolved_target_path,
            direction=direction,
            provider=canonical,
            config=connection_config,
            credentials_ref=credentials_ref,
            conflict_strategy=conflict_strategy,
            trigger=trigger_data,
            created_by=user_id,
        )
        log_info(
            f"[Integration] Created {canonical} connection -> "
            f"{resolved_target_path} (mode={sync_mode})"
        )
        return connection

    async def pull_sync(self, connection_id: str) -> Optional[dict]:
        connection = self.repository.get_by_id(connection_id)
        if not connection or connection.status != "active":
            return None
        if connection.direction == "outbound":
            return None
        connector = self._get_connector(connection.provider)
        if not connector:
            return None
        return await self._pull_one(connection)

    async def pull_all(self, provider: Optional[str] = None) -> list[dict]:
        results = []
        for connection in self.repository.list_active(provider):
            if connection.direction == "outbound":
                continue
            if not self._get_connector(connection.provider):
                continue
            result = await self._pull_one(connection)
            if result:
                results.append(result)
        return results

    async def _pull_one(self, connection: IntegrationConnection) -> Optional[dict]:
        try:
            from src.platform.integrations.dependencies import create_integration_engine

            return await create_integration_engine().execute(connection.id)
        except Exception as exc:
            log_error(f"[Integration] Pull failed for {connection.path}: {exc}")
            self.repository.update_error(connection.id, str(exc))
            return None

    async def push_node(
        self,
        path: str,
        commit_id: str,
        content: Any,
        node_type: str,
    ) -> list[dict]:
        connection = self.repository.find_owner_by_path(path)
        if not connection:
            return []
        if commit_id and connection.last_sync_commit_id == commit_id:
            return []
        if connection.status != "active" or connection.direction == "inbound":
            return []
        connector = self._get_connector(connection.provider)
        if not connector:
            return []

        try:
            push_result = await connector.push(connection, content, node_type)
            if not push_result.success:
                self.repository.update_error(
                    connection.id, push_result.error or "push failed",
                )
                return []
            self.repository.update_sync_point(
                sync_id=connection.id,
                last_sync_commit_id=commit_id,
                remote_hash=push_result.remote_hash,
            )
            return [{
                "path": connection.path,
                "provider": connection.provider,
                "success": True,
            }]
        except Exception as exc:
            self.repository.update_error(connection.id, str(exc))
            return []


__all__ = ["IntegrationService"]
