"""
SyncRunRepository — CRUD for connector execution history in the
``connector_runs`` table.

Each row records one invocation of SyncEngine.execute() for a connector,
capturing status, duration, stdout, errors, and result summary.

NOTE (GAP-8): migration ``20260502000400_sync_runs_rename`` renamed
``sync_runs`` → ``connector_runs`` and the FK column ``access_point_id`` →
``connector_id``. This repository still pointed at the old names, so every
insert hit a non-existent table; the SyncEngine swallows that error, so
run history (and the dashboard usage buckets that read ``connector_runs``)
was silently empty for ALL connectors. Names are now aligned with the
live schema. ``_to_model`` still tolerates the old column names so any
legacy rows deserialize.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, List, Any
from src.infra.supabase.client import SupabaseClient


@dataclass
class SyncRun:
    id: str
    access_point_id: str
    status: str = "running"
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    error: Optional[str] = None
    trigger_type: str = "manual"
    result_summary: Optional[str] = None
    created_at: Optional[str] = None


MAX_STDOUT_LEN = 100_000  # 100KB


class SyncRunRepository:
    TABLE = "connector_runs"

    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _to_model(self, row: dict) -> SyncRun:
        return SyncRun(
            id=row["id"],
            access_point_id=row.get(
                "connector_id",
                row.get("access_point_id", row.get("sync_id", "")),
            ),
            status=row.get("status", "running"),
            started_at=row.get("started_at"),
            finished_at=row.get("finished_at"),
            duration_ms=row.get("duration_ms"),
            exit_code=row.get("exit_code"),
            stdout=row.get("stdout"),
            error=row.get("error"),
            trigger_type=row.get("trigger_type", "manual"),
            result_summary=row.get("result_summary"),
            created_at=row.get("created_at"),
        )

    def create(self, sync_id: str, trigger_type: str = "manual") -> SyncRun:
        data = {
            "connector_id": sync_id,
            "status": "running",
            "trigger_type": trigger_type,
            "started_at": self._now(),
        }
        response = self.client.table(self.TABLE).insert(data).execute()
        return self._to_model(response.data[0])

    def complete(
        self,
        run_id: str,
        *,
        status: str = "success",
        stdout: Optional[str] = None,
        error: Optional[str] = None,
        exit_code: Optional[int] = None,
        result_summary: Optional[str] = None,
    ) -> None:
        now = self._now()
        data: dict[str, Any] = {
            "status": status,
            "finished_at": now,
        }
        if stdout is not None:
            data["stdout"] = stdout[:MAX_STDOUT_LEN]
        if error is not None:
            data["error"] = error[:10_000]
        if exit_code is not None:
            data["exit_code"] = exit_code
        if result_summary is not None:
            data["result_summary"] = result_summary[:1000]

        run = self.get_by_id(run_id)
        if run and run.started_at:
            try:
                started = datetime.fromisoformat(run.started_at)
                finished = datetime.fromisoformat(now)
                data["duration_ms"] = int((finished - started).total_seconds() * 1000)
            except (ValueError, TypeError):
                pass

        self.client.table(self.TABLE).update(data).eq("id", run_id).execute()

    def get_by_id(self, run_id: str) -> Optional[SyncRun]:
        response = (
            self.client.table(self.TABLE)
            .select("*").eq("id", run_id).execute()
        )
        return self._to_model(response.data[0]) if response.data else None

    def list_by_sync(
        self, sync_id: str, limit: int = 20, offset: int = 0,
    ) -> List[SyncRun]:
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("connector_id", sync_id)
            .order("started_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return [self._to_model(r) for r in response.data]

    def list_failed_for_access_points(
        self, access_point_ids: List[str], limit: int = 50,
    ) -> List[SyncRun]:
        """List failed runs across multiple access points, newest first.

        Powers the "Failed sync" group in the Needs Action sidebar
        (PUP-5 §4 follow-up — fills gap G1 by exposing failed runs to
        the frontend without a per-access-point fan-out).
        """
        if not access_point_ids:
            return []
        response = (
            self.client.table(self.TABLE)
            .select("*")
            .in_("connector_id", access_point_ids)
            .eq("status", "failed")
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [self._to_model(r) for r in (response.data or [])]

    def count_by_sync(self, sync_id: str) -> int:
        response = (
            self.client.table(self.TABLE)
            .select("id", count="exact")
            .eq("connector_id", sync_id)
            .execute()
        )
        return response.count or 0

    def delete_by_sync(self, sync_id: str) -> None:
        self.client.table(self.TABLE).delete().eq("connector_id", sync_id).execute()
