"""
L2 Collaboration — AuditRepository

Data access layer for the audit_logs table.
"""

from typing import Any

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
        project_id: str | None = None,
        operator_type: str = "user",
        operator_id: str | None = None,
        old_version: int | None = None,
        new_version: int | None = None,
        status: str | None = None,
        strategy: str | None = None,
        conflict_details: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Insert an audit log entry"""
        data: dict[str, Any] = {
            "action": action,
            "path": path,
            "operator_type": operator_type,
        }
        if project_id is not None:
            data["project_id"] = project_id
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
        self, path: str, limit: int = 50, offset: int = 0, project_id: str | None = None,
    ) -> list[dict]:
        """Query audit logs for a path, scoped by project_id."""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .eq("path", path)
        )
        if project_id:
            query = query.eq("project_id", project_id)
        response = (
            query
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data

    def list_by_paths(
        self, paths: list[str], limit: int = 100, offset: int = 0, project_id: str | None = None,
    ) -> list[dict]:
        """Query audit logs for multiple paths, scoped by project_id."""
        if not paths:
            return []
        query = (
            self.client.table(self.TABLE_NAME)
            .select("*")
            .in_("path", paths)
        )
        if project_id:
            query = query.eq("project_id", project_id)
        response = (
            query
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data

    def count_by_path(self, path: str, project_id: str | None = None) -> int:
        """Count audit log entries for a path, scoped by project_id."""
        query = (
            self.client.table(self.TABLE_NAME)
            .select("id", count="exact")
            .eq("path", path)
        )
        if project_id:
            query = query.eq("project_id", project_id)
        response = query.execute()
        return response.count or 0
