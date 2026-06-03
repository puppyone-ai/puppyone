"""ARQ jobs for one-time imports."""

from __future__ import annotations

import asyncio
import logging
import traceback

from src.platform.imports.repository import ImportJobRepository
from src.platform.imports.runner import OneTimeImportRunner
from src.platform.imports.schemas import ImportJobStatus

logger = logging.getLogger(__name__)


class ImportJobStopped(RuntimeError):
    def __init__(self, status: str):
        super().__init__(f"Import job stopped with status {status}")
        self.status = status


async def execute_import_job(ctx: dict, job_id: str) -> dict:
    """Run a durable one-time import job."""
    repo: ImportJobRepository = ctx.get("import_job_repository") or ImportJobRepository()
    runner: OneTimeImportRunner = ctx.get("one_time_import_runner") or OneTimeImportRunner()

    job = repo.get(job_id)
    if not job:
        logger.error("Import job not found: %s", job_id)
        return {"status": "failed", "error": "job_not_found", "job_id": job_id}

    if job.status in {
        ImportJobStatus.CANCELLED.value,
        ImportJobStatus.COMPLETED.value,
        ImportJobStatus.FAILED.value,
    }:
        return {"status": "skipped", "job_id": job_id, "job_status": job.status}

    job = repo.mark_running(
        job_id,
        phase="validating",
        progress=5,
        message="Preparing import",
    )
    if not job or job.status in {
        ImportJobStatus.CANCELLED.value,
        ImportJobStatus.COMPLETED.value,
        ImportJobStatus.FAILED.value,
    }:
        status = job.status if job else "missing"
        return {"status": "skipped", "job_id": job_id, "job_status": status}

    async def on_phase(phase: str, progress: int, message: str) -> None:
        current = repo.get(job_id)
        if not current:
            raise RuntimeError("Import job disappeared during execution")
        if current.status in {
            ImportJobStatus.CANCELLED.value,
            ImportJobStatus.COMPLETED.value,
            ImportJobStatus.FAILED.value,
        }:
            raise ImportJobStopped(current.status)
        updated = repo.update(
            job_id,
            active_only=True,
            status=ImportJobStatus.RUNNING.value,
            phase=phase,
            progress=progress,
            message=message,
        )
        if updated and updated.status != ImportJobStatus.RUNNING.value:
            raise ImportJobStopped(updated.status)

    try:
        refreshed = repo.get(job_id)
        if not refreshed:
            raise RuntimeError("Import job disappeared before execution")
        result = await runner.run(refreshed, on_phase=on_phase)
        completed = repo.mark_completed(
            job_id,
            result_path=result.path,
            result_commit_id=result.commit_id,
            message=result.summary or "Import completed",
        )
        if completed and completed.status != ImportJobStatus.COMPLETED.value:
            return {
                "status": "skipped",
                "job_id": job_id,
                "job_status": completed.status,
            }
        logger.info("Import job completed: %s", job_id)
        return {
            "status": "completed",
            "job_id": job_id,
            "path": result.path,
            "commit_id": result.commit_id,
        }
    except ImportJobStopped as exc:
        logger.info("Import job stopped: %s status=%s", job_id, exc.status)
        return {"status": "skipped", "job_id": job_id, "job_status": exc.status}
    except asyncio.CancelledError:
        logger.error("Import job cancelled by worker timeout: %s", job_id)
        repo.mark_failed(job_id, "Import worker was cancelled or timed out")
        raise
    except Exception as exc:
        logger.error("Import job failed %s: %s\n%s", job_id, exc, traceback.format_exc())
        failed = repo.mark_failed(job_id, str(exc))
        if failed and failed.status != ImportJobStatus.FAILED.value:
            return {
                "status": "skipped",
                "job_id": job_id,
                "job_status": failed.status,
            }
        return {"status": "failed", "job_id": job_id, "error": str(exc)}
