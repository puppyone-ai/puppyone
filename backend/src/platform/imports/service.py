"""Service layer for durable one-time imports."""

from __future__ import annotations

from fastapi import HTTPException

from src.platform.imports.arq_client import ImportArqClient
from src.platform.imports.provider import detect_import_provider, suggest_import_name
from src.platform.imports.repository import ImportJob, ImportJobRepository
from src.platform.imports.schemas import ImportJobCreateRequest, ImportJobStatus
from src.platform.project.service import ProjectService


class ImportJobService:
    def __init__(
        self,
        *,
        repo: ImportJobRepository,
        project_service: ProjectService,
        arq_client: ImportArqClient,
    ):
        self.repo = repo
        self.project_service = project_service
        self.arq_client = arq_client

    async def create(self, request: ImportJobCreateRequest, user_id: str) -> ImportJob:
        project = self.project_service.get_by_id_with_access_check(
            request.project_id,
            user_id,
        )
        provider = (request.provider or detect_import_provider(request.source_url)).strip()
        if not provider:
            raise HTTPException(status_code=400, detail="Import provider is required")

        config = dict(request.config or {})
        if request.crawl_options:
            config["crawl_options"] = request.crawl_options
        name = request.name or suggest_import_name(provider, request.source_url)

        job = self.repo.create(
            org_id=project.org_id,
            project_id=request.project_id,
            created_by=user_id,
            provider=provider,
            source_url=request.source_url,
            name=name,
            target_path=request.target_path or "",
            config=config,
        )

        try:
            worker_job_id = await self.arq_client.enqueue_import(job.id)
        except Exception as exc:
            self.repo.mark_failed(job.id, f"Failed to enqueue import worker: {exc}")
            raise HTTPException(
                status_code=503,
                detail="Import worker is unavailable. Try again in a moment.",
            ) from exc

        return self.repo.update(
            job.id,
            worker_job_id=worker_job_id,
            status=ImportJobStatus.QUEUED.value,
            phase="queued",
            progress=0,
            message="Queued",
        ) or job

    def get_for_user(self, job_id: str, user_id: str) -> ImportJob:
        job = self.repo.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Import job not found")
        self.project_service.get_by_id_with_access_check(job.project_id, user_id)
        return job

    def list_for_project(
        self,
        project_id: str,
        user_id: str,
        *,
        active_only: bool = False,
        limit: int = 20,
    ) -> list[ImportJob]:
        self.project_service.get_by_id_with_access_check(project_id, user_id)
        return self.repo.list_by_project(
            project_id,
            active_only=active_only,
            limit=limit,
        )

    def cancel(self, job_id: str, user_id: str) -> ImportJob:
        job = self.get_for_user(job_id, user_id)
        if job.status in {
            ImportJobStatus.COMPLETED.value,
            ImportJobStatus.FAILED.value,
            ImportJobStatus.CANCELLED.value,
        }:
            return job
        return self.repo.mark_cancelled(job_id) or job
