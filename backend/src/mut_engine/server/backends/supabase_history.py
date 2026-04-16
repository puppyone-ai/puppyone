"""
SupabaseHistoryManager — PostgreSQL implementation of Mut History

Uses the mut_commits table to store version history, the projects table
for global version counter, and mut_scope_state table for per-scope
version + hash tracking.

Interface-compatible with Mut's native HistoryManager (filesystem JSON).

scope_path canonical form
─────────────────────────
Every public method that accepts a ``scope_path`` normalizes the value
on entry via :func:`_normalize` — no leading/trailing ``/``, empty scope
represented as ``""`` (never ``None``).  After the first line of each
method the rest of the body MAY assume ``scope_path`` is canonical and
must not re-normalize.

This assumption is backed by a database-level trigger + CHECK constraint
introduced in ``20260416100000_scope_path_canonical.sql`` — the DB will
also enforce canonical form on any row landing in ``mut_commits`` /
``mut_scope_state``.
"""

from __future__ import annotations

import json

from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data as _safe_data
from src.utils.logger import log_error, log_info


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
        scope_path = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("version")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("version", 0) if data else 0

    def set_scope_version(self, scope_path: str, version: int) -> None:
        scope_path = _normalize(scope_path)
        self._upsert_scope_state(scope_path, version=version)

    def get_scope_hash(self, scope_path: str) -> str:
        scope_path = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("scope_hash")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("scope_hash", "") if data else ""

    def set_scope_hash(self, scope_path: str, h: str) -> None:
        scope_path = _normalize(scope_path)
        self._upsert_scope_state(scope_path, scope_hash=h)

    def _upsert_scope_state(self, scope_path: str, *,
                            version: int | None = None,
                            scope_hash: str | None = None) -> None:
        """Insert or update specific fields of the scope state row.

        Uses upsert with only the fields being updated, so concurrent
        updates to different fields (version vs scope_hash) don't clobber
        each other. The ON CONFLICT clause only overwrites the supplied columns.

        ``scope_path`` is assumed to be already normalized by the caller.
        """
        data: dict = {
            "project_id": self._project_id,
            "scope_path": scope_path,
        }
        if version is not None:
            data["version"] = version
        if scope_hash is not None:
            data["scope_hash"] = scope_hash

        self._client.table(self.SCOPE_STATE_TABLE).upsert(
            data, on_conflict="project_id,scope_path"
        ).execute()

    def cas_update_scope_hash(self, scope_path: str, old_hash: str, new_hash: str) -> bool:
        """CAS update scope hash: only succeeds if current hash matches old_hash.

        Uses PostgreSQL RPC for atomic compare-and-swap.
        Returns True on success, False if hash has changed (concurrent push).
        Raises RuntimeError if the RPC function is not available.
        """
        scope_path = _normalize(scope_path)

        if not old_hash:
            try:
                self._client.table(self.SCOPE_STATE_TABLE).insert({
                    "project_id": self._project_id,
                    "scope_path": scope_path,
                    "scope_hash": new_hash,
                    "version": 0,
                }).execute()
                return True
            except Exception:
                pass

        try:
            resp = self._client.rpc("cas_update_scope_state", {
                "p_project_id": self._project_id,
                "p_scope_path": scope_path,
                "p_old_hash": old_hash or "",
                "p_new_hash": new_hash,
            }).execute()
            data = resp.data
            if isinstance(data, bool):
                return data
            if isinstance(data, list) and len(data) > 0:
                return bool(data[0])
            return False
        except Exception as e:
            log_error(
                f"[CAS] cas_update_scope_state RPC failed for scope='{scope_path}': {e}. "
                "Ensure the cas_update_scope_state RPC function is deployed to Supabase."
            )
            raise RuntimeError(
                f"CAS RPC not available — concurrency control requires the "
                f"cas_update_scope_state function. Deploy the SQL migration first. "
                f"Original error: {e}"
            ) from e

    def cas_update_root_hash(self, old_hash: str, new_hash: str) -> bool:
        """CAS update the global root hash on the projects table.

        Returns True on success, False if hash has changed (concurrent graft).
        Raises RuntimeError if the RPC function is not available.
        """
        try:
            resp = self._client.rpc("cas_update_root_hash", {
                "p_project_id": self._project_id,
                "p_old_hash": old_hash,
                "p_new_hash": new_hash,
            }).execute()
            data = resp.data
            if isinstance(data, bool):
                return data
            if isinstance(data, list) and len(data) > 0:
                return bool(data[0])
            return False
        except Exception as e:
            log_error(
                f"[CAS] cas_update_root_hash RPC failed: {e}. "
                "Ensure the cas_update_root_hash RPC function is deployed to Supabase."
            )
            raise RuntimeError(
                f"CAS RPC not available — concurrency control requires the "
                f"cas_update_root_hash function. Deploy the SQL migration first. "
                f"Original error: {e}"
            ) from e

    def atomic_next_version(self) -> int:
        """Atomically increment and return the next global version.

        Uses UPDATE ... SET mut_version = mut_version + 1 RETURNING mut_version
        via an RPC function. Raises RuntimeError if the RPC is not available.
        """
        try:
            resp = self._client.rpc("atomic_next_version", {
                "p_project_id": self._project_id,
            }).execute()
            data = resp.data
            if isinstance(data, int):
                return data
            if isinstance(data, list) and len(data) > 0:
                val = data[0]
                if isinstance(val, dict):
                    return val.get("mut_version", val.get("result", 0))
                return int(val)
            raise RuntimeError(f"unexpected RPC response: {data!r}")
        except RuntimeError:
            raise
        except Exception as e:
            log_error(
                f"[CAS] atomic_next_version RPC failed: {e}. "
                "Ensure the atomic_next_version RPC function is deployed to Supabase."
            )
            raise RuntimeError(
                f"Atomic version RPC not available — concurrency control requires the "
                f"atomic_next_version function. Deploy the SQL migration first. "
                f"Original error: {e}"
            ) from e

    # ── Scope History Queries ──

    def get_previous_scope_hash(self, scope_path: str, before_version: int) -> str:
        """Get the scope_hash from the latest commit to this scope BEFORE the given version.

        Used by graft conflict detection: compares the subtree in root_hash
        against this hash to determine if another scope modified our path.
        """
        scope_path = _normalize(scope_path)
        try:
            resp = (
                self._client.table(self.TABLE)
                .select("scope_hash")
                .eq("project_id", self._project_id)
                .eq("scope_path", scope_path)
                .lt("version", before_version)
                .order("version", desc=True)
                .limit(1)
                .execute()
            )
            rows = _safe_data(resp)
            if rows and rows[0].get("scope_hash"):
                return rows[0]["scope_hash"]
        except Exception:
            pass
        return ""

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
        scope_path = _normalize(scope_path)
        data = {
            "project_id": self._project_id,
            "version": version,
            "root_hash": root_hash,
            "scope_path": scope_path,
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
            query = query.eq("scope_path", _normalize(scope_path))
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
    """Canonical scope_path form: strip surrounding '/', map None → ''.

    This function is the single source of truth for scope_path normalization
    on the application side. The database-level trigger in
    ``20260416100000_scope_path_canonical.sql`` applies the same rule as a
    second layer of defense.
    """
    return scope_path.strip("/") if scope_path else ""


def _parse_json_fields(entry: dict) -> None:
    """Parse JSON string fields in a history entry."""
    if isinstance(entry.get("changes"), str):
        entry["changes"] = json.loads(entry["changes"])
    if isinstance(entry.get("conflicts"), str):
        entry["conflicts"] = json.loads(entry["conflicts"])
    # Map root_hash → root for Mut handler compatibility
    entry["root"] = entry.get("root_hash", "")
