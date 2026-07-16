from __future__ import annotations

import asyncio
import re
import socket
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from src.config import settings
from src.infra.s3.service import S3Service, get_s3_service_instance
from src.infra.supabase.client import SupabaseClient


@dataclass(frozen=True, slots=True)
class ProjectDeletionCleanupSummary:
    claimed: int = 0
    completed: int = 0
    failed: int = 0
    deleted_objects: int = 0
    verification_scheduled: int = 0
    late_object_cycles: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "claimed": self.claimed,
            "completed": self.completed,
            "failed": self.failed,
            "deleted_objects": self.deleted_objects,
            "verification_scheduled": self.verification_scheduled,
            "late_object_cycles": self.late_object_cycles,
        }


class ProjectDeletionJobRepository:
    def __init__(self, client=None):
        self._client = client or SupabaseClient().get_client()

    def claim(self, *, worker_id: str, limit: int, lease_seconds: int) -> list[dict[str, Any]]:
        response = self._client.rpc(
            "claim_project_deletion_jobs",
            {
                "p_worker_id": worker_id,
                "p_limit": limit,
                "p_lease_seconds": lease_seconds,
            },
        ).execute()
        return [row for row in (response.data or []) if isinstance(row, dict)]

    def complete(self, *, job_id: str, worker_id: str) -> bool:
        response = self._client.rpc(
            "complete_project_deletion_job",
            {"p_job_id": job_id, "p_worker_id": worker_id},
        ).execute()
        return bool(response.data)

    def schedule_verification(
        self,
        *,
        job_id: str,
        worker_id: str,
        verify_after_seconds: int,
    ) -> bool:
        response = self._client.rpc(
            "schedule_project_deletion_verification",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_verify_after_seconds": verify_after_seconds,
            },
        ).execute()
        return bool(response.data)

    def fail(
        self,
        *,
        job_id: str,
        worker_id: str,
        error: str,
        retry_after_seconds: int,
    ) -> bool:
        response = self._client.rpc(
            "fail_project_deletion_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_error": error,
                "p_retry_after_seconds": retry_after_seconds,
            },
        ).execute()
        return bool(response.data)


class ProjectDeletionCleanupWorker:
    def __init__(
        self,
        repository: ProjectDeletionJobRepository,
        s3: S3Service,
        *,
        worker_id: str | None = None,
        verify_after_seconds: int = 60,
    ):
        self._repository = repository
        self._s3 = s3
        self._worker_id = worker_id or f"{socket.gethostname()}:{uuid4()}"
        self._verify_after_seconds = max(10, verify_after_seconds)

    async def run_once(
        self,
        *,
        lease_seconds: int = 3600,
    ) -> ProjectDeletionCleanupSummary:
        # Object deletion can outlive a short database lease.  Claim one job
        # with the full configured lease so no second worker can purge the
        # same Project while this worker is still walking paginated prefixes.
        jobs = await asyncio.to_thread(
            self._repository.claim,
            worker_id=self._worker_id,
            limit=1,
            lease_seconds=max(30, lease_seconds),
        )
        completed = 0
        failed = 0
        deleted_objects = 0
        verification_scheduled = 0
        late_object_cycles = 0
        for job in jobs:
            job_id = str(job.get("id") or "")
            attempts = max(1, int(job.get("attempts") or 1))
            try:
                prefixes = _validated_project_prefixes(job)
                phase = str(job.get("phase") or "")
                if phase == "purge":
                    for prefix in prefixes:
                        deleted_objects += await self._purge_prefix(prefix)
                    await self._schedule_verification(job_id)
                    verification_scheduled += 1
                elif phase == "verify":
                    # S3 is strongly consistent, but an already-admitted Git
                    # request may finish after the first purge.  Seeing any
                    # object restarts the entire quiet verification window.
                    has_late_objects = False
                    for prefix in prefixes:
                        if await self._prefix_has_objects(prefix):
                            has_late_objects = True
                    if has_late_objects:
                        late_object_cycles += 1
                        for prefix in prefixes:
                            deleted_objects += await self._purge_prefix(prefix)
                        await self._schedule_verification(job_id)
                        verification_scheduled += 1
                    else:
                        acknowledged = await asyncio.to_thread(
                            self._repository.complete,
                            job_id=job_id,
                            worker_id=self._worker_id,
                        )
                        if not acknowledged:
                            raise RuntimeError(
                                "deletion job lease was lost before completion"
                            )
                        completed += 1
                else:
                    raise RuntimeError(f"Project deletion job has invalid phase {phase!r}")
            except Exception as exc:
                failed += 1
                await asyncio.to_thread(
                    self._repository.fail,
                    job_id=job_id,
                    worker_id=self._worker_id,
                    error=str(exc),
                    retry_after_seconds=min(3600, 15 * (2 ** min(attempts - 1, 8))),
                )
        return ProjectDeletionCleanupSummary(
            claimed=len(jobs),
            completed=completed,
            failed=failed,
            deleted_objects=deleted_objects,
            verification_scheduled=verification_scheduled,
            late_object_cycles=late_object_cycles,
        )

    async def _schedule_verification(self, job_id: str) -> None:
        acknowledged = await asyncio.to_thread(
            self._repository.schedule_verification,
            job_id=job_id,
            worker_id=self._worker_id,
            verify_after_seconds=self._verify_after_seconds,
        )
        if not acknowledged:
            raise RuntimeError("deletion job lease was lost before verification scheduling")

    async def _prefix_has_objects(self, prefix: str) -> bool:
        files, _, _, _ = await self._s3.list_files(prefix=prefix, max_keys=1)
        return bool(files)

    async def _purge_prefix(self, prefix: str) -> int:
        deleted = 0
        # Always re-read the first page after deletion.  S3 continuation tokens
        # are opaque and can skip keys when the preceding page was removed.
        while True:
            files, _, _, _ = await self._s3.list_files(prefix=prefix, max_keys=1000)
            keys = [item.key for item in files]
            if not keys:
                return deleted
            results = await self._s3.delete_files_batch(keys)
            failures = [
                result
                for result in results
                if not result.success and result.message != "File not found"
            ]
            if failures:
                sample = "; ".join(
                    f"{result.key}: {result.message or 'delete failed'}"
                    for result in failures[:3]
                )
                raise RuntimeError(f"unable to purge Project object prefix {prefix}: {sample}")
            deleted += len(keys)


