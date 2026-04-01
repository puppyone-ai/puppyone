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


class SyncRepository:
    """CRUD for sync bindings in the `access_points` table (provider != 'agent')."""

    TABLE = "access_points"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

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
            last_sync_version=row.get("last_sync_version", 0),
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
        response = self.client.table(self.TABLE).insert(data).execute()
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

    def get_by_path(self, path: str) -> Optional[Sync]:
        """Get the first sync binding for a path (exact match)."""
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("path", path).limit(1).execute()
        )
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
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .neq("provider", "agent")
            .execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_by_path(self, path: str) -> List[Sync]:
        """All sync bindings for a given path."""
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("path", path).execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_active(self, provider: Optional[str] = None) -> List[Sync]:
        query = self.client.table(self.TABLE).select("*").eq("status", "active").neq("provider", "agent")
        if provider:
            query = query.eq("provider", provider)
        return [self._to_model(r) for r in query.execute().data]

    def list_by_provider(
        self, project_id: str, provider: str,
    ) -> List[Sync]:
        """All syncs for a project + provider combination."""
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .eq("provider", provider)
            .execute()
        )
        return [self._to_model(r) for r in response.data]

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
        last_sync_version: int,
        remote_hash: Optional[str] = None,
    ) -> None:
        """Record a successful sync checkpoint."""
        data: dict[str, Any] = {
            "last_sync_version": last_sync_version,
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
