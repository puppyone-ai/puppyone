"""UploadJob persistence for the target Upload data model."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from src.infra.supabase.client import SupabaseClient


TERMINAL_ITEM_STATUSES = {"completed", "failed", "cancelled", "skipped"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class UploadJobRepository:
    JOBS = "upload_jobs"
    ITEMS = "upload_items"

    def __init__(self, supabase_client: SupabaseClient | None = None):
        self.client = (supabase_client or SupabaseClient()).client

    def create_job(
        self,
        *,
        project_id: str,
        created_by: str,
        target_path: str = "",
        mode: str = "raw",
        config: dict[str, Any] | None = None,
        policy_summary: dict[str, Any] | None = None,
    ) -> str:
        job_id = str(uuid.uuid4())
        self.client.table(self.JOBS).insert({
            "id": job_id,
            "project_id": project_id,
            "created_by": created_by,
            "target_path": target_path,
            "source_kind": "browser",
            "mode": mode,
            "status": "running",
            "phase": "uploading",
            "progress": 0,
            "message": "Uploading files",
            "config": config or {},
            "policy_summary": policy_summary or {},
            "started_at": _now(),
        }).execute()
        return job_id

    def create_item(
        self,
        *,
        upload_job_id: str,
        item_id: str,
        relative_path: str,
        original_name: str,
        size_bytes: int,
        mime_type: str | None,
        s3_key: str,
    ) -> None:
        self.client.table(self.ITEMS).insert({
            "id": item_id,
            "upload_job_id": upload_job_id,
            "relative_path": relative_path,
            "original_name": original_name,
            "size_bytes": size_bytes,
            "mime_type": mime_type,
            "s3_key": s3_key,
            "status": "pending",
        }).execute()

    def mark_item_uploaded(self, item_id: str) -> None:
        self.client.table(self.ITEMS).update({
            "status": "uploaded",
        }).eq("id", item_id).execute()

    def mark_item_completed(self, item_id: str, *, result_path: str | None) -> None:
        self.client.table(self.ITEMS).update({
            "status": "completed",
            "result_path": result_path,
            "error_message": None,
        }).eq("id", item_id).execute()

    def mark_item_failed(self, item_id: str, error: str) -> None:
        self.client.table(self.ITEMS).update({
            "status": "failed",
            "error_message": error[:10_000],
        }).eq("id", item_id).execute()

    def mark_item_cancelled(self, item_id: str, reason: str | None = None) -> None:
        self.client.table(self.ITEMS).update({
            "status": "cancelled",
            "error_message": reason,
        }).eq("id", item_id).execute()

    def mark_job_failed(self, upload_job_id: str, error: str) -> None:
        self.client.table(self.JOBS).update({
            "status": "failed",
            "phase": "failed",
            "progress": 100,
            "message": "Upload failed",
            "error_message": error[:10_000],
            "completed_at": _now(),
        }).eq("id", upload_job_id).execute()

    def refresh_job_from_items(self, upload_job_id: str) -> None:
        rows = (
            self.client.table(self.ITEMS)
            .select("status, result_path, error_message")
            .eq("upload_job_id", upload_job_id)
            .execute()
        ).data or []
        if not rows:
            return

        completed = sum(1 for row in rows if row.get("status") == "completed")
        terminal = [row for row in rows if row.get("status") in TERMINAL_ITEM_STATUSES]
        progress = int(len(terminal) * 100 / len(rows))

        patch: dict[str, Any] = {
            "progress": progress,
        }
        if len(terminal) == len(rows):
            failed = [row for row in rows if row.get("status") == "failed"]
            cancelled = [row for row in rows if row.get("status") == "cancelled"]
            if failed:
                patch.update({
                    "status": "failed",
                    "phase": "failed",
                    "message": "Upload failed",
                    "error_message": failed[0].get("error_message"),
                    "completed_at": _now(),
                })
            elif cancelled and completed == 0:
                patch.update({
                    "status": "cancelled",
                    "phase": "cancelled",
                    "message": "Upload cancelled",
                    "completed_at": _now(),
                })
            else:
                first_result = next(
                    (row.get("result_path") for row in rows if row.get("result_path")),
                    None,
                )
                patch.update({
                    "status": "completed",
                    "phase": "completed",
                    "progress": 100,
                    "message": "Upload completed",
                    "result_path": first_result,
                    "completed_at": _now(),
                })
        else:
            patch.update({
                "status": "running",
                "phase": "uploading",
                "message": "Uploading files",
            })

        self.client.table(self.JOBS).update(patch).eq("id", upload_job_id).execute()
