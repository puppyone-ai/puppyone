"""
SupabaseScopeManager — PostgreSQL implementation of scope storage

Scope geometry lives in the dedicated `repo_scopes` table. This module
reads from there.

Scope payload:
  scope_id = repo_scopes.id
  scope    = {"id", "path", "exclude", "mode"}
"""

from __future__ import annotations

from src.version_engine.infrastructure.supabase import safe_data
from src.version_engine.infrastructure.supabase.scope_manager import ScopeBackend

from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_error


def find_scope_by_access_key(
    supabase: SupabaseClient,
    access_key: str,
) -> dict | None:
    """Look up the ``repo_scopes`` row that owns ``access_key``.

    L2 identity + L1 access-point routing both need this lookup, and the
    SQL used to be duplicated between them. The repository module is the
    single source of truth so that revocation handling, column selection,
    and project_id checks live in one place.

    Returns the full row including ``access_key_revoked_at`` so callers
    can decide whether to honor or reject the credential. Returns
    ``None`` when the key is unknown; callers translate that to a 401.
    """
    try:
        from src.config import settings

        select_cols = "id, project_id, path, exclude, mode, access_key_revoked_at"
        if settings.SCOPE_ACCESS_KEY_HASH_LOOKUP:
            # ISSUE-003: resolve by HMAC hash first, then fall back to the
            # plaintext column for rows not yet backfilled.
            from src.repo.access_credentials import access_token_hash
            resp = (
                supabase.client.table("repo_scopes")
                .select(select_cols)
                .eq("access_key_hash", access_token_hash(access_key))
                .limit(1)
                .execute()
            )
            rows = safe_data(resp)
            if rows:
                return rows[0]

        resp = (
            supabase.client.table("repo_scopes")
            .select(select_cols)
            .eq("access_key", access_key)
            .limit(1)
            .execute()
        )
        rows = safe_data(resp)
        if not rows:
            return None
        return rows[0]
    except Exception as e:
        log_error(f"[scope_repository] find_scope_by_access_key failed: {e}")
        return None


class SupabaseScopeBackend(ScopeBackend):
    """ScopeBackend backed by the repo_scopes table.

    Each row is the canonical scope record:
      - path / exclude / mode are real columns (not JSONB extraction)
      - access_key on the same row drives scoped version access
    """

    TABLE = "repo_scopes"

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    # ── ScopeBackend interface ────────────────────────────────────────────

    def get(self, scope_id: str) -> dict | None:
        try:
            resp = (
                self._client.table(self.TABLE)
                .select("id, path, exclude, mode")
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .maybe_single()
                .execute()
            )
            if not resp or not getattr(resp, "data", None):
                return None
            row = resp.data
            return {
                "id": row["id"],
                "path": row.get("path", ""),
                "exclude": row.get("exclude") or [],
                "mode": row.get("mode", "rw"),
            }
        except Exception as e:
            log_error(f"[ScopeBackend] get({scope_id}) failed: {e}")
            return None

    def put(self, scope_id: str, scope: dict) -> None:
        """Update an existing scope's geometry. The scope row must already
        exist (created via the repo scope_router); this is the rename /
        exclude-edit path that post-commit hooks use
        when folders move.

        Note: `path` IS updatable here even though the public scope CRUD
        API forbids it. This is the internal hook for "user renamed a
        folder, so the scope's path needs to change too" — a maintenance
        op the library performs, not a user-facing rename.
        """
        try:
            patch: dict = {}
            if "path" in scope:
                patch["path"] = scope["path"]
            if "exclude" in scope:
                patch["exclude"] = scope.get("exclude") or []
            if "mode" in scope:
                patch["mode"] = scope.get("mode", "rw")
            if not patch:
                return
            (
                self._client.table(self.TABLE)
                .update(patch)
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .execute()
            )
        except Exception as e:
            log_error(f"[ScopeBackend] put({scope_id}) failed: {e}")

    def delete(self, scope_id: str) -> bool:
        """Hard-delete the scope row.

        Service layer (`scope_service.delete()`) is the user-facing path
        and refuses to delete root or scopes with bound non-builtin
        connectors. This low-level method is unconditional — used by
        post-commit hooks for orphan cleanup.
        """
        try:
            resp = (
                self._client.table(self.TABLE)
                .delete()
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .execute()
            )
            return bool(resp.data)
        except Exception as e:
            log_error(f"[ScopeBackend] delete({scope_id}) failed: {e}")
            return False

    def list_all(self) -> list[dict]:
        try:
            resp = (
                self._client.table(self.TABLE)
                .select("id, path, exclude, mode")
                .eq("project_id", self._project_id)
                .execute()
            )
            return [
                {
                    "id": row["id"],
                    "path": row.get("path", ""),
                    "exclude": row.get("exclude") or [],
                    "mode": row.get("mode", "rw"),
                }
                for row in (resp.data or [])
            ]
        except Exception as e:
            log_error(f"[ScopeBackend] list_all() failed: {e}")
            return []

    def find_by_path_prefix(self, path_prefix: str) -> list[dict]:
        """Find scopes whose path starts with the given prefix.

        Used by post-commit hooks to update scopes when folders are
        renamed (the canonical case: user renames /docs → /handbook,
        every scope whose path starts with 'docs/' needs its path
        updated to start with 'handbook/').
        """
        all_scopes = self.list_all()
        prefix = path_prefix.rstrip("/")
        prefix_with_slash = prefix + "/"
        return [
            s for s in all_scopes
            if s.get("path", "") == prefix
            or s.get("path", "").startswith(prefix_with_slash)
        ]
