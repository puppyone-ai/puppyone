"""Supabase repository for connectors."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.repo.models import Connector


def _row_to_connector(row: dict[str, Any]) -> Connector:
    return Connector(
        id=row["id"],
        project_id=row["project_id"],
        scope_id=row["scope_id"],
        provider=row["provider"],
        name=row["name"],
        direction=row["direction"],
        config=row.get("config") or {},
        oauth_connection_id=row.get("oauth_connection_id"),
        trigger=row.get("trigger") or {"type": "manual"},
        status=row.get("status") or "active",
        last_run_at=_parse_dt(row.get("last_run_at")),
        last_run_id=row.get("last_run_id"),
        error_message=row.get("error_message"),
        created_by=row.get("created_by"),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _parse_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


class ConnectorRepository:
    TABLE = "connectors"

    def __init__(self, supabase_client: Optional[SupabaseClient] = None):
        self._client = (supabase_client or SupabaseClient()).get_client()

    # ── Reads ────────────────────────────────────────────────────────────

    def list_by_project(
        self,
        project_id: str,
        *,
        scope_id: Optional[str] = None,
        provider: Optional[str] = None,
        direction: Optional[str] = None,
    ) -> list[Connector]:
        q = self._client.table(self.TABLE).select("*").eq("project_id", project_id)
        if scope_id:
            q = q.eq("scope_id", scope_id)
        if provider:
            q = q.eq("provider", provider)
        if direction:
            q = q.eq("direction", direction)
        resp = q.order("created_at", desc=False).execute()
        return [_row_to_connector(r) for r in (resp.data or [])]

    def get(self, connector_id: str) -> Optional[Connector]:
        resp = (
            self._client.table(self.TABLE)
            .select("*").eq("id", connector_id).limit(1)
            .execute()
        )
        rows = resp.data or []
        return _row_to_connector(rows[0]) if rows else None

    def get_agent_by_mcp_key(self, mcp_api_key: str) -> Optional[Connector]:
        """Hot path: MCP service resolves an agent from its api key.

        Replaces the old AccessPoint.get_by_mcp_api_key code path that
        queried access_points where provider='agent'. Now we look in
        connectors with provider='agent' and config.mcp_api_key=<key>.
        """
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("provider", "agent")
            .filter("config->>mcp_api_key", "eq", mcp_api_key)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return _row_to_connector(rows[0]) if rows else None

    def count_third_party_for_scope(self, scope_id: str) -> int:
        """How many user-created (non-cli/non-agent) connectors are attached
        to this scope. Used by scope deletion to refuse if non-zero."""
        resp = (
            self._client.table(self.TABLE)
            .select("id", count="exact")
            .eq("scope_id", scope_id)
            .not_.in_("provider", ["cli", "agent"])
            .execute()
        )
        return resp.count or 0

    # ── Writes ───────────────────────────────────────────────────────────

    def insert(
        self,
        *,
        project_id: str,
        scope_id: str,
        provider: str,
        name: str,
        direction: str,
        config: dict,
        oauth_connection_id: Optional[int],
        trigger: dict,
        created_by: Optional[str],
    ) -> Connector:
        resp = (
            self._client.table(self.TABLE)
            .insert({
                "project_id": project_id,
                "scope_id": scope_id,
                "provider": provider,
                "name": name,
                "direction": direction,
                "config": config,
                "oauth_connection_id": oauth_connection_id,
                "trigger": trigger,
                "created_by": created_by,
            })
            .execute()
        )
        return _row_to_connector(resp.data[0])

    def update(self, connector_id: str, patch: dict[str, Any]) -> Optional[Connector]:
        if not patch:
            return self.get(connector_id)
        resp = (
            self._client.table(self.TABLE)
            .update(patch).eq("id", connector_id).execute()
        )
        rows = resp.data or []
        return _row_to_connector(rows[0]) if rows else None

    def update_run_status(
        self, connector_id: str, *, status: str, last_run_at: Optional[datetime] = None,
        last_run_id: Optional[str] = None, error_message: Optional[str] = None,
    ) -> None:
        patch = {"status": status}
        if last_run_at is not None:
            patch["last_run_at"] = last_run_at.isoformat()
        if last_run_id is not None:
            patch["last_run_id"] = last_run_id
        patch["error_message"] = error_message      # may be None to clear
        self._client.table(self.TABLE).update(patch).eq("id", connector_id).execute()

    def delete(self, connector_id: str) -> bool:
        resp = self._client.table(self.TABLE).delete().eq("id", connector_id).execute()
        return bool(resp.data)
