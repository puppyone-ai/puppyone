"""
SupabaseScopeManager — PostgreSQL implementation of Mut ScopeBackend

Scope data is stored in connections.config.scope (JSONB).
Each connection (agent/mcp/sandbox) can have its own scope definition.

Interface-compatible with Mut's native FileSystemScopeBackend:
  scope_id = connection.id
  scope = {"id": ..., "path": ..., "exclude": [...]}
"""

from __future__ import annotations

from mut.server.scope_manager import ScopeBackend

from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_error


class SupabaseScopeBackend(ScopeBackend):
    """Mut ScopeBackend backed by connections.config.scope in PostgreSQL."""

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    def get(self, scope_id: str) -> dict | None:
        try:
            resp = (
                self._client.table("connections")
                .select("id, config")
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .maybe_single()
                .execute()
            )
            if not resp.data:
                return None
            config = resp.data.get("config") or {}
            scope = config.get("scope")
            if not scope:
                return None
            scope.setdefault("id", scope_id)
            return scope
        except Exception as e:
            log_error(f"[ScopeBackend] get({scope_id}) failed: {e}")
            return None

    def put(self, scope_id: str, scope: dict) -> None:
        try:
            resp = (
                self._client.table("connections")
                .select("config")
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .maybe_single()
                .execute()
            )
            if not resp.data:
                return
            config = dict(resp.data.get("config") or {})
            config["scope"] = {
                "path": scope.get("path", ""),
                "exclude": scope.get("exclude", []),
                "mode": scope.get("mode", "rw"),
            }
            (
                self._client.table("connections")
                .update({"config": config})
                .eq("id", scope_id)
                .execute()
            )
        except Exception as e:
            log_error(f"[ScopeBackend] put({scope_id}) failed: {e}")

    def delete(self, scope_id: str) -> bool:
        try:
            resp = (
                self._client.table("connections")
                .select("config")
                .eq("id", scope_id)
                .eq("project_id", self._project_id)
                .maybe_single()
                .execute()
            )
            if not resp.data:
                return False
            config = dict(resp.data.get("config") or {})
            if "scope" not in config:
                return False
            del config["scope"]
            (
                self._client.table("connections")
                .update({"config": config})
                .eq("id", scope_id)
                .execute()
            )
            return True
        except Exception as e:
            log_error(f"[ScopeBackend] delete({scope_id}) failed: {e}")
            return False

    def list_all(self) -> list[dict]:
        try:
            resp = (
                self._client.table("connections")
                .select("id, config")
                .eq("project_id", self._project_id)
                .not_.is_("config", "null")
                .execute()
            )
            scopes = []
            for row in resp.data or []:
                config = row.get("config") or {}
                scope = config.get("scope")
                if scope:
                    scope.setdefault("id", row["id"])
                    scopes.append(scope)
            return scopes
        except Exception as e:
            log_error(f"[ScopeBackend] list_all() failed: {e}")
            return []

    def find_by_path_prefix(self, path_prefix: str) -> list[dict]:
        """Find scopes whose path starts with the given prefix.

        Used by post-commit hooks to update scopes when folders are renamed.
        """
        all_scopes = self.list_all()
        prefix = path_prefix.rstrip("/") + "/"
        return [
            s for s in all_scopes
            if s.get("path", "").startswith(prefix) or s.get("path", "") == path_prefix.rstrip("/")
        ]
