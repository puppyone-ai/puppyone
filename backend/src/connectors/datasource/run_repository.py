"""CRUD for Connect execution history stored in ``sync_runs``."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, List

from src.infra.supabase.client import SupabaseClient


NEW_TABLE = "sync_runs"
VALID_TRIGGER_TYPES = {"manual", "scheduled", "webhook", "realtime", "initial", "push"}


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
    table_name: str = NEW_TABLE


def _normalize_trigger_type(trigger_type: str) -> str:
    if trigger_type not in VALID_TRIGGER_TYPES:
        return "manual"
    return trigger_type


def _status_for_new_table(status: str) -> str:
    if status == "success":
        return "completed"
    return status


def _status_for_response(status: str) -> str:
    if status == "completed":
        return "success"
    return status


class SyncRunRepository:
    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _connection_row(self, connection_id: str) -> dict | None:
        response = (
            self.client.table("connections")
            .select("*")
            .eq("id", connection_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def _to_model(self, row: dict) -> SyncRun:
        return SyncRun(
            id=row["id"],
            access_point_id=row.get("connection_id", ""),
            status=_status_for_response(row.get("status", "running")),
            started_at=row.get("started_at"),
            finished_at=row.get("finished_at"),
            duration_ms=row.get("duration_ms"),
            exit_code=row.get("exit_code"),
            stdout=row.get("stdout"),
            error=row.get("error_message"),
            trigger_type=row.get("triggered_by", "manual"),
            result_summary=row.get("message"),
            created_at=row.get("created_at"),
            table_name=NEW_TABLE,
        )

    def create(self, sync_id: str, trigger_type: str = "manual") -> SyncRun:
        connection = self._connection_row(sync_id)
        if not connection:
            raise RuntimeError(f"Connection {sync_id} not found")
        data = {
            "connection_id": sync_id,
            "project_id": connection["project_id"],
            "triggered_by": _normalize_trigger_type(trigger_type),
            "direction": connection.get("direction") or "inbound",
            "status": "running",
            "phase": "running",
            "progress": 0,
            "message": "Sync running",
            "started_at": self._now(),
        }
        response = self.client.table(NEW_TABLE).insert(data).execute()
        run = self._to_model(response.data[0])
        self.client.table("connections").update({
            "last_sync_run_id": run.id,
        }).eq("id", sync_id).execute()
        return run

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
        run = self.get_by_id(run_id)
        if not run:
            return

        now = self._now()
        data: dict[str, Any] = {
            "status": _status_for_new_table(status),
            "phase": _status_for_new_table(status),
            "progress": 100,
            "finished_at": now,
        }
        if error is not None:
            data["error_message"] = error[:10_000]
        if result_summary is not None:
            data["message"] = result_summary[:1000]
        if stdout is not None:
            data["stdout"] = stdout[:100_000]
        if exit_code is not None:
            data["exit_code"] = exit_code
        if run.started_at:
            try:
                started = datetime.fromisoformat(run.started_at.replace("Z", "+00:00"))
                finished = datetime.fromisoformat(now)
                data["duration_ms"] = int((finished - started).total_seconds() * 1000)
            except (ValueError, TypeError):
                pass
        self.client.table(NEW_TABLE).update(data).eq("id", run_id).execute()

    def get_by_id(self, run_id: str) -> Optional[SyncRun]:
        response = (
            self.client.table(NEW_TABLE)
            .select("*")
            .eq("id", run_id)
            .limit(1)
            .execute()
        )
        return self._to_model(response.data[0]) if response.data else None

    def list_by_sync(
        self, sync_id: str, limit: int = 20, offset: int = 0,
    ) -> List[SyncRun]:
        rows = (
            self.client.table(NEW_TABLE)
            .select("*")
            .eq("connection_id", sync_id)
            .order("started_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        ).data or []
        return [self._to_model(row) for row in rows]

    def list_failed_for_access_points(
        self,
        access_point_ids: List[str],
        limit: int = 50,
    ) -> List[SyncRun]:
        if not access_point_ids:
            return []
        rows = (
            self.client.table(NEW_TABLE)
            .select("*")
            .in_("connection_id", access_point_ids)
            .eq("status", "failed")
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        return [self._to_model(row) for row in rows]

    def count_by_sync(self, sync_id: str) -> int:
        response = (
            self.client.table(NEW_TABLE)
            .select("id", count="exact")
            .eq("connection_id", sync_id)
            .execute()
        )
        return response.count or 0

    def delete_by_sync(self, sync_id: str) -> None:
        self.client.table(NEW_TABLE).delete().eq("connection_id", sync_id).execute()
