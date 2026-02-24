"""
L2.5 Sync — Changelog

Repository + helper for the sync_changelog table.
Provides cursor-based incremental change tracking (Dropbox Delta model).

Usage:
    repo = SyncChangelogRepository(supabase_client)
    repo.append(project_id, node_id, "update", version=3, hash="abc")
    entries = repo.list_since(project_id, cursor=1234, limit=200)
"""

from typing import Optional, List
from dataclasses import dataclass

from src.supabase.client import SupabaseClient


@dataclass
class ChangelogEntry:
    id: int
    project_id: str
    node_id: str
    action: str
    node_type: Optional[str]
    version: int
    hash: Optional[str]
    size_bytes: int
    created_at: Optional[str]
    folder_id: Optional[str] = None
    filename: Optional[str] = None


class SyncChangelogRepository:
    """Append-only change log for cursor-based sync."""

    TABLE = "sync_changelog"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def append(
        self,
        project_id: str,
        node_id: str,
        action: str = "update",
        node_type: Optional[str] = None,
        version: int = 0,
        hash: Optional[str] = None,
        size_bytes: int = 0,
        folder_id: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> ChangelogEntry:
        data = {
            "project_id": project_id,
            "node_id": node_id,
            "action": action,
            "node_type": node_type,
            "version": version,
            "hash": hash,
            "size_bytes": size_bytes,
            "folder_id": folder_id,
            "filename": filename,
        }
        resp = self.client.table(self.TABLE).insert(data).execute()
        return self._to_entry(resp.data[0])

    def list_since(
        self,
        project_id: str,
        cursor: int = 0,
        limit: int = 500,
        folder_id: Optional[str] = None,
    ) -> List[ChangelogEntry]:
        query = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .gt("id", cursor)
            .order("id")
            .limit(limit)
        )
        if folder_id:
            query = query.eq("folder_id", folder_id)
        resp = query.execute()
        return [self._to_entry(r) for r in resp.data]

    def get_latest_cursor(self, project_id: str) -> int:
        resp = (
            self.client.table(self.TABLE)
            .select("id")
            .eq("project_id", project_id)
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]["id"]
        return 0

    def min_cursor(self) -> int:
        """Lowest available cursor (for reset detection)."""
        resp = (
            self.client.table(self.TABLE)
            .select("id")
            .order("id")
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]["id"]
        return 0

    def cleanup_before(self, cutoff_iso: str) -> int:
        resp = (
            self.client.table(self.TABLE)
            .delete()
            .lt("created_at", cutoff_iso)
            .execute()
        )
        return len(resp.data)

    @staticmethod
    def _to_entry(row: dict) -> ChangelogEntry:
        return ChangelogEntry(
            id=row["id"],
            project_id=row["project_id"],
            node_id=row["node_id"],
            action=row["action"],
            node_type=row.get("node_type"),
            version=row.get("version", 0),
            hash=row.get("hash"),
            size_bytes=row.get("size_bytes", 0),
            created_at=row.get("created_at"),
            folder_id=row.get("folder_id"),
            filename=row.get("filename"),
        )