def _validated_project_prefixes(job: dict[str, Any]) -> tuple[str, ...]:
    project_id = str(job.get("project_id") or "")
    raw_prefixes = job.get("object_prefixes")
    raw_principals = job.get("storage_principals")
    requested_by = str(job.get("requested_by") or "")
    if (
        not _STORAGE_SEGMENT.fullmatch(project_id)
        or not isinstance(raw_prefixes, list)
        or not isinstance(raw_principals, list)
        or not requested_by
    ):
        raise RuntimeError("Project deletion job has an invalid object-prefix contract")

    principals = tuple(str(principal) for principal in raw_principals)
    if (
        not principals
        or principals != tuple(sorted(principals))
        or len(set(principals)) != len(principals)
        or requested_by not in principals
        or any(not _STORAGE_SEGMENT.fullmatch(principal) for principal in principals)
    ):
        raise RuntimeError("Project deletion job has invalid storage principals")

    allowed = [
        f"version/{project_id}/",
        # Historical read-only object namespace retained during the immutable
        # object-layout cutover.  It remains Project-owned and must be purged.
        f"mut/{project_id}/",
        f"projects/{project_id}/",
        f"shadow-snapshots/{project_id}/",
    ]
    for namespace in ("etl_artifacts", "processed", "raw"):
        allowed.extend(
            f"users/{principal}/{namespace}/{project_id}/"
            for principal in principals
        )
    prefixes = tuple(str(prefix) for prefix in raw_prefixes)
    if prefixes != tuple(allowed):
        raise RuntimeError(
            "Project deletion job must contain every exact Project-owned prefix"
        )
    return prefixes


_STORAGE_SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


async def process_project_deletion_cleanup() -> dict[str, int | str]:
    worker = ProjectDeletionCleanupWorker(
        ProjectDeletionJobRepository(),
        get_s3_service_instance(),
        verify_after_seconds=settings.PROJECT_DELETION_VERIFY_DELAY_SECONDS,
    )
    summary = await worker.run_once(
        lease_seconds=settings.PROJECT_DELETION_CLEANUP_LEASE_SECONDS,
    )
    return {"status": "ok", **summary.as_dict()}
