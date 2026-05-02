"""Repo identity endpoint — the single "access point" page surface.

Returns the project's mut URL + prompt template + per-scope keys. This is
what the new frontend /access page renders.

Path: /api/v1/projects/{project_id}/access-point
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from src.common_schemas import ApiResponse
from src.config import settings
from src.platform.project.dependencies import (
    get_project_service, get_verified_project,
)
from src.platform.project.models import Project
from src.platform.project.service import ProjectService
from src.repo.scope_service import ScopeService
from src.repo.scope_router import get_scope_service
from src.repo.schemas import (
    RepoIdentityOut, RepoIdentityScopeOut, RepoIdentityPatch,
)


router = APIRouter(
    prefix="/projects/{project_id}/access-point",
    tags=["repo-identity"],
)


def _build_repo_url(project_id: str, request: Request) -> str:
    """Compute the project's mut URL.

    Prefer settings.PUBLIC_API_URL when set (production); fall back to the
    request's own host header so dev / staging show the right thing without
    extra config.
    """
    base = getattr(settings, "PUBLIC_API_URL", None) or ""
    if not base:
        # Best-effort fallback — request.url.scheme/netloc.
        base = f"{request.url.scheme}://{request.url.netloc}"
    return f"{base.rstrip('/')}/api/v1/mut/{project_id}"


@router.get(
    "",
    response_model=ApiResponse[RepoIdentityOut],
    summary="Get the project's access point (URL + prompt + scope keys)",
)
def get_access_point(
    request: Request,
    project: Project = Depends(get_verified_project),
    scope_service: ScopeService = Depends(get_scope_service),
):
    scopes = scope_service.list_for_project(str(project.id))
    # Defensive: ensure root exists. Idempotent — just returns existing if so.
    if not any(s.is_root for s in scopes):
        scope_service.ensure_root_scope(str(project.id))
        scopes = scope_service.list_for_project(str(project.id))

    return ApiResponse.success(
        data=RepoIdentityOut(
            project_id=str(project.id),
            url=_build_repo_url(str(project.id), request),
            prompt_template=getattr(project, "prompt_template", "") or "",
            scopes=[
                RepoIdentityScopeOut(
                    id=s.id,
                    name=s.name,
                    path=s.path,
                    is_root=s.is_root,
                    access_key=s.access_key,        # visible to project members
                )
                for s in scopes
            ],
        ),
        message="Access point retrieved",
    )


@router.patch(
    "",
    response_model=ApiResponse[None],
    summary="Update the project's prompt template",
)
def update_access_point(
    payload: RepoIdentityPatch,
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
):
    if payload.prompt_template is not None:
        # Reuse the project service if it has an update method; otherwise
        # write directly via Supabase client. (Keeping this loose so the
        # project service can grow this method later without breaking us.)
        from src.infra.supabase.client import SupabaseClient
        SupabaseClient().get_client().table("projects").update({
            "prompt_template": payload.prompt_template,
        }).eq("id", str(project.id)).execute()
    return ApiResponse.success(message="Access point updated")
