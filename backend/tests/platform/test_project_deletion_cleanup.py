from __future__ import annotations

import asyncio
from dataclasses import dataclass
from threading import Lock

import pytest

from src.platform.project.deletion_cleanup import (
    ProjectDeletionCleanupWorker,
    _validated_project_prefixes,
)

PROJECT_ID = "project-1"
REQUESTED_BY = "00000000-0000-4000-8000-000000000001"
OTHER_PRINCIPAL = "00000000-0000-4000-8000-000000000002"
PRINCIPALS = [REQUESTED_BY, OTHER_PRINCIPAL]
PREFIXES = [
    f"version/{PROJECT_ID}/",
    f"mut/{PROJECT_ID}/",
    f"projects/{PROJECT_ID}/",
    f"shadow-snapshots/{PROJECT_ID}/",
    *[
        f"users/{principal}/{namespace}/{PROJECT_ID}/"
        for namespace in ("etl_artifacts", "processed", "raw")
        for principal in PRINCIPALS
    ],
]


@dataclass
class File:
    key: str


@dataclass
class DeleteResult:
    key: str
    success: bool = True
    message: str = ""


@dataclass
class MultipartUpload:
    key: str
    upload_id: str


class RepositoryStub:
    def __init__(self, jobs):
        self.jobs = jobs
        self._lock = Lock()
        self.claim_calls: list[dict] = []
        self.claimed: list[dict] = []
        self.completed: list[dict] = []
        self.scheduled: list[dict] = []
        self.failed: list[dict] = []

    def claim(self, **kwargs):
        with self._lock:
            self.claim_calls.append(kwargs)
            limit = kwargs["limit"]
            jobs, self.jobs = self.jobs[:limit], self.jobs[limit:]
            self.claimed.extend(
                {"job_id": job["id"], "worker_id": kwargs["worker_id"]}
                for job in jobs
            )
            return jobs

    def complete(self, **kwargs):
        self.completed.append(kwargs)
        return True

    def schedule_verification(self, **kwargs):
        self.scheduled.append(kwargs)
        return True

    def fail(self, **kwargs):
        self.failed.append(kwargs)
        return True


class S3Stub:
    def __init__(self, keys=(), multipart_uploads=()):
        self.keys = set(keys)
        self.multipart_uploads = set(multipart_uploads)
        self.listed: list[tuple[str, int]] = []
        self.deleted: list[str] = []
        self.aborted: list[tuple[str, str]] = []

    async def list_files(self, *, prefix, max_keys):
        self.listed.append((prefix, max_keys))
        matches = sorted(key for key in self.keys if key.startswith(prefix))[:max_keys]
        return [File(key) for key in matches], None, None, None

    async def delete_files_batch(self, keys):
        for key in keys:
            self.keys.discard(key)
            self.deleted.append(key)
        return [DeleteResult(key) for key in keys]

    async def list_multipart_uploads(self, *, prefix, max_uploads):
        matches = sorted(
            item for item in self.multipart_uploads if item[0].startswith(prefix)
        )[:max_uploads]
        return [MultipartUpload(key, upload_id) for key, upload_id in matches], None

    async def abort_multipart_upload(self, key, upload_id):
        self.multipart_uploads.discard((key, upload_id))
        self.aborted.append((key, upload_id))


def _job(*, phase: str, prefixes=PREFIXES, principals=PRINCIPALS):
    return {
        "id": "job-1",
        "project_id": PROJECT_ID,
        "requested_by": REQUESTED_BY,
        "storage_principals": list(principals),
        "object_prefixes": list(prefixes),
        "phase": phase,
        "attempts": 1,
    }


@pytest.mark.asyncio
async def test_first_phase_purges_every_owned_namespace_then_waits_for_verification():
    repository = RepositoryStub([_job(phase="purge")])
    s3 = S3Stub(
        {
            f"version/{PROJECT_ID}/objects/aa/object",
            f"mut/{PROJECT_ID}/objects/bb/legacy",
            f"projects/{PROJECT_ID}/uploads/user/staging",
            f"shadow-snapshots/{PROJECT_ID}/snapshot/manifest.json",
            f"users/{REQUESTED_BY}/raw/{PROJECT_ID}/raw.pdf",
            f"users/{OTHER_PRINCIPAL}/etl_artifacts/{PROJECT_ID}/task/mineru.md",
            f"users/{OTHER_PRINCIPAL}/processed/{PROJECT_ID}/task.json",
        },
        {
            (f"projects/{PROJECT_ID}/uploads/{REQUESTED_BY}/large.bin", "upload-1"),
            (f"users/{OTHER_PRINCIPAL}/raw/{PROJECT_ID}/legacy.bin", "upload-2"),
        },
    )
    worker = ProjectDeletionCleanupWorker(
        repository,
        s3,
        worker_id="worker-1",
        verify_after_seconds=75,
    )

    summary = await worker.run_once()

    assert not s3.keys
    assert not s3.multipart_uploads
    assert summary.deleted_objects == 7
    assert summary.aborted_multipart_uploads == 2
    assert summary.completed == 0
    assert summary.verification_scheduled == 1
    assert repository.completed == []
    assert repository.scheduled == [
        {
            "job_id": "job-1",
            "worker_id": "worker-1",
            "verify_after_seconds": 75,
        }
    ]


