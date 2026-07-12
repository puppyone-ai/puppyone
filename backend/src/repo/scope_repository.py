"""Supabase repository for repo_scopes.

This is a thin wrapper around the Supabase client; all business rules
(canonicalization, access_key minting, root-scope protection) live in
scope_service.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.repo.models import RepoScope


def _row_to_scope(row: dict[str, Any]) -> RepoScope:
    return RepoScope(
        id=row["id"],
        project_id=row["project_id"],
        name=row.get("name") or row.get("path") or "Scope",
        path=row.get("path") or "",
        exclude=row.get("exclude") or [],
        mode=row.get("mode") or "rw",
        is_root=row.get("is_root", False),
        # Plaintext credentials are one-time service return values and never
        # hydrate from repo_scopes.
        access_key="",
        access_key_revoked_at=None,
        created_at=_parse_dt(row.get("created_at")),
        updated_at=_parse_dt(row.get("updated_at")),
    )


def _parse_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


class RepoScopeRepository:
    TABLE = "repo_scopes"

    def __init__(self, supabase_client: Optional[SupabaseClient] = None):
        owner = supabase_client or SupabaseClient()
        self._client = owner if callable(getattr(owner, "table", None)) else owner.get_client()

    # ── Reads ────────────────────────────────────────────────────────────

    def list_by_project(self, project_id: str) -> list[RepoScope]:
        """Return all scopes for a project. Root pinned first, then by path."""
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .order("is_root", desc=True)        # root first
            .order("path", desc=False)
            .execute()
        )
        return [_row_to_scope(r) for r in (resp.data or [])]

    def list_paths_by_project(self, project_id: str) -> list[dict[str, str]]:
        response = (
            self._client.table(self.TABLE)
            .select("path")
            .eq("project_id", project_id)
            .execute()
        )
        return [{"path": row.get("path") or ""} for row in (response.data or [])]

    def get(self, scope_id: str) -> Optional[RepoScope]:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("id", scope_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return _row_to_scope(rows[0]) if rows else None

    def get_by_access_key(self, access_key: str) -> Optional[RepoScope]:
        from src.repo.access_surface_repository import AccessSurfaceRepository

        surface = AccessSurfaceRepository(self._client).resolve_scope_credential(access_key)
        scope = self.get(surface["scope_id"]) if surface else None
        if (
            scope is not None
            and surface.get("_credential_mode") == "r"
            and scope.mode == "rw"
        ):
            return replace(scope, mode="r")
        return scope

    def get_root_scope(self, project_id: str) -> Optional[RepoScope]:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .eq("is_root", True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return _row_to_scope(rows[0]) if rows else None

    def find_by_path_prefix(
        self, project_id: str, path: str,
    ) -> Optional[RepoScope]:
        """Return the scope whose path is the longest prefix of `path`.
        Used by path-to-scope inference.

        Example: scopes ['', 'docs', 'docs/handbook']; path='docs/handbook/x.md'
        → returns the 'docs/handbook' scope."""
        all_scopes = self.list_by_project(project_id)
        target = (path or "").strip("/")
        # All scopes ordered shortest-to-longest path.
        candidates = sorted(all_scopes, key=lambda s: len(s.path))
        best: Optional[RepoScope] = None
        for s in candidates:
            sp = s.path
            if sp == "" or target == sp or target.startswith(sp + "/"):
                if best is None or len(s.path) > len(best.path):
                    best = s
        return best

    # ── Writes ───────────────────────────────────────────────────────────

    def insert(
        self,
        *,
        project_id: str,
        name: str,
        path: str,
        exclude: list[str],
        mode: str,
        is_root: bool,
    ) -> RepoScope:
        """Insert a new scope. Access surfaces are created explicitly by
        ScopeService after this row is persisted."""
        row: dict[str, Any] = {
            "project_id": project_id,
            "name": name,
            "path": path,
            "exclude": exclude,
            "mode": mode,
            "is_root": is_root,
        }
        resp = self._client.table(self.TABLE).insert(row).execute()
        return _row_to_scope(resp.data[0])

    def update(
        self,
        scope_id: str,
        *,
        name: Optional[str] = None,
        exclude: Optional[list[str]] = None,
        mode: Optional[str] = None,
    ) -> Optional[RepoScope]:
        patch: dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if exclude is not None:
            patch["exclude"] = exclude
        if mode is not None:
            patch["mode"] = mode
        if not patch:
            return self.get(scope_id)
        resp = (
            self._client.table(self.TABLE)
            .update(patch)
            .eq("id", scope_id)
            .execute()
        )
        rows = resp.data or []
        return _row_to_scope(rows[0]) if rows else None

    def delete(self, scope_id: str) -> bool:
        """Hard delete. The DB cascades scope-bound access surfaces.
        Service layer is responsible for refusing to delete root scopes."""
        resp = (
            self._client.table(self.TABLE)
            .delete()
            .eq("id", scope_id)
            .execute()
        )
        return bool(resp.data)

    def update_path(self, scope_id: str, path: str) -> bool:
        """Infrastructure hook for a committed folder move.

        User-facing path changes still go through ScopeService; this narrow
        method keeps post-commit referential maintenance inside the repository.
        """
        response = (
            self._client.table(self.TABLE)
            .update({"path": path})
            .eq("id", scope_id)
            .execute()
        )
        return bool(response.data)
