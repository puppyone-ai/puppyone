"""
Unified Sync — Repository

SyncRepository — CRUD for the `syncs` table.

The `syncs` table replaces both the old `sync_sources` table and the
sync-related fields that used to live on `content_nodes`. Each row in
`syncs` represents one sync binding between a content_node and an
external resource.
"""

from datetime import datetime, timezone
from typing import Optional, List, Any
from src.supabase.client import SupabaseClient
from src.sync.schemas import Sync


class SyncRepository:
    """CRUD for the unified `syncs` table."""

    TABLE = "syncs"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _to_model(self, row: dict) -> Sync:
        return Sync(
            id=row["id"],
            project_id=row["project_id"],
            node_id=row["node_id"],
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
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    # ============================================================
    # Create
    # ============================================================

    def create(
        self,
        project_id: str,
        node_id: str,
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
            "node_id": node_id,
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

    def get_by_node(self, node_id: str) -> Optional[Sync]:
        """Get the first sync binding for a node (convenience for single-sync nodes)."""
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("node_id", node_id).limit(1).execute()
        )
        return self._to_model(response.data[0]) if response.data else None

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
            .select("*").eq("project_id", project_id).execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_by_node(self, node_id: str) -> List[Sync]:
        """All sync bindings for a given node."""
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("node_id", node_id).execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_active(self, provider: Optional[str] = None) -> List[Sync]:
        query = self.client.table(self.TABLE).select("*").eq("status", "active")
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

    def delete_by_node(self, node_id: str) -> None:
        """Remove all sync bindings for a node."""
        self.client.table(self.TABLE).delete().eq("node_id", node_id).execute()

    def delete_by_project(self, project_id: str) -> None:
        """Remove all syncs for a project."""
        self.client.table(self.TABLE).delete().eq("project_id", project_id).execute()
