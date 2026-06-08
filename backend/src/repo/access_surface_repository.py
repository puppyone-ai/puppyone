"""Supabase repository for workspace Access surfaces.

Access surfaces are scope-bound ways to enter or operate on a workspace:
Git remote, CLI, agents, MCP endpoints, and sandboxes.
They are not durable external data sources; those live in ``connections``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.repo.models import Connector, RepoScope


ACCESS_SURFACE_KINDS = frozenset({
    "git_remote",
    "cli",
    "agent",
    "mcp",
    "sandbox",
})
ACCESS_SURFACE_KIND_LIST = sorted(ACCESS_SURFACE_KINDS)
BUILTIN_SCOPE_SURFACES = (
    ("git_remote", "Git Remote"),
    ("cli", "FS CLI"),
)


def _parse_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def _row_to_connector(row: dict[str, Any]) -> Connector:
    config = row.get("config") or {}
    return Connector(
        id=row["id"],
        project_id=row["project_id"],
        scope_id=row["scope_id"],
        provider=row["kind"],
        name=row["name"],
        direction=config.get("direction") or (
            "bidirectional" if row["kind"] in {"git_remote", "cli"} else "inbound"
        ),
        config=config,
        policy=config.get("policy") or {},
        oauth_connection_id=None,
        trigger=config.get("trigger") or {"type": "manual"},
        status=row.get("status") or "active",
        last_run_at=_parse_dt(config.get("last_run_at")),
        last_run_id=config.get("last_run_id"),
        error_message=config.get("error_message"),
        created_by=row.get("created_by"),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


class AccessSurfaceRepository:
    TABLE = "access_surfaces"
    CONNECTIONS = "connections"

    def __init__(self, supabase_client: Optional[SupabaseClient] = None):
        self._client = (supabase_client or SupabaseClient()).get_client()

    def _project_org_id(self, project_id: str) -> str | None:
        resp = (
            self._client.table("projects")
            .select("org_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0].get("org_id") if rows else None

    # ── Reads ────────────────────────────────────────────────────────────

    def list_by_project(
        self,
        project_id: str,
        *,
        scope_id: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        query = self._client.table(self.TABLE).select("*").eq("project_id", project_id)
        if scope_id:
            query = query.eq("scope_id", scope_id)
        if kind:
            if kind not in ACCESS_SURFACE_KINDS:
                return []
            query = query.eq("kind", kind)
        else:
            query = query.in_("kind", ACCESS_SURFACE_KIND_LIST)
        resp = query.order("created_at", desc=False).execute()
        return resp.data or []

    def get(self, surface_id: str) -> Optional[dict[str, Any]]:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("id", surface_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        row = rows[0] if rows else None
        if row and row.get("kind") not in ACCESS_SURFACE_KINDS:
            return None
        return row

    def get_by_scope_kind(self, scope_id: str, kind: str) -> Optional[dict[str, Any]]:
        if kind not in ACCESS_SURFACE_KINDS:
            return None
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("scope_id", scope_id)
            .eq("kind", kind)
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def get_by_config_key(self, kind: str, key: str, value: str) -> Optional[dict[str, Any]]:
        if kind not in ACCESS_SURFACE_KINDS:
            return None
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("kind", kind)
            .filter(f"config->>{key}", "eq", value)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def list_connectors_by_project(
        self,
        project_id: str,
        *,
        scope_id: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> list[Connector]:
        return [
            _row_to_connector(row)
            for row in self.list_by_project(project_id, scope_id=scope_id, kind=kind)
        ]

    def get_connector(self, surface_id: str) -> Optional[Connector]:
        row = self.get(surface_id)
        return _row_to_connector(row) if row else None

    def get_connector_by_scope_kind(self, scope_id: str, kind: str) -> Optional[Connector]:
        row = self.get_by_scope_kind(scope_id, kind)
        return _row_to_connector(row) if row else None

    def get_agent_connector_by_mcp_key(self, mcp_api_key: str) -> Optional[Connector]:
        row = self.get_by_config_key("agent", "mcp_api_key", mcp_api_key)
        return _row_to_connector(row) if row else None

    # ── Writes ───────────────────────────────────────────────────────────

    def insert(
        self,
        *,
        project_id: str,
        scope_id: str,
        kind: str,
        name: str,
        config: Optional[dict[str, Any]] = None,
        status: str = "active",
        created_by: Optional[str] = None,
        principal_type: Optional[str] = None,
        principal_id: Optional[str] = None,
    ) -> dict[str, Any]:
        if kind not in ACCESS_SURFACE_KINDS:
            raise ValueError(f"Unsupported access surface kind: {kind}")
        resp = (
            self._client.table(self.TABLE)
            .insert({
                "org_id": self._project_org_id(project_id),
                "project_id": project_id,
                "scope_id": scope_id,
                "kind": kind,
                "name": name,
                "status": status,
                "principal_type": principal_type,
                "principal_id": principal_id,
                "config": config or {},
                "created_by": created_by,
            })
            .execute()
        )
        return resp.data[0]

    def update(self, surface_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
        if not patch:
            return self.get(surface_id)
        resp = (
            self._client.table(self.TABLE)
            .update(patch)
            .eq("id", surface_id)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    def delete(self, surface_id: str) -> bool:
        resp = self._client.table(self.TABLE).delete().eq("id", surface_id).execute()
        return bool(resp.data)

    def ensure_scope_defaults(self, scope: RepoScope, *, created_by: Optional[str] = None) -> None:
        for kind, name in BUILTIN_SCOPE_SURFACES:
            existing = self.get_by_scope_kind(scope.id, kind)
            if existing:
                continue
            config: dict[str, Any] = {
                "access_key": scope.access_key,
                "path": scope.path,
                "mode": scope.mode,
            }
            if kind in {"git_remote", "cli"}:
                config["direction"] = "bidirectional"
            self.insert(
                project_id=scope.project_id,
                scope_id=scope.id,
                kind=kind,
                name=name,
                config=config,
                created_by=created_by,
                principal_type="scope",
                principal_id=scope.id,
            )

    def count_bound_user_surfaces(self, scope_id: str) -> int:
        access_resp = (
            self._client.table(self.TABLE)
            .select("id", count="exact")
            .eq("scope_id", scope_id)
            .not_.in_("kind", ["git_remote", "cli"])
            .execute()
        )
        connection_resp = (
            self._client.table(self.CONNECTIONS)
            .select("id", count="exact")
            .eq("scope_id", scope_id)
            .execute()
        )
        return (access_resp.count or 0) + (connection_resp.count or 0)

    def touch_run_status(
        self,
        surface_id: str,
        *,
        status: str,
        last_run_at: Optional[datetime] = None,
        last_run_id: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        row = self.get(surface_id)
        if row is None:
            return
        config = dict(row.get("config") or {})
        if last_run_at is not None:
            config["last_run_at"] = last_run_at.isoformat()
        if last_run_id is not None:
            config["last_run_id"] = last_run_id
        config["error_message"] = error_message
        self.update(surface_id, {"status": status, "config": config})

    def touch_heartbeat(self, surface_id: str) -> None:
        row = self.get(surface_id)
        if row is None:
            return
        config = dict(row.get("config") or {})
        config["last_seen_at"] = datetime.now(timezone.utc).isoformat()
        self.update(surface_id, {"config": config})
