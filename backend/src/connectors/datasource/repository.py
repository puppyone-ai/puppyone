"""
Unified Sync — Repository

SyncRepository — CRUD for sync bindings in the `access_points` table.

The `access_points` table is the unified store for all access points
(syncs + agents). SyncRepository operates on rows where provider != 'agent'.
Each sync row represents one sync binding between a MUT path and an
external resource.
"""

from datetime import datetime, timezone
from typing import Optional, List, Any
from src.infra.supabase.client import SupabaseClient
from src.connectors.datasource.schemas import Sync


def _is_table_missing(exc: Exception) -> bool:
    """Detect the postgrest 'table not in schema cache' error.

    `access_points` was dropped post-redesign by 20260502000700_drop_access_points.sql.
    Until every legacy caller has been migrated to repo_scopes/connectors, the
    safe behaviour for read paths is to return empty rather than 500. Writes
    still raise — they're either dead code or genuine bugs to surface.
    """
    return "PGRST205" in str(exc) or "schema cache" in str(exc).lower()


class SyncRepository:
    """CRUD for sync bindings in the `access_points` table (provider != 'agent').

    NOTE: this table was dropped post-redesign. All read methods here now
    return empty when the table is missing; the new model lives in
    repo_scopes + connectors (see src/repo/). Callers that still depend on
    SyncRepository should be migrated; this layer's tolerance is a transition
    safety net, not a permanent contract.
    """

    TABLE = "access_points"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def _safe_list(self, build_query) -> list:
        """Execute a list query, returning [] if the legacy table was dropped."""
        try:
            return build_query().execute().data or []
        except Exception as e:
            if _is_table_missing(e):
                return []
            raise

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _to_model(self, row: dict) -> Sync:
        return Sync(
            id=row["id"],
            project_id=row["project_id"],
            path=row.get("path"),
            direction=row.get("direction", "inbound"),
            provider=row.get("provider", ""),
            authority=row.get("authority", "authoritative"),
            config=row.get("config") or {},
            credentials_ref=row.get("credentials_ref"),
            access_key=row.get("access_key"),
            trigger=row.get("trigger") or {},
            conflict_strategy=row.get("conflict_strategy"),
            status=row.get("status", "active"),
            cursor=row.get("cursor"),
            last_synced_at=row.get("last_synced_at"),
            error_message=row.get("error_message"),
            remote_hash=row.get("remote_hash"),
            last_sync_commit_id=row.get("last_sync_commit_id", "") or "",
            created_by=row.get("created_by"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

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
        data: dict[str, Any] = {
            "project_id": project_id,
            "path": path,
            "direction": direction,
            "provider": provider,
            "authority": authority,
            "config": config or {},
            "credentials_ref": credentials_ref,
            "access_key": access_key,
            "trigger": trigger or {},
            "conflict_strategy": conflict_strategy,
            "status": status,
        }
        from postgrest.exceptions import APIError
        try:
            response = self.client.table(self.TABLE).insert(data).execute()
        except APIError as e:
            if "23505" in str(e):
                raise ValueError(f"A sync already exists for path '{path}'. Remove it first or use a different path.")
            raise
        return self._to_model(response.data[0])

    # ============================================================
    # Read — single
    # ============================================================

    def get_by_id(self, sync_id: str) -> Optional[Sync]:
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("id", sync_id).execute()
        )
        return self._to_model(response.data[0]) if response.data else None

    def get_by_path(self, path: str, project_id: str | None = None) -> Optional[Sync]:
        """Get the first sync binding for a path (exact match).

        ``project_id`` is optional for legacy callers, but new access-point
        creation must pass it. A bare path is not globally unique across
        projects, and returning another project's access key is a security bug.
        """
        query = self.client.table(self.TABLE).select("*").eq("path", path)
        if project_id:
            query = query.eq("project_id", project_id)
        response = query.limit(1).execute()
        return self._to_model(response.data[0]) if response.data else None

    def find_owner_by_path(self, file_path: str) -> Optional[Sync]:
        """Find the access point that owns this file path.

        Walks up the path tree to find the nearest ancestor folder
        that is an access point mount point. Returns the most specific
        (longest path) match.
        """
        parts = file_path.split("/")
        candidates = ["/".join(parts[:i]) for i in range(len(parts), 0, -1)]
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .in_("path", candidates)
            .neq("provider", "agent")
            .eq("status", "active")
            .execute()
        )
        if not response.data:
            return None
        best = max(response.data, key=lambda r: len(r.get("path") or ""))
        return self._to_model(best)

    def get_by_access_key(self, access_key: str) -> Optional[Sync]:
        """Lookup sync by CLI/MCP access key (unique index)."""
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("access_key", access_key)
            .limit(1)
            .execute()
        )
        return self._to_model(response.data[0]) if response.data else None

    def find_by_config_key(
        self, provider: str, key: str, value: str,
    ) -> Optional[Sync]:
        """Find a single active sync whose config->>key matches value."""
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("provider", provider)
            .eq("status", "active")
            .eq(f"config->>{key}", value)
            .limit(1)
            .execute()
        )
        return self._to_model(response.data[0]) if response.data else None

    # ============================================================
    # Read — lists
    # ============================================================

    def list_by_project(self, project_id: str) -> List[Sync]:
        rows = self._safe_list(
            lambda: self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .neq("provider", "agent")
        )
        return [self._to_model(r) for r in rows]

    def list_by_path(self, path: str) -> List[Sync]:
        """All sync bindings for a given path."""
        rows = self._safe_list(
            lambda: self.client.table(self.TABLE).select("*").eq("path", path)
        )
        return [self._to_model(r) for r in rows]

    def list_active(self, provider: Optional[str] = None) -> List[Sync]:
        def build():
            q = self.client.table(self.TABLE).select("*").eq("status", "active").neq("provider", "agent")
            if provider:
                q = q.eq("provider", provider)
            return q
        return [self._to_model(r) for r in self._safe_list(build)]

    def list_by_provider(
        self, project_id: str, provider: str,
    ) -> List[Sync]:
        """All syncs for a project + provider combination."""
        rows = self._safe_list(
            lambda: self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .eq("provider", provider)
        )
        return [self._to_model(r) for r in rows]

    # ============================================================
    # Update
    # ============================================================

    def update(self, sync_id: str, **fields: Any) -> None:
        """Generic partial update. Automatically sets updated_at."""
        fields["updated_at"] = self._now()
        self.client.table(self.TABLE).update(fields).eq("id", sync_id).execute()

    def update_config(self, sync_id: str, config: dict) -> None:
        self.update(sync_id, config=config)

    def update_status(self, sync_id: str, status: str) -> None:
        self.update(sync_id, status=status)

    def update_sync_point(
        self,
        sync_id: str,
        last_sync_commit_id: str,
        remote_hash: Optional[str] = None,
    ) -> None:
        """Record a successful sync checkpoint.

        ``last_sync_commit_id`` is the MUT ``commit_id`` produced by
        the most recent inbound write, or returned by the most recent
        outbound push.
        """
        data: dict[str, Any] = {
            "last_sync_commit_id": last_sync_commit_id,
            "status": "active",
            "last_synced_at": self._now(),
            "updated_at": self._now(),
        }
        if remote_hash is not None:
            data["remote_hash"] = remote_hash
        self.client.table(self.TABLE).update(data).eq("id", sync_id).execute()

    def update_error(self, sync_id: str, error: str) -> None:
        self.client.table(self.TABLE).update({
            "status": "error",
            "error_message": error[:1000],
            "updated_at": self._now(),
        }).eq("id", sync_id).execute()

    def touch_heartbeat(self, sync_id: str) -> None:
        """Update updated_at as daemon heartbeat."""
        self.client.table(self.TABLE).update({
            "updated_at": self._now(),
        }).eq("id", sync_id).execute()

    def update_cursor(self, sync_id: str, cursor: int) -> None:
        self.update(sync_id, cursor=cursor)

    # ============================================================
    # Delete
    # ============================================================

    def delete(self, sync_id: str) -> None:
        self.client.table(self.TABLE).delete().eq("id", sync_id).execute()

    def delete_by_path(self, path: str) -> None:
        """Remove all sync bindings for a path."""
        self.client.table(self.TABLE).delete().eq("path", path).execute()

    def delete_by_project(self, project_id: str) -> None:
        """Remove all syncs for a project."""
        self.client.table(self.TABLE).delete().eq("project_id", project_id).execute()
