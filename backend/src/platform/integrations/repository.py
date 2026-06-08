"""Repository for project-root Integration connections.

``connections.target_path`` is the product-level destination. ``scope_id`` is
kept only as a rollout/legacy compatibility column and must not decide where an
Integration writes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from src.connectors.datasource.repository import (
    VALID_CONNECTION_TRIGGER_TYPES,
    _columns_to_trigger,
    _cursor_to_model,
    _iso,
    _parse_oauth_connection_id,
    _trigger_to_columns,
)
from src.connectors.datasource.run_repository import (
    SyncRun as IntegrationRun,
    SyncRunRepository as IntegrationRunRepository,
)
from src.connectors.datasource.schemas import Sync as IntegrationConnection
from src.infra.supabase.client import SupabaseClient
from src.platform.integrations.paths import canonical_provider, normalize_path
from src.repo.scope_service import ScopeService


class IntegrationRepository:
    CONNECTIONS = "connections"
    SCOPES = "repo_scopes"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _project_org_id(self, project_id: str) -> str | None:
        resp = (
            self.client.table("projects")
            .select("org_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0].get("org_id") if rows else None

    def _scope_by_id(self, scope_id: str | None) -> dict | None:
        if not scope_id:
            return None
        resp = (
            self.client.table(self.SCOPES)
            .select("*")
            .eq("id", scope_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def _scopes_by_project(self, project_id: str) -> dict[str, dict]:
        resp = (
            self.client.table(self.SCOPES)
            .select("*")
            .eq("project_id", project_id)
            .execute()
        )
        return {row["id"]: row for row in (resp.data or [])}

    def _root_scope_id(self, project_id: str) -> str | None:
        try:
            return ScopeService().ensure_root_scope(project_id).id
        except Exception:
            return None

    def _target_path_from_row(self, row: dict, scope: dict | None = None) -> str:
        config = dict(row.get("config") or {})
        target_path = (
            row.get("target_path")
            or config.get("target_path")
            or config.get("path")
        )
        if target_path is None and scope:
            target_path = scope.get("path")
        return normalize_path(target_path)

    def _connection_to_model(
        self, row: dict, scope: dict | None = None,
    ) -> IntegrationConnection:
        scope = scope or self._scope_by_id(row.get("scope_id")) or {}
        config = dict(row.get("config") or {})
        target_path = self._target_path_from_row(row, scope)
        if target_path:
            config.setdefault("target_path", target_path)
        if row.get("external_resource_id"):
            config.setdefault("external_resource_id", row.get("external_resource_id"))
        if row.get("external_resource_label"):
            config.setdefault("name", row.get("external_resource_label"))
        if row.get("external_url"):
            config.setdefault("external_url", row.get("external_url"))

        credentials_ref = row.get("credential_ref")
        if credentials_ref is None and row.get("oauth_connection_id") is not None:
            credentials_ref = str(row.get("oauth_connection_id"))

        return IntegrationConnection(
            id=row["id"],
            project_id=row["project_id"],
            path=target_path,
            direction=row.get("direction", "inbound"),
            provider=canonical_provider(row.get("provider", "")),
            authority=config.get("authority", "authoritative"),
            config=config,
            credentials_ref=credentials_ref,
            access_key=None,
            trigger=_columns_to_trigger(row),
            conflict_strategy=config.get("conflict_strategy"),
            status=row.get("status", "active"),
            cursor=_cursor_to_model(row.get("cursor")),
            last_synced_at=_iso(row.get("last_synced_at")),
            error_message=row.get("error_message"),
            remote_hash=row.get("remote_hash"),
            last_sync_commit_id=row.get("last_sync_commit_id") or "",
            created_by=row.get("created_by"),
            created_at=_iso(row.get("created_at")),
            updated_at=_iso(row.get("updated_at")),
        )

    def _connection_row(self, connection_id: str) -> dict | None:
        resp = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def _insert_connection(self, data: dict[str, Any]) -> dict:
        try:
            resp = self.client.table(self.CONNECTIONS).insert(data).execute()
            return resp.data[0]
        except Exception as exc:
            # Rollout compatibility for databases that have not applied the
            # target_path migration yet. The config fallback keeps new code
            # correct while the physical column catches up.
            if "target_path" not in str(exc):
                raise
            fallback = dict(data)
            target_path = fallback.pop("target_path", None)
            config = dict(fallback.get("config") or {})
            if target_path:
                config.setdefault("target_path", target_path)
            fallback["config"] = config
            resp = self.client.table(self.CONNECTIONS).insert(fallback).execute()
            return resp.data[0]

    def _update_connection(self, connection_id: str, patch: dict[str, Any]) -> None:
        if not patch:
            return
        try:
            self.client.table(self.CONNECTIONS).update(patch).eq("id", connection_id).execute()
        except Exception as exc:
            if "target_path" not in str(exc) or "target_path" not in patch:
                raise
            fallback = dict(patch)
            fallback.pop("target_path", None)
            if fallback:
                self.client.table(self.CONNECTIONS).update(fallback).eq("id", connection_id).execute()

    def create(
        self,
        project_id: str,
        path: str,
        direction: str,
        provider: str,
        *,
        authority: str = "authoritative",
        config: Optional[dict] = None,
        credentials_ref: Optional[str] = None,
        access_key: Optional[str] = None,
        trigger: Optional[dict] = None,
        conflict_strategy: Optional[str] = None,
        status: str = "active",
        created_by: Optional[str] = None,
    ) -> IntegrationConnection:
        target_path = normalize_path(path)
        integration_config = dict(config or {})
        integration_config["target_path"] = target_path
        integration_config["authority"] = authority
        if credentials_ref is not None:
            integration_config["credentials_ref"] = credentials_ref
        if access_key is not None:
            integration_config["access_key"] = access_key
        if conflict_strategy is not None:
            integration_config["conflict_strategy"] = conflict_strategy

        trigger_type, trigger_config = _trigger_to_columns(trigger)
        oauth_connection_id = _parse_oauth_connection_id(credentials_ref)
        external_resource_id = integration_config.get("external_resource_id")
        canonical = canonical_provider(provider)

        row = self._insert_connection({
            "org_id": self._project_org_id(project_id),
            "project_id": project_id,
            "scope_id": self._root_scope_id(project_id),
            "target_path": target_path,
            "provider": canonical,
            "name": integration_config.get("name") or canonical.replace("_", " ").title(),
            "direction": direction,
            "external_resource_id": external_resource_id,
            "external_resource_label": integration_config.get("name"),
            "external_url": (
                integration_config.get("source_url")
                or integration_config.get("url")
                or integration_config.get("external_url")
            ),
            "oauth_connection_id": oauth_connection_id,
            "credential_ref": credentials_ref,
            "config": integration_config,
            "trigger_type": trigger_type,
            "trigger_config": trigger_config,
            "status": status,
            "created_by": created_by,
        })
        scope = self._scope_by_id(row.get("scope_id"))
        return self._connection_to_model(row, scope)

    def get_by_id(self, connection_id: str) -> Optional[IntegrationConnection]:
        row = self._connection_row(connection_id)
        return self._connection_to_model(row) if row else None

    def get_by_path(
        self, path: str, project_id: str | None = None,
    ) -> Optional[IntegrationConnection]:
        target = normalize_path(path)
        candidates = self.list_by_project(project_id) if project_id else self.list_active()
        for connection in candidates:
            if normalize_path(connection.path) == target:
                return connection
        return None

    def get_by_path_provider(
        self,
        *,
        project_id: str,
        path: str,
        provider: str,
        ensure_scope: bool = False,
    ) -> Optional[IntegrationConnection]:
        target = normalize_path(path)
        canonical = canonical_provider(provider)
        for connection in self.list_by_project(project_id):
            if (
                normalize_path(connection.path) == target
                and canonical_provider(connection.provider) == canonical
            ):
                return connection
        return None

    def find_owner_by_path(self, file_path: str) -> Optional[IntegrationConnection]:
        target = normalize_path(file_path)
        matches = []
        for connection in self.list_active():
            base = normalize_path(connection.path)
            if base == "" or target == base or target.startswith(base + "/"):
                matches.append(connection)
        if not matches:
            return None
        return max(matches, key=lambda item: len(normalize_path(item.path)))

    def find_by_config_key(
        self, provider: str, key: str, value: str,
    ) -> Optional[IntegrationConnection]:
        canonical = canonical_provider(provider)
        query = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("provider", canonical)
            .eq("status", "active")
        )
        if key == "external_resource_id":
            query = query.eq("external_resource_id", value)
        else:
            query = query.eq(f"config->>{key}", value)
        rows = query.limit(1).execute().data or []
        return self._connection_to_model(rows[0]) if rows else None

    def list_by_project(self, project_id: str) -> list[IntegrationConnection]:
        scopes = self._scopes_by_project(project_id)
        rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=False)
            .execute()
        ).data or []
        return [
            self._connection_to_model(row, scopes.get(row.get("scope_id")))
            for row in rows
        ]

    def list_by_path(self, path: str) -> list[IntegrationConnection]:
        target = normalize_path(path)
        return [
            connection for connection in self.list_active()
            if normalize_path(connection.path) == target
        ]

    def list_active(self, provider: Optional[str] = None) -> list[IntegrationConnection]:
        query = self.client.table(self.CONNECTIONS).select("*").eq("status", "active")
        if provider:
            query = query.eq("provider", canonical_provider(provider))
        rows = query.order("created_at", desc=False).execute().data or []

        scopes_by_project: dict[str, dict[str, dict]] = {}
        result: list[IntegrationConnection] = []
        for row in rows:
            project_scopes = scopes_by_project.setdefault(
                row["project_id"],
                self._scopes_by_project(row["project_id"]),
            )
            result.append(
                self._connection_to_model(row, project_scopes.get(row.get("scope_id")))
            )
        return result

    def list_by_provider(
        self, project_id: str, provider: str,
    ) -> list[IntegrationConnection]:
        canonical = canonical_provider(provider)
        scopes = self._scopes_by_project(project_id)
        rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("project_id", project_id)
            .eq("provider", canonical)
            .order("created_at", desc=False)
            .execute()
        ).data or []
        return [
            self._connection_to_model(row, scopes.get(row.get("scope_id")))
            for row in rows
        ]

    def update(self, connection_id: str, **fields: Any) -> None:
        current = self.get_by_id(connection_id)
        if not current:
            return

        patch: dict[str, Any] = {}
        config_patch: dict[str, Any] = {}
        for key, value in fields.items():
            if key in {"direction", "status", "error_message"}:
                patch[key] = value
            elif key == "trigger":
                trigger_type, trigger_config = _trigger_to_columns(value)
                patch["trigger_type"] = trigger_type
                patch["trigger_config"] = trigger_config
            elif key in {"last_synced_at", "remote_hash", "last_sync_commit_id"}:
                patch[key] = value
            elif key == "cursor":
                patch["cursor"] = {"value": value}
            elif key == "target_path":
                target_path = normalize_path(value)
                patch["target_path"] = target_path
                config_patch["target_path"] = target_path
            else:
                config_patch[key] = value

        if config_patch:
            config = dict(current.config if current else {})
            config.update(config_patch)
            patch["config"] = config
            if "external_resource_id" in config_patch:
                patch["external_resource_id"] = config_patch["external_resource_id"]
            if "name" in config_patch:
                patch["external_resource_label"] = config_patch["name"]
        self._update_connection(connection_id, patch)

    def update_config(self, connection_id: str, config: dict) -> None:
        patch: dict[str, Any] = {"config": config}
        if config.get("target_path"):
            patch["target_path"] = normalize_path(config.get("target_path"))
        if config.get("external_resource_id"):
            patch["external_resource_id"] = config.get("external_resource_id")
        if config.get("name"):
            patch["external_resource_label"] = config.get("name")
        self._update_connection(connection_id, patch)

    def update_status(self, connection_id: str, status: str) -> None:
        self._update_connection(connection_id, {"status": status})

    def update_sync_point(
        self,
        sync_id: str,
        last_sync_commit_id: str,
        remote_hash: Optional[str] = None,
    ) -> None:
        patch: dict[str, Any] = {
            "status": "active",
            "last_synced_at": self._now(),
            "last_sync_commit_id": last_sync_commit_id,
            "error_message": None,
        }
        if remote_hash is not None:
            patch["remote_hash"] = remote_hash
        self._update_connection(sync_id, patch)

    def update_error(self, connection_id: str, error: str) -> None:
        self._update_connection(connection_id, {
            "status": "error",
            "error_message": error[:1000],
        })

    def touch_heartbeat(self, connection_id: str) -> None:
        self._update_connection(connection_id, {"last_synced_at": self._now()})

    def update_cursor(self, connection_id: str, cursor: int) -> None:
        self._update_connection(connection_id, {"cursor": {"value": cursor}})

    def delete(self, connection_id: str) -> None:
        self.client.table(self.CONNECTIONS).delete().eq("id", connection_id).execute()

    def delete_by_path(self, path: str) -> None:
        for connection in self.list_by_path(path):
            self.delete(connection.id)

    def delete_by_project(self, project_id: str) -> None:
        for connection in self.list_by_project(project_id):
            self.delete(connection.id)


__all__ = [
    "IntegrationConnection",
    "IntegrationRepository",
    "IntegrationRun",
    "IntegrationRunRepository",
    "VALID_CONNECTION_TRIGGER_TYPES",
]
