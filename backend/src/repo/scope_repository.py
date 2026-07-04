"""Supabase repository for repo_scopes.

This is a thin wrapper around the Supabase client; all business rules
(canonicalization, access_key minting, root-scope protection) live in
scope_service.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from src.infra.supabase.client import SupabaseClient
from src.repo.models import RepoScope


def _row_to_scope(row: dict[str, Any]) -> RepoScope:
    return RepoScope(
        id=row["id"],
        project_id=row["project_id"],
        name=row["name"],
        path=row["path"],
        exclude=row.get("exclude") or [],
        mode=row["mode"],
        is_root=row.get("is_root", False),
        access_key=row["access_key"],
        access_key_revoked_at=_parse_dt(row.get("access_key_revoked_at")),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
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
        self._client = (supabase_client or SupabaseClient()).get_client()

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
        """Hot path: access-key auth resolves an access_key to its scope.

        When SCOPE_ACCESS_KEY_HASH_LOOKUP is enabled (ISSUE-003) we resolve by
        HMAC hash first, then fall back to the plaintext column for rows not yet
        backfilled. With the flag off, behaviour is exactly the plaintext lookup.
        """
        from src.config import settings

        if settings.SCOPE_ACCESS_KEY_HASH_LOOKUP:
            from src.repo.access_credentials import access_token_hash
            resp = (
                self._client.table(self.TABLE)
                .select("*")
                .eq("access_key_hash", access_token_hash(access_key))
                .is_("access_key_revoked_at", "null")
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if rows:
                return _row_to_scope(rows[0])
            # fall through: row may predate the backfill and only have plaintext

        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("access_key", access_key)
            .is_("access_key_revoked_at", "null")
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return _row_to_scope(rows[0]) if rows else None

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
        access_key: str,
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
            "access_key": access_key,
        }
        from src.config import settings
        if settings.SCOPE_ACCESS_KEY_HASH_LOOKUP:
            from src.repo.access_credentials import access_token_hash
            row["access_key_hash"] = access_token_hash(access_key)
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

    def regenerate_access_key(self, scope_id: str, new_key: str) -> bool:
        """Atomic: mark old key revoked AND set new key. We reuse the same
        column (no separate history table) so old-key auth fails immediately."""
        patch: dict[str, Any] = {
            "access_key": new_key,
            "access_key_revoked_at": None,
        }
        from src.config import settings
        if settings.SCOPE_ACCESS_KEY_HASH_LOOKUP:
            from src.repo.access_credentials import access_token_hash
            patch["access_key_hash"] = access_token_hash(new_key)
        resp = (
            self._client.table(self.TABLE)
            .update(patch)
            .eq("id", scope_id)
            .execute()
        )
        return bool(resp.data)

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
