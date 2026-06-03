"""Connection-backed repository for external source sync bindings.

The target model is:

    repo_scopes  = subtree / credential / permission boundary
    connections  = durable external source relationship
    sync_runs    = one execution of a connection

Durable source bindings are stored only in ``connections``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from src.connectors.datasource.schemas import Sync
from src.infra.supabase.client import SupabaseClient
from src.repo.scope_service import ScopeService


VALID_CONNECTION_TRIGGER_TYPES = {"manual", "scheduled", "webhook", "realtime"}


def _normalize_path(path: str | None) -> str:
    if path is None:
        return ""
    value = path.strip()
    while value.startswith("/"):
        value = value[1:]
    while value.endswith("/"):
        value = value[:-1]
    while "//" in value:
        value = value.replace("//", "/")
    return value


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _parse_oauth_connection_id(credentials_ref: str | None) -> int | None:
    if not credentials_ref:
        return None
    try:
        return int(credentials_ref)
    except (TypeError, ValueError):
        return None


def _trigger_to_columns(trigger: Optional[dict]) -> tuple[str, dict]:
    trigger = dict(trigger or {})
    trigger_type = str(trigger.pop("type", "manual") or "manual")
    if trigger_type not in VALID_CONNECTION_TRIGGER_TYPES:
        trigger_type = "manual"
    return trigger_type, trigger


def _columns_to_trigger(row: dict) -> dict:
    trigger_type = row.get("trigger_type") or "manual"
    trigger_config = dict(row.get("trigger_config") or {})
    return {"type": trigger_type, **trigger_config}


def _cursor_to_model(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("value")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class SyncRepository:
    """Repository over durable Connect relationships."""

    CONNECTIONS = "connections"
    SCOPES = "repo_scopes"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

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

    def _scope_for_path(self, project_id: str, path: str) -> dict:
        canonical = _normalize_path(path)
        scopes = self._scopes_by_project(project_id)
        for scope in scopes.values():
            if _normalize_path(scope.get("path")) == canonical:
                return scope

        scope = ScopeService().create(
            project_id=project_id,
            name=canonical.split("/")[-1] if canonical else "Root",
            path=canonical,
            exclude=[],
            mode="rw",
        )
        return {
            "id": scope.id,
            "project_id": scope.project_id,
            "name": scope.name,
            "path": scope.path,
            "exclude": scope.exclude,
            "mode": scope.mode,
            "is_root": scope.is_root,
            "access_key": scope.access_key,
            "created_at": scope.created_at.isoformat(),
            "updated_at": scope.updated_at.isoformat(),
        }

    def _connection_to_model(self, row: dict, scope: dict | None = None) -> Sync:
        scope = scope or self._scope_by_id(row.get("scope_id")) or {}
        config = dict(row.get("config") or {})
        if row.get("external_resource_id"):
            config.setdefault("external_resource_id", row.get("external_resource_id"))
        if row.get("external_resource_label"):
            config.setdefault("name", row.get("external_resource_label"))
        if row.get("external_url"):
            config.setdefault("external_url", row.get("external_url"))

        credentials_ref = row.get("credential_ref")
        if credentials_ref is None and row.get("oauth_connection_id") is not None:
            credentials_ref = str(row.get("oauth_connection_id"))

        return Sync(
            id=row["id"],
            project_id=row["project_id"],
            path=_normalize_path(scope.get("path")),
            direction=row.get("direction", "inbound"),
            provider=row.get("provider", ""),
            authority=config.get("authority", "authoritative"),
            config=config,
            credentials_ref=credentials_ref,
            access_key=scope.get("access_key"),
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

    def _connection_row(self, sync_id: str) -> dict | None:
        resp = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("id", sync_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    # ============================================================
    # Create
    # ============================================================

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
    ) -> Sync:
        scope = self._scope_for_path(project_id, path)
        sync_config = dict(config or {})
        sync_config["authority"] = authority
        if credentials_ref is not None:
            sync_config["credentials_ref"] = credentials_ref
        if access_key is not None:
            sync_config["access_key"] = access_key
        if conflict_strategy is not None:
            sync_config["conflict_strategy"] = conflict_strategy

        trigger_type, trigger_config = _trigger_to_columns(trigger)
        oauth_connection_id = _parse_oauth_connection_id(credentials_ref)
        external_resource_id = sync_config.get("external_resource_id")

        resp = (
            self.client.table(self.CONNECTIONS)
            .insert({
                "org_id": self._project_org_id(project_id),
                "project_id": project_id,
                "scope_id": scope["id"],
                "provider": provider,
                "name": sync_config.get("name") or provider.replace("_", " ").title(),
                "direction": direction,
                "external_resource_id": external_resource_id,
                "external_resource_label": sync_config.get("name"),
                "external_url": (
                    sync_config.get("source_url")
                    or sync_config.get("url")
                    or sync_config.get("external_url")
                ),
                "oauth_connection_id": oauth_connection_id,
                "credential_ref": credentials_ref,
                "config": sync_config,
                "trigger_type": trigger_type,
                "trigger_config": trigger_config,
                "status": status,
                "created_by": created_by,
            })
            .execute()
        )
        return self._connection_to_model(resp.data[0], scope)

    # ============================================================
    # Read
    # ============================================================

    def get_by_id(self, sync_id: str) -> Optional[Sync]:
        row = self._connection_row(sync_id)
        if row:
            return self._connection_to_model(row)
        return None

    def get_by_path(self, path: str, project_id: str | None = None) -> Optional[Sync]:
        target = _normalize_path(path)
        candidates = (
            self.list_by_project(project_id)
            if project_id
            else self.list_active()
        )
        for sync in candidates:
            if _normalize_path(sync.path) == target:
                return sync
        return None

    def get_by_path_provider(
        self,
        *,
        project_id: str,
        path: str,
        provider: str,
        ensure_scope: bool = False,
    ) -> Optional[Sync]:
        target = _normalize_path(path)
        if ensure_scope:
            scope = self._scope_for_path(project_id, target)
        else:
            scope = None
            for candidate in self._scopes_by_project(project_id).values():
                if _normalize_path(candidate.get("path")) == target:
                    scope = candidate
                    break
            if scope is None:
                return None

        conn_rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("project_id", project_id)
            .eq("scope_id", scope["id"])
            .eq("provider", provider)
            .limit(1)
            .execute()
        ).data or []
        if conn_rows:
            return self._connection_to_model(conn_rows[0], scope)

        return None

    def find_owner_by_path(self, file_path: str) -> Optional[Sync]:
        target = _normalize_path(file_path)
        candidates = self.list_active()
        matches = []
        for sync in candidates:
            scope_path = _normalize_path(sync.path)
            if scope_path == "" or target == scope_path or target.startswith(scope_path + "/"):
                matches.append(sync)
        if not matches:
            return None
        return max(matches, key=lambda sync: len(_normalize_path(sync.path)))

    def get_by_access_key(self, access_key: str) -> Optional[Sync]:
        scope_resp = (
            self.client.table(self.SCOPES)
            .select("*")
            .eq("access_key", access_key)
            .is_("access_key_revoked_at", "null")
            .limit(1)
            .execute()
        )
        scope_rows = scope_resp.data or []
        if not scope_rows:
            return None
        scope = scope_rows[0]
        rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("scope_id", scope["id"])
            .eq("provider", "filesystem")
            .limit(1)
            .execute()
        ).data or []
        return self._connection_to_model(rows[0], scope) if rows else None

    def find_by_config_key(
        self, provider: str, key: str, value: str,
    ) -> Optional[Sync]:
        query = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("provider", provider)
            .eq("status", "active")
        )
        if key == "external_resource_id":
            query = query.eq("external_resource_id", value)
        else:
            query = query.eq(f"config->>{key}", value)
        rows = query.limit(1).execute().data or []
        if rows:
            return self._connection_to_model(rows[0])

        return None

    # ============================================================
    # Lists
    # ============================================================

    def list_by_project(self, project_id: str) -> list[Sync]:
        scopes = self._scopes_by_project(project_id)

        connection_rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=False)
            .execute()
        ).data or []
        return [
            self._connection_to_model(row, scopes.get(row.get("scope_id")))
            for row in connection_rows
        ]

    def list_by_path(self, path: str) -> list[Sync]:
        target = _normalize_path(path)
        return [sync for sync in self.list_active() if _normalize_path(sync.path) == target]

    def list_active(self, provider: Optional[str] = None) -> list[Sync]:
        query = self.client.table(self.CONNECTIONS).select("*").eq("status", "active")
        if provider:
            query = query.eq("provider", provider)
        connection_rows = query.order("created_at", desc=False).execute().data or []

        scopes_by_project: dict[str, dict[str, dict]] = {}
        result: list[Sync] = []
        for row in connection_rows:
            project_scopes = scopes_by_project.setdefault(
                row["project_id"],
                self._scopes_by_project(row["project_id"]),
            )
            result.append(self._connection_to_model(row, project_scopes.get(row.get("scope_id"))))

        return result

    def list_by_provider(self, project_id: str, provider: str) -> list[Sync]:
        scopes = self._scopes_by_project(project_id)
        connection_rows = (
            self.client.table(self.CONNECTIONS)
            .select("*")
            .eq("project_id", project_id)
            .eq("provider", provider)
            .order("created_at", desc=False)
            .execute()
        ).data or []
        return [
            self._connection_to_model(row, scopes.get(row.get("scope_id")))
            for row in connection_rows
        ]

    # ============================================================
    # Update
    # ============================================================

    def update(self, sync_id: str, **fields: Any) -> None:
        if self._connection_row(sync_id):
            self._update_connection(sync_id, **fields)
            return

    def _update_connection(self, sync_id: str, **fields: Any) -> None:
        patch: dict[str, Any] = {}
        config_patch: dict[str, Any] = {}
        for key, value in fields.items():
            if key in {"direction", "status", "error_message"}:
                patch[key] = value
            elif key == "trigger":
                trigger_type, trigger_config = _trigger_to_columns(value)
                patch["trigger_type"] = trigger_type
                patch["trigger_config"] = trigger_config
            elif key == "last_synced_at":
                patch["last_synced_at"] = value
            elif key == "remote_hash":
                patch["remote_hash"] = value
            elif key == "last_sync_commit_id":
                patch["last_sync_commit_id"] = value
            elif key == "cursor":
                patch["cursor"] = {"value": value}
            else:
                config_patch[key] = value

        if config_patch:
            current = self.get_by_id(sync_id)
            config = dict(current.config if current else {})
            config.update(config_patch)
            patch["config"] = config
            if "external_resource_id" in config_patch:
                patch["external_resource_id"] = config_patch["external_resource_id"]
            if "name" in config_patch:
                patch["external_resource_label"] = config_patch["name"]
        if patch:
            self.client.table(self.CONNECTIONS).update(patch).eq("id", sync_id).execute()

    def update_config(self, sync_id: str, config: dict) -> None:
        if self._connection_row(sync_id):
            patch = {"config": config}
            if config.get("external_resource_id"):
                patch["external_resource_id"] = config.get("external_resource_id")
            if config.get("name"):
                patch["external_resource_label"] = config.get("name")
            self.client.table(self.CONNECTIONS).update(patch).eq("id", sync_id).execute()
            return

    def update_status(self, sync_id: str, status: str) -> None:
        self.client.table(self.CONNECTIONS).update({"status": status}).eq("id", sync_id).execute()

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
        self.client.table(self.CONNECTIONS).update(patch).eq("id", sync_id).execute()

    def update_error(self, sync_id: str, error: str) -> None:
        self.client.table(self.CONNECTIONS).update({
            "status": "error",
            "error_message": error[:1000],
        }).eq("id", sync_id).execute()

    def touch_heartbeat(self, sync_id: str) -> None:
        self.client.table(self.CONNECTIONS).update({
            "last_synced_at": self._now(),
        }).eq("id", sync_id).execute()

    def update_cursor(self, sync_id: str, cursor: int) -> None:
        self.client.table(self.CONNECTIONS).update({
            "cursor": {"value": cursor},
        }).eq("id", sync_id).execute()

    # ============================================================
    # Delete
    # ============================================================

    def delete(self, sync_id: str) -> None:
        self.client.table(self.CONNECTIONS).delete().eq("id", sync_id).execute()

    def delete_by_path(self, path: str) -> None:
        for sync in self.list_by_path(path):
            self.delete(sync.id)

    def delete_by_project(self, project_id: str) -> None:
        rows = self.list_by_project(project_id)
        for sync in rows:
            self.delete(sync.id)
