"""
L2 Collaboration — AuditRepository

Data access layer for the audit_logs table.
"""

from typing import Optional, Any, List
from src.infra.supabase.client import SupabaseClient


class AuditRepository:
    """Data access for the audit_logs table"""

    TABLE_NAME = "audit_logs"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    def insert(
        self,
        action: str,
        path: str,
        operator_type: str = "user",
        operator_id: Optional[str] = None,
        old_version: Optional[int] = None,
        new_version: Optional[int] = None,
        status: Optional[str] = None,
        strategy: Optional[str] = None,
        conflict_details: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """Insert an audit log entry"""
        data: dict[str, Any] = {
            "action": action,
            "path": path,
            "operator_type": operator_type,
        }
        if operator_id is not None:
            data["operator_id"] = operator_id
        if old_version is not None:
            data["old_version"] = old_version
        if new_version is not None:
            data["new_version"] = new_version
        if status is not None:
            data["status"] = status
        if strategy is not None:
            data["strategy"] = strategy
        if conflict_details is not None:
            data["conflict_details"] = conflict_details
        if metadata is not None:
            data["metadata"] = metadata

        self.client.table(self.TABLE_NAME).insert(data).execute()

    def list_by_path(
        self, path: str, limit: int = 50, offset: int = 0
    ) -> List[dict]:
        """Query audit logs for a node"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("path", path)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data

    def list_by_paths(
        self, paths: List[str], limit: int = 100, offset: int = 0
    ) -> List[dict]:
        """Query audit logs for multiple nodes"""
        if not paths:
            return []
        response = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .in_("path", paths)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data

    def count_by_path(self, path: str) -> int:
        """Count audit log entries for a node"""
        response = (
            self.client.table(self.TABLE_NAME)
            .select("id", count="exact")
            .eq("path", path)
            .execute()
        )
        return response.count or 0
