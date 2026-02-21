"""
L2.5 Sync — Repository

SyncSourceRepository  — CRUD for sync_sources table
NodeSyncRepository    — Sync-related CRUD on content_nodes table (replaces sync_mappings)
"""

from datetime import datetime, timezone
from typing import Optional, List, Any
from src.supabase.client import SupabaseClient
from src.sync.schemas import SyncSource, SyncMapping


class SyncSourceRepository:
    """CRUD for sync_sources table."""

    TABLE = "sync_sources"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _to_model(self, row: dict) -> SyncSource:
        return SyncSource(
            id=row["id"],
            project_id=row["project_id"],
            adapter_type=row["adapter_type"],
            config=row.get("config") or {},
            trigger_config=row.get("trigger_config") or {},
            sync_mode=row.get("sync_mode", "bidirectional"),
            conflict_strategy=row.get("conflict_strategy", "three_way_merge"),
            status=row.get("status", "active"),
            last_error=row.get("last_error"),
            credentials_ref=row.get("credentials_ref"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def create(
        self,
        project_id: str,
        adapter_type: str,
        config: dict,
        trigger_config: Optional[dict] = None,
        sync_mode: str = "bidirectional",
        conflict_strategy: str = "three_way_merge",
        credentials_ref: Optional[str] = None,
    ) -> SyncSource:
        data = {
            "project_id": project_id,
            "adapter_type": adapter_type,
            "config": config,
            "trigger_config": trigger_config or {},
            "sync_mode": sync_mode,
            "conflict_strategy": conflict_strategy,
            "credentials_ref": credentials_ref,
        }
        response = self.client.table(self.TABLE).insert(data).execute()
        return self._to_model(response.data[0])

    def get_by_id(self, source_id: int) -> Optional[SyncSource]:
        response = self.client.table(self.TABLE).select("*").eq("id", source_id).execute()
        return self._to_model(response.data[0]) if response.data else None

    def list_by_project(self, project_id: str) -> List[SyncSource]:
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("project_id", project_id).execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_active(self, adapter_type: Optional[str] = None) -> List[SyncSource]:
        query = self.client.table(self.TABLE).select("*").eq("status", "active")
        if adapter_type:
            query = query.eq("adapter_type", adapter_type)
        return [self._to_model(r) for r in query.execute().data]

    def update_config(self, source_id: int, config: dict) -> None:
        self.client.table(self.TABLE).update({
            "config": config, "updated_at": self._now(),
        }).eq("id", source_id).execute()

    def update_status(self, source_id: int, status: str) -> None:
        self.client.table(self.TABLE).update({
            "status": status, "updated_at": self._now(),
        }).eq("id", source_id).execute()

    def update_error(self, source_id: int, error: str) -> None:
        self.client.table(self.TABLE).update({
            "status": "error", "last_error": error[:1000], "updated_at": self._now(),
        }).eq("id", source_id).execute()

    def delete(self, source_id: int) -> None:
        self.client.table(self.TABLE).delete().eq("id", source_id).execute()


class NodeSyncRepository:
    """
    Sync-related CRUD on content_nodes table.

    Replaces the old SyncMappingRepository. Sync state
    (sync_source_id, external_resource_id, remote_hash, last_sync_version)
    now lives directly on content_nodes rows.
    """

    TABLE = "content_nodes"
    SYNC_SELECT = (
        "id, sync_source_id, external_resource_id, "
        "remote_hash, last_sync_version, sync_status"
    )

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _to_mapping(self, row: dict) -> SyncMapping:
        return SyncMapping(
            source_id=row["sync_source_id"],
            node_id=row["id"],
            external_resource_id=row.get("external_resource_id") or "",
            remote_hash=row.get("remote_hash"),
            last_sync_version=row.get("last_sync_version", 0),
            status=row.get("sync_status", "idle"),
        )

    def list_by_source(self, source_id: int) -> List[SyncMapping]:
        """All content_nodes bound to a given sync source."""
        response = (
            self.client.table(self.TABLE)
            .select(self.SYNC_SELECT)
            .eq("sync_source_id", source_id)
            .execute()
        )
        return [self._to_mapping(r) for r in response.data]

    def get_by_node(self, node_id: str) -> Optional[SyncMapping]:
        """Get sync info for a node. Returns None if node has no sync binding."""
        response = (
            self.client.table(self.TABLE)
            .select(self.SYNC_SELECT)
            .eq("id", node_id)
            .not_.is_("sync_source_id", "null")
            .execute()
        )
        return self._to_mapping(response.data[0]) if response.data else None

    def find_by_resource(
        self, source_id: int, external_resource_id: str,
    ) -> Optional[SyncMapping]:
        """Find the node bound to a specific external resource within a source."""
        response = (
            self.client.table(self.TABLE)
            .select(self.SYNC_SELECT)
            .eq("sync_source_id", source_id)
            .eq("external_resource_id", external_resource_id)
            .execute()
        )
        return self._to_mapping(response.data[0]) if response.data else None

    def bind_node(
        self, node_id: str, source_id: int, external_resource_id: str,
    ) -> SyncMapping:
        """Bind a content node to a sync source + external resource."""
        data = {
            "sync_source_id": source_id,
            "external_resource_id": external_resource_id,
            "sync_status": "synced",
            "updated_at": self._now(),
        }
        response = (
            self.client.table(self.TABLE)
            .update(data)
            .eq("id", node_id)
            .execute()
        )
        return self._to_mapping(response.data[0])

    def update_sync_point(
        self,
        node_id: str,
        last_sync_version: int,
        remote_hash: Optional[str] = None,
    ) -> None:
        """Record a successful sync checkpoint."""
        data: dict[str, Any] = {
            "last_sync_version": last_sync_version,
            "sync_status": "synced",
            "last_synced_at": self._now(),
            "updated_at": self._now(),
        }
        if remote_hash is not None:
            data["remote_hash"] = remote_hash
        self.client.table(self.TABLE).update(data).eq("id", node_id).execute()

    def update_error(self, node_id: str, error: str) -> None:
        """Mark a node's sync status as error."""
        self.client.table(self.TABLE).update({
            "sync_status": "error",
            "updated_at": self._now(),
        }).eq("id", node_id).execute()

    def unbind_node(self, node_id: str) -> None:
        """Remove sync binding from a node."""
        self.client.table(self.TABLE).update({
            "sync_source_id": None,
            "external_resource_id": None,
            "remote_hash": None,
            "last_sync_version": 0,
            "sync_status": "idle",
            "updated_at": self._now(),
        }).eq("id", node_id).execute()

    def unbind_by_source(self, source_id: int) -> None:
        """Clear sync fields for all nodes belonging to a source."""
        self.client.table(self.TABLE).update({
            "sync_source_id": None,
            "external_resource_id": None,
            "remote_hash": None,
            "last_sync_version": 0,
            "sync_status": "idle",
            "updated_at": self._now(),
        }).eq("sync_source_id", source_id).execute()