@pytest.mark.asyncio
async def test_verify_phase_completes_only_after_all_prefixes_remain_empty():
    repository = RepositoryStub([_job(phase="verify")])
    s3 = S3Stub()
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert summary.completed == 1
    assert summary.verification_scheduled == 0
    assert repository.completed == [{"job_id": "job-1", "worker_id": "worker-1"}]


@pytest.mark.asyncio
async def test_late_inflight_git_object_restarts_a_full_verification_window():
    late_key = f"version/{PROJECT_ID}/object-bundles/late-pack"
    repository = RepositoryStub([_job(phase="verify")])
    s3 = S3Stub({late_key})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert late_key in s3.deleted
    assert summary.completed == 0
    assert summary.late_object_cycles == 1
    assert summary.verification_scheduled == 1
    assert repository.completed == []


@pytest.mark.asyncio
async def test_late_multipart_upload_is_aborted_and_restarts_verification_window():
    upload = (
        f"projects/{PROJECT_ID}/uploads/{REQUESTED_BY}/late-large.bin",
        "upload-late",
    )
    repository = RepositoryStub([_job(phase="verify")])
    s3 = S3Stub(multipart_uploads={upload})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert upload in s3.aborted
    assert not s3.multipart_uploads
    assert summary.aborted_multipart_uploads == 1
    assert summary.completed == 0
    assert summary.late_object_cycles == 1
    assert summary.verification_scheduled == 1
    assert repository.completed == []


@pytest.mark.asyncio
async def test_prefix_escape_fails_closed_without_touching_storage():
    repository = RepositoryStub([_job(phase="purge", prefixes=["version/other/"])])
    s3 = S3Stub({"version/other/do-not-delete"})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert summary.failed == 1
    assert s3.deleted == []
    assert repository.failed[0]["job_id"] == "job-1"
    assert "every exact Project-owned prefix" in repository.failed[0]["error"]


@pytest.mark.asyncio
async def test_missing_owned_prefix_fails_closed_instead_of_leaking_objects():
    repository = RepositoryStub([_job(phase="purge", prefixes=PREFIXES[:2])])
    s3 = S3Stub({f"projects/{PROJECT_ID}/uploads/left-behind"})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert summary.failed == 1
    assert not s3.deleted
    assert s3.keys == {f"projects/{PROJECT_ID}/uploads/left-behind"}


@pytest.mark.asyncio
async def test_missing_shadow_or_user_namespace_fails_closed():
    repository = RepositoryStub([_job(phase="purge", prefixes=PREFIXES[:3])])
    s3 = S3Stub({f"shadow-snapshots/{PROJECT_ID}/snapshot/manifest.json"})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert summary.failed == 1
    assert not s3.deleted


@pytest.mark.asyncio
async def test_unpersisted_or_path_escaping_storage_principal_fails_closed():
    repository = RepositoryStub(
        [_job(phase="purge", principals=[REQUESTED_BY, "../another-project"])]
    )
    s3 = S3Stub({"users/another-project/raw/project-1/do-not-delete"})
    worker = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")

    summary = await worker.run_once()

    assert summary.failed == 1
    assert not s3.deleted
    assert "invalid storage principals" in repository.failed[0]["error"]


@pytest.mark.asyncio
async def test_two_workers_claim_one_long_running_job_at_most_once():
    repository = RepositoryStub([_job(phase="verify")])
    s3 = S3Stub()
    first = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-1")
    second = ProjectDeletionCleanupWorker(repository, s3, worker_id="worker-2")

    summaries = await asyncio.gather(first.run_once(), second.run_once())

    assert sum(summary.claimed for summary in summaries) == 1
    assert sum(summary.completed for summary in summaries) == 1
    assert len(repository.claimed) == 1
    assert repository.claimed[0]["job_id"] == "job-1"
    assert repository.claimed[0]["worker_id"] in {"worker-1", "worker-2"}
    assert len(repository.claim_calls) == 2
    assert all(call["limit"] == 1 for call in repository.claim_calls)
    assert all(call["lease_seconds"] == 3600 for call in repository.claim_calls)


def test_project_prefix_contract_is_exact_and_includes_every_owned_namespace():
    assert _validated_project_prefixes(_job(phase="purge")) == tuple(PREFIXES)
