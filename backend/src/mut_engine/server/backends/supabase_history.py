"""
SupabaseHistoryManager — PostgreSQL implementation of Mut History

Uses the mut_commits table to store version history, the projects table
for global version counter, and mut_scope_state table for per-scope
version + hash tracking.

Interface-compatible with Mut's native HistoryManager (filesystem JSON).
"""

from __future__ import annotations

import json

from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data as _safe_data
from src.utils.logger import log_info


class SupabaseHistoryManager:
    """Supabase/PostgreSQL implementation of Mut HistoryManager.

    Supports per-scope versioning (scope_hash, scope_version) alongside
    global version counter for cross-scope ordering.
    """

    TABLE = "mut_commits"
    SCOPE_STATE_TABLE = "mut_scope_state"

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    # ── Global Version ──

    def get_latest_version(self) -> int:
        resp = (
            self._client.table("projects")
            .select("mut_version")
            .eq("id", self._project_id)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("mut_version", 0) if data else 0

    def set_latest_version(self, version: int) -> None:
        self._client.table("projects").update(
            {"mut_version": version}
        ).eq("id", self._project_id).execute()

    # ── Global Root Hash (deprecated, kept for backwards compat) ──

    def get_root_hash(self) -> str:
        resp = (
            self._client.table("projects")
            .select("mut_root_hash")
            .eq("id", self._project_id)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("mut_root_hash", "") if data else ""

    def set_root_hash(self, h: str) -> None:
        self._client.table("projects").update(
            {"mut_root_hash": h}
        ).eq("id", self._project_id).execute()

    # ── Per-Scope Version + Hash ──

    def get_scope_version(self, scope_path: str) -> int:
        norm = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("version")
            .eq("project_id", self._project_id)
            .eq("scope_path", norm)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("version", 0) if data else 0

    def set_scope_version(self, scope_path: str, version: int) -> None:
        norm = _normalize(scope_path)
        self._upsert_scope_state(norm, version=version)

    def get_scope_hash(self, scope_path: str) -> str:
        norm = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("scope_hash")
            .eq("project_id", self._project_id)
            .eq("scope_path", norm)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("scope_hash", "") if data else ""

    def set_scope_hash(self, scope_path: str, h: str) -> None:
        norm = _normalize(scope_path)
        self._upsert_scope_state(norm, scope_hash=h)

    def _upsert_scope_state(self, scope_path: str, *,
                            version: int | None = None,
                            scope_hash: str | None = None) -> None:
        """Insert or update the scope state row.

        Reads the existing row first and merges fields to avoid clobbering
        previously-set values (e.g. set_scope_version followed by
        set_scope_hash in the same push).
        """
        # Read current state so we can merge rather than overwrite
        existing: dict = {}
        try:
            resp = (
                self._client.table(self.SCOPE_STATE_TABLE)
                .select("version, scope_hash")
                .eq("project_id", self._project_id)
                .eq("scope_path", scope_path)
                .maybe_single()
                .execute()
            )
            existing = resp.data or {} if resp and hasattr(resp, "data") else {}
        except Exception:
            pass

        data: dict = {
            "project_id": self._project_id,
            "scope_path": scope_path,
        }
        # Merge: use new value if provided, else keep existing
        if version is not None:
            data["version"] = version
        elif existing.get("version") is not None:
            data["version"] = existing["version"]

        if scope_hash is not None:
            data["scope_hash"] = scope_hash
        elif existing.get("scope_hash"):
            data["scope_hash"] = existing["scope_hash"]

        try:
            self._client.table(self.SCOPE_STATE_TABLE).upsert(
                data, on_conflict="project_id,scope_path"
            ).execute()
        except Exception:
            # Fallback: try insert, then update on conflict
            update_data = {k: v for k, v in data.items()
                          if k not in ("project_id", "scope_path")}
            try:
                self._client.table(self.SCOPE_STATE_TABLE).insert(data).execute()
            except Exception:
                self._client.table(self.SCOPE_STATE_TABLE).update(
                    update_data
                ).eq("project_id", self._project_id).eq(
                    "scope_path", scope_path
                ).execute()

    # ── Version Index (derived from history entries) ──

    def get_version_index(self) -> dict:
        """Reconstruct global version -> scope version mapping from commits."""
        resp = (
            self._client.table(self.TABLE)
            .select("version, scope_path, scope_version")
            .eq("project_id", self._project_id)
            .order("version", desc=False)
            .execute()
        )
        index = {}
        for row in (resp.data or []):
            index[str(row["version"])] = {
                "scope": row.get("scope_path", ""),
                "scope_version": row.get("scope_version", ""),
            }
        return index

    def update_version_index(self, _global_version: int,
                             _scope: str, _scope_version: str) -> None:
        """No-op: version index is derived from history entries."""

    # ── Record ──

    def record(
        self,
        version: int,
        who: str,
        message: str,
        scope_path: str,
        changes: list,
        conflicts: list | None = None,
        root_hash: str = "",
        scope_hash: str = "",
        scope_version: str = "",
    ) -> None:
        data = {
            "project_id": self._project_id,
            "version": version,
            "root_hash": root_hash,
            "scope_path": scope_path or "",
            "scope_hash": scope_hash,
            "scope_version": scope_version,
            "who": who,
            "message": message or "",
            "changes": json.dumps(changes) if isinstance(changes, list) else changes,
        }
        if conflicts:
            from dataclasses import asdict
            serializable = [
                asdict(c) if hasattr(c, '__dataclass_fields__') else c
                for c in conflicts
            ]
            data["conflicts"] = json.dumps(serializable)

        self._client.table(self.TABLE).insert(data).execute()
        log_info(f"[MutHistory] Recorded v{version} ({scope_version}) "
                 f"for project {self._project_id}")

    # ── Query ──

    def get_since(
        self,
        since_version: int,
        scope_path: str | None = None,
        limit: int = 0,
    ) -> list[dict]:
        query = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", self._project_id)
            .gt("version", since_version)
            .order("version", desc=False)
        )
        if scope_path:
            query = query.eq("scope_path", scope_path)
        if limit > 0:
            query = query.limit(limit)

        resp = query.execute()
        entries = _safe_data(resp) or []
        for entry in entries:
            _parse_json_fields(entry)
        return entries

    def get_entry(self, version: int) -> dict | None:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", self._project_id)
            .eq("version", version)
            .limit(1)
            .execute()
        )
        rows = _safe_data(resp)
        entry = rows[0] if rows else None
        if entry:
            _parse_json_fields(entry)
        return entry



def _normalize(scope_path: str) -> str:
    """Normalize scope path (strip slashes)."""
    return scope_path.strip("/") if scope_path else ""


def _parse_json_fields(entry: dict) -> None:
    """Parse JSON string fields in a history entry."""
    if isinstance(entry.get("changes"), str):
        entry["changes"] = json.loads(entry["changes"])
    if isinstance(entry.get("conflicts"), str):
        entry["conflicts"] = json.loads(entry["conflicts"])
    # Map root_hash → root for Mut handler compatibility
    entry["root"] = entry.get("root_hash", "")
