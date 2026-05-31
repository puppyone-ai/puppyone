"""Repository for durable one-time import jobs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
import uuid

from src.infra.supabase.client import SupabaseClient
from src.platform.imports.schemas import ImportJobResponse, ImportJobStatus


ACTIVE_STATUSES = (
    ImportJobStatus.QUEUED.value,
    ImportJobStatus.RUNNING.value,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ImportJob:
    id: str
    project_id: str
    created_by: str
    provider: str
    source_url: str
    org_id: str | None = None
    name: str | None = None
    target_path: str = ""
    config: dict[str, Any] = field(default_factory=dict)
    status: str = ImportJobStatus.QUEUED.value
    phase: str = "queued"
    progress: int = 0
    message: str | None = None
    result_path: str | None = None
    result_commit_id: str | None = None
    error_message: str | None = None
    worker_job_id: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "ImportJob":
        return cls(
            id=str(row["id"]),
            org_id=row.get("org_id"),
            project_id=str(row["project_id"]),
            created_by=str(row["created_by"]),
            provider=str(row["provider"]),
            source_url=str(row["source_url"]),
            name=row.get("name"),
            target_path=row.get("target_path") or "",
            config=row.get("config") or {},
            status=row.get("status") or ImportJobStatus.QUEUED.value,
            phase=row.get("phase") or "queued",
            progress=int(row.get("progress") or 0),
            message=row.get("message"),
            result_path=row.get("result_path"),
            result_commit_id=row.get("result_commit_id"),
            error_message=row.get("error_message"),
            worker_job_id=row.get("worker_job_id"),
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def to_response(self) -> ImportJobResponse:
        return ImportJobResponse.model_validate({
            "id": self.id,
            "org_id": self.org_id,
            "project_id": self.project_id,
            "created_by": self.created_by,
            "provider": self.provider,
            "source_url": self.source_url,
            "name": self.name,
            "target_path": self.target_path,
            "config": self.config,
            "status": self.status,
            "phase": self.phase,
            "progress": self.progress,
            "message": self.message,
            "result_path": self.result_path,
            "result_commit_id": self.result_commit_id,
            "error_message": self.error_message,
            "worker_job_id": self.worker_job_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        })


class ImportJobRepository:
    TABLE = "import_jobs"

    def __init__(self, supabase_client: SupabaseClient | None = None):
        self.client = (supabase_client or SupabaseClient()).client

    def create(
        self,
        *,
        org_id: str | None,
        project_id: str,
        created_by: str,
        provider: str,
        source_url: str,
        name: str | None = None,
        target_path: str = "",
        config: dict[str, Any] | None = None,
    ) -> ImportJob:
        row = {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "project_id": project_id,
            "created_by": created_by,
            "provider": provider,
            "source_url": source_url,
            "name": name,
            "target_path": target_path or "",
            "config": config or {},
            "status": ImportJobStatus.QUEUED.value,
            "phase": "queued",
            "progress": 0,
            "message": "Queued",
        }
        resp = self.client.table(self.TABLE).insert(row).execute()
        return ImportJob.from_row(resp.data[0])

    def get(self, job_id: str) -> ImportJob | None:
        resp = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return ImportJob.from_row(rows[0]) if rows else None

    def list_by_project(
        self,
        project_id: str,
        *,
        active_only: bool = False,
        limit: int = 20,
    ) -> list[ImportJob]:
        query = (
            self.client.table(self.TABLE)
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if active_only:
            query = query.in_("status", [
                ImportJobStatus.QUEUED.value,
                ImportJobStatus.RUNNING.value,
            ])
        rows = query.execute().data or []
        return [ImportJob.from_row(row) for row in rows]

    def update(
        self,
        job_id: str,
        *,
        active_only: bool = False,
        **fields: Any,
    ) -> ImportJob | None:
        patch = {key: value for key, value in fields.items() if value is not None}
        if not patch:
            return self.get(job_id)
        query = (
            self.client.table(self.TABLE)
            .update(patch)
            .eq("id", job_id)
        )
        if active_only:
            query = query.in_("status", list(ACTIVE_STATUSES))
        resp = query.execute()
        rows = resp.data or []
        return ImportJob.from_row(rows[0]) if rows else self.get(job_id)

    def mark_running(
        self,
        job_id: str,
        *,
        phase: str,
        progress: int,
        message: str,
    ) -> ImportJob | None:
        return self.update(
            job_id,
            active_only=True,
            status=ImportJobStatus.RUNNING.value,
            phase=phase,
            progress=progress,
            message=message,
            error_message="",
            started_at=_now(),
        )

    def mark_completed(
        self,
        job_id: str,
        *,
        result_path: str | None,
        result_commit_id: str | None,
        message: str,
    ) -> ImportJob | None:
        return self.update(
            job_id,
            active_only=True,
            status=ImportJobStatus.COMPLETED.value,
            phase="completed",
            progress=100,
            message=message,
            result_path=result_path,
            result_commit_id=result_commit_id,
            error_message="",
            completed_at=_now(),
        )

    def mark_failed(self, job_id: str, error_message: str) -> ImportJob | None:
        return self.update(
            job_id,
            active_only=True,
            status=ImportJobStatus.FAILED.value,
            phase="failed",
            progress=100,
            message="Import failed",
            error_message=error_message[:10_000],
            completed_at=_now(),
        )

    def mark_cancelled(self, job_id: str) -> ImportJob | None:
        return self.update(
            job_id,
            active_only=True,
            status=ImportJobStatus.CANCELLED.value,
            phase="cancelled",
            progress=100,
            message="Import cancelled",
            completed_at=_now(),
        )
