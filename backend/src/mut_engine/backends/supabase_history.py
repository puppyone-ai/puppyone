"""
SupabaseHistoryManager — PostgreSQL implementation of Mut History

Uses the mut_commits table to store version history, and the projects table
to store root_hash and latest_version.
Interface-compatible with Mut's native HistoryManager (filesystem JSON).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from src.infra.supabase.client import SupabaseClient
from src.utils.logger import log_info, log_error


class SupabaseHistoryManager:
    """Supabase/PostgreSQL implementation of Mut HistoryManager.

    Interface-compatible with mut.server.history.HistoryManager,
    so it can plug in directly once Mut supports the HistoryBackend abstraction.
    """

    TABLE = "mut_commits"

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    # ── Version / Root ──

    def get_latest_version(self) -> int:
        resp = (
            self._client.table("projects")
            .select("mut_version")
            .eq("id", self._project_id)
            .single()
            .execute()
        )
        return resp.data.get("mut_version", 0) if resp.data else 0

    def set_latest_version(self, version: int) -> None:
        self._client.table("projects").update(
            {"mut_version": version}
        ).eq("id", self._project_id).execute()

    def get_root_hash(self) -> str:
        resp = (
            self._client.table("projects")
            .select("mut_root_hash")
            .eq("id", self._project_id)
            .single()
            .execute()
        )
        return resp.data.get("mut_root_hash", "") if resp.data else ""

    def set_root_hash(self, h: str) -> None:
        self._client.table("projects").update(
            {"mut_root_hash": h}
        ).eq("id", self._project_id).execute()

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
    ) -> None:
        data = {
            "project_id": self._project_id,
            "version": version,
            "root_hash": root_hash,
            "scope_path": scope_path or "",
            "who": who,
            "message": message or "",
            "changes": json.dumps(changes) if isinstance(changes, list) else changes,
        }
        if conflicts:
            data["conflicts"] = json.dumps(conflicts) if isinstance(conflicts, list) else conflicts

        self._client.table(self.TABLE).insert(data).execute()
        log_info(f"[MutHistory] Recorded v{version} for project {self._project_id}")

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
        entries = resp.data or []
        for entry in entries:
            if isinstance(entry.get("changes"), str):
                entry["changes"] = json.loads(entry["changes"])
            if isinstance(entry.get("conflicts"), str):
                entry["conflicts"] = json.loads(entry["conflicts"])
        return entries

    def get_entry(self, version: int) -> dict | None:
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", self._project_id)
            .eq("version", version)
            .maybe_single()
            .execute()
        )
        entry = resp.data
        if entry:
            if isinstance(entry.get("changes"), str):
                entry["changes"] = json.loads(entry["changes"])
            if isinstance(entry.get("conflicts"), str):
                entry["conflicts"] = json.loads(entry["conflicts"])
        return entry

    # ── Async variants ──

    async def async_get_latest_version(self) -> int:
        import asyncio
        return await asyncio.to_thread(self.get_latest_version)

    async def async_set_latest_version(self, version: int) -> None:
        import asyncio
        await asyncio.to_thread(self.set_latest_version, version)

    async def async_get_root_hash(self) -> str:
        import asyncio
        return await asyncio.to_thread(self.get_root_hash)

    async def async_set_root_hash(self, h: str) -> None:
        import asyncio
        await asyncio.to_thread(self.set_root_hash, h)

    async def async_record(self, version, who, message, scope_path,
                           changes, conflicts=None, root_hash=""):
        import asyncio
        await asyncio.to_thread(
            self.record, version, who, message, scope_path,
            changes, conflicts, root_hash,
        )

    async def async_get_since(self, since_version, scope_path=None, limit=0):
        import asyncio
        return await asyncio.to_thread(self.get_since, since_version, scope_path, limit)

    async def async_get_entry(self, version):
        import asyncio
        return await asyncio.to_thread(self.get_entry, version)
