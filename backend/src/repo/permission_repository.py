"""Supabase repository for repo_user_permissions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.repo.models import RepoUserPermission


def _row_to_perm(row: dict[str, Any]) -> RepoUserPermission:
    return RepoUserPermission(
        id=row["id"],
        project_id=row["project_id"],
        user_id=row["user_id"],
        role=row["role"],
        allowed_scope_ids=row.get("allowed_scope_ids"),
        granted_by=row.get("granted_by"),
        granted_at=_parse_dt(row["granted_at"]),
    )


def _parse_dt(v: Any) -> datetime:
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


class RepoUserPermissionRepository:
    TABLE = "repo_user_permissions"

    def __init__(self, supabase_client: Optional[SupabaseClient] = None):
        self._client = (supabase_client or SupabaseClient()).get_client()

    def list_by_project(self, project_id: str) -> list[RepoUserPermission]:
        resp = (
            self._client.table(self.TABLE)
            .select("*").eq("project_id", project_id)
            .execute()
        )
        return [_row_to_perm(r) for r in (resp.data or [])]

    def get(self, project_id: str, user_id: str) -> Optional[RepoUserPermission]:
        resp = (
            self._client.table(self.TABLE).select("*")
            .eq("project_id", project_id).eq("user_id", user_id)
            .limit(1).execute()
        )
        rows = resp.data or []
        return _row_to_perm(rows[0]) if rows else None

    def upsert(
        self, *, project_id: str, user_id: str, role: str,
        allowed_scope_ids: Optional[list[str]],
        granted_by: Optional[str],
    ) -> RepoUserPermission:
        resp = (
            self._client.table(self.TABLE).upsert({
                "project_id": project_id,
                "user_id": user_id,
                "role": role,
                "allowed_scope_ids": allowed_scope_ids,
                "granted_by": granted_by,
            }, on_conflict="project_id,user_id").execute()
        )
        return _row_to_perm(resp.data[0])

    def delete(self, project_id: str, user_id: str) -> bool:
        resp = (
            self._client.table(self.TABLE).delete()
            .eq("project_id", project_id).eq("user_id", user_id)
            .execute()
        )
        return bool(resp.data)
