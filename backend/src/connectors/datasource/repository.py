"""Connector-backed repository for external sync bindings.

The canonical model is:

    repo_scopes  = subtree / credential / permission boundary
    connectors   = provider binding attached to one scope

``Sync`` remains the in-process DTO consumed by datasource connectors, but it
is now derived from those two tables. No historical-table fallback exists.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.connectors.datasource.schemas import Sync
from src.repo.scope_service import ScopeService


BUILTIN_PROVIDERS = {"cli", "agent", "filesystem"}


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


class SyncRepository:
    """Repository facade over ``connectors`` + ``repo_scopes``."""

    CONNECTORS = "connectors"
    SCOPES = "repo_scopes"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _scope_by_id(self, scope_id: str) -> dict | None:
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

    def _row_to_model(self, row: dict, scope: dict | None = None) -> Sync:
        scope = scope or self._scope_by_id(row["scope_id"]) or {}
        config = row.get("config") or {}
        return Sync(
            id=row["id"],
            project_id=row["project_id"],
            path=_normalize_path(scope.get("path")),
            direction=row.get("direction", "inbound"),
            provider=row.get("provider", ""),
            authority=config.get("authority", "authoritative"),
            config=config,
            credentials_ref=config.get("credentials_ref"),
            access_key=scope.get("access_key"),
            trigger=row.get("trigger") or {"type": "manual"},
            conflict_strategy=config.get("conflict_strategy"),
            status=row.get("status", "active"),
            cursor=config.get("cursor"),
            last_synced_at=_iso(row.get("last_run_at")),
            error_message=row.get("error_message"),
            remote_hash=config.get("remote_hash"),
            last_sync_commit_id=config.get("last_sync_commit_id", "") or "",
            created_by=row.get("created_by"),
            created_at=_iso(row.get("created_at")),
            updated_at=_iso(row.get("updated_at")),
        )

    def _select(self):
        return self.client.table(self.CONNECTORS).select("*")

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

        oauth_connection_id = _parse_oauth_connection_id(credentials_ref)
        resp = (
            self.client.table(self.CONNECTORS)
            .insert({
                "project_id": project_id,
                "scope_id": scope["id"],
                "provider": provider,
                "name": sync_config.get("name") or provider.replace("_", " ").title(),
                "direction": direction,
                "config": sync_config,
                "oauth_connection_id": oauth_connection_id,
                "trigger": trigger or {"type": "manual"},
                "status": status,
                "created_by": sync_config.get("user_id"),
            })
            .execute()
        )
        return self._row_to_model(resp.data[0], scope)

    # ============================================================
    # Read — single
    # ============================================================

    def get_by_id(self, sync_id: str) -> Optional[Sync]:
        response = self._select().eq("id", sync_id).limit(1).execute()
        rows = response.data or []
        return self._row_to_model(rows[0]) if rows else None

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
        """Return the connector for an exact scope path and provider.

        Built-in providers such as ``filesystem`` are created by the
        repo_scopes trigger. Callers that are provisioning a new external
        surface should ask for ``ensure_scope=True`` and then claim the
        auto-created connector instead of inserting a duplicate provider row.
        """
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

        response = (
            self._select()
            .eq("project_id", project_id)
            .eq("scope_id", scope["id"])
            .eq("provider", provider)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return self._row_to_model(rows[0], scope) if rows else None

    def find_owner_by_path(self, file_path: str) -> Optional[Sync]:
        target = _normalize_path(file_path)
        candidates = [
            sync for sync in self.list_active()
            if sync.provider not in BUILTIN_PROVIDERS
        ]
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
        conn_resp = (
            self._select()
            .eq("scope_id", scope["id"])
            .eq("provider", "filesystem")
            .limit(1)
            .execute()
        )
        rows = conn_resp.data or []
        return self._row_to_model(rows[0], scope) if rows else None

    def find_by_config_key(
        self, provider: str, key: str, value: str,
    ) -> Optional[Sync]:
        response = (
            self._select()
            .eq("provider", provider)
            .eq("status", "active")
            .eq(f"config->>{key}", value)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return self._row_to_model(rows[0]) if rows else None

    # ============================================================
    # Read — lists
    # ============================================================

    def list_by_project(self, project_id: str) -> list[Sync]:
        rows = (
            self._select()
            .eq("project_id", project_id)
            .not_.in_("provider", list(BUILTIN_PROVIDERS))
            .order("created_at", desc=False)
            .execute()
        ).data or []
        scopes = self._scopes_by_project(project_id)
        return [self._row_to_model(row, scopes.get(row["scope_id"])) for row in rows]

    def list_by_path(self, path: str) -> list[Sync]:
        target = _normalize_path(path)
        return [sync for sync in self.list_active() if _normalize_path(sync.path) == target]

    def list_active(self, provider: Optional[str] = None) -> list[Sync]:
        query = self._select().eq("status", "active")
        if provider:
            query = query.eq("provider", provider)
        else:
            query = query.not_.in_("provider", list(BUILTIN_PROVIDERS))
        rows = query.order("created_at", desc=False).execute().data or []
        scopes_by_project: dict[str, dict[str, dict]] = {}
        result: list[Sync] = []
        for row in rows:
            project_scopes = scopes_by_project.setdefault(
                row["project_id"],
                self._scopes_by_project(row["project_id"]),
            )
            result.append(self._row_to_model(row, project_scopes.get(row["scope_id"])))
        return result

    def list_by_provider(
        self, project_id: str, provider: str,
    ) -> list[Sync]:
        rows = (
            self._select()
            .eq("project_id", project_id)
            .eq("provider", provider)
            .order("created_at", desc=False)
            .execute()
        ).data or []
        scopes = self._scopes_by_project(project_id)
        return [self._row_to_model(row, scopes.get(row["scope_id"])) for row in rows]

    # ============================================================
    # Update
    # ============================================================

    def update(self, sync_id: str, **fields: Any) -> None:
        patch: dict[str, Any] = {}
        config_patch: dict[str, Any] = {}
        for key, value in fields.items():
            if key in {"direction", "status", "trigger", "error_message"}:
                patch[key] = value
            elif key == "last_synced_at":
                patch["last_run_at"] = value
            else:
                config_patch[key] = value

        if config_patch:
            current = self.get_by_id(sync_id)
            config = dict(current.config if current else {})
            config.update(config_patch)
            patch["config"] = config
        if not patch:
            return
        self.client.table(self.CONNECTORS).update(patch).eq("id", sync_id).execute()

    def update_config(self, sync_id: str, config: dict) -> None:
        self.client.table(self.CONNECTORS).update({"config": config}).eq("id", sync_id).execute()

    def update_status(self, sync_id: str, status: str) -> None:
        self.client.table(self.CONNECTORS).update({"status": status}).eq("id", sync_id).execute()

    def update_sync_point(
        self,
        sync_id: str,
        last_sync_commit_id: str,
        remote_hash: Optional[str] = None,
    ) -> None:
        current = self.get_by_id(sync_id)
        config = dict(current.config if current else {})
        config["last_sync_commit_id"] = last_sync_commit_id
        if remote_hash is not None:
            config["remote_hash"] = remote_hash
        self.client.table(self.CONNECTORS).update({
            "config": config,
            "status": "active",
            "last_run_at": self._now(),
            "error_message": None,
        }).eq("id", sync_id).execute()

    def update_error(self, sync_id: str, error: str) -> None:
        self.client.table(self.CONNECTORS).update({
            "status": "error",
            "error_message": error[:1000],
        }).eq("id", sync_id).execute()

    def touch_heartbeat(self, sync_id: str) -> None:
        self.client.table(self.CONNECTORS).update({
            "last_run_at": self._now(),
        }).eq("id", sync_id).execute()

    def update_cursor(self, sync_id: str, cursor: int) -> None:
        current = self.get_by_id(sync_id)
        config = dict(current.config if current else {})
        config["cursor"] = cursor
        self.client.table(self.CONNECTORS).update({"config": config}).eq("id", sync_id).execute()

    # ============================================================
    # Delete
    # ============================================================

    def delete(self, sync_id: str) -> None:
        self.client.table(self.CONNECTORS).delete().eq("id", sync_id).execute()

    def delete_by_path(self, path: str) -> None:
        for sync in self.list_by_path(path):
            self.delete(sync.id)

    def delete_by_project(self, project_id: str) -> None:
        rows = self.list_by_project(project_id)
        for sync in rows:
            self.delete(sync.id)


def _parse_oauth_connection_id(credentials_ref: str | None) -> int | None:
    if not credentials_ref:
        return None
    try:
        return int(credentials_ref)
    except (TypeError, ValueError):
        return None
