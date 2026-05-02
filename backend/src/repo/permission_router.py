"""HTTP API for repo_user_permissions (team plans).

Mounted at /api/v1/projects/{project_id}/permissions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from src.common_schemas import ApiResponse
from src.exceptions import AppException
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_verified_project
from src.platform.project.models import Project
from src.repo.models import RepoUserPermission, ResolvedPermission
from src.repo.permission_service import PermissionService
from src.repo.schemas import (
    PermissionIn, PermissionPatch, PermissionOut,
    PermissionCheckIn, PermissionCheckOut,
)


router = APIRouter(
    prefix="/projects/{project_id}/permissions",
    tags=["repo-permissions"],
)


def get_permission_service() -> PermissionService:
    return PermissionService()


def _row_to_out(p: RepoUserPermission) -> PermissionOut:
    return PermissionOut(
        project_id=p.project_id,
        user_id=p.user_id,
        role=p.role,                              # type: ignore[arg-type]
        source="explicit",
        allowed_scope_ids=p.allowed_scope_ids,
        granted_by=p.granted_by,
        granted_at=p.granted_at,
    )


def _resolved_to_out(project_id: str, user_id: str, r: ResolvedPermission) -> PermissionOut:
    return PermissionOut(
        project_id=project_id,
        user_id=user_id,
        role=r.role,                              # type: ignore[arg-type]
        source=r.source,                          # type: ignore[arg-type]
        allowed_scope_ids=r.allowed_scope_ids,
        granted_by=None,
        granted_at=None,
    )


@router.get(
    "",
    response_model=ApiResponse[list[PermissionOut]],
    summary="List explicit permissions for a project",
)
def list_permissions(
    project: Project = Depends(get_verified_project),
    service: PermissionService = Depends(get_permission_service),
):
    rows = service.list_for_project(str(project.id))
    return ApiResponse.success(
        data=[_row_to_out(r) for r in rows],
        message="Permissions listed",
    )


@router.post(
    "",
    response_model=ApiResponse[PermissionOut],
    status_code=status.HTTP_201_CREATED,
    summary="Grant or update a per-user permission (admin only)",
)
def upsert_permission(
    payload: PermissionIn,
    project: Project = Depends(get_verified_project),
    current_user: CurrentUser = Depends(get_current_user),
    service: PermissionService = Depends(get_permission_service),
):
    # Caller must have admin on this project to grant.
    resolved = service.resolve(str(project.id), current_user.user_id)
    if not resolved.can_admin:
        raise HTTPException(
            status_code=403, detail="Admin role required to manage permissions",
        )
    try:
        row = service.upsert(
            project_id=str(project.id),
            user_id=payload.user_id,
            role=payload.role,
            allowed_scope_ids=payload.allowed_scope_ids,
            granted_by=current_user.user_id,
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return ApiResponse.success(data=_row_to_out(row), message="Permission set")


@router.patch(
    "/{user_id}",
    response_model=ApiResponse[PermissionOut],
    summary="Update permission for a user (admin only)",
)
def patch_permission(
    user_id: str,
    payload: PermissionPatch,
    project: Project = Depends(get_verified_project),
    current_user: CurrentUser = Depends(get_current_user),
    service: PermissionService = Depends(get_permission_service),
):
    resolved = service.resolve(str(project.id), current_user.user_id)
    if not resolved.can_admin:
        raise HTTPException(status_code=403, detail="Admin role required")

    # Get existing to know what to merge.
    existing = service.resolve(str(project.id), user_id)
    if existing.source != "explicit":
        raise HTTPException(
            status_code=404,
            detail="No explicit permission for this user (currently inherited).",
        )

    new_role = payload.role or existing.role
    new_scope_ids = (
        payload.allowed_scope_ids
        if payload.allowed_scope_ids is not None
        else existing.allowed_scope_ids
    )
    try:
        row = service.upsert(
            project_id=str(project.id),
            user_id=user_id,
            role=new_role,
            allowed_scope_ids=new_scope_ids,
            granted_by=current_user.user_id,
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return ApiResponse.success(data=_row_to_out(row), message="Permission updated")


@router.delete(
    "/{user_id}",
    response_model=ApiResponse[None],
    summary="Revoke explicit permission (reverts to org_member fallback)",
)
def revoke_permission(
    user_id: str,
    project: Project = Depends(get_verified_project),
    current_user: CurrentUser = Depends(get_current_user),
    service: PermissionService = Depends(get_permission_service),
):
    resolved = service.resolve(str(project.id), current_user.user_id)
    if not resolved.can_admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    service.revoke(str(project.id), user_id)
    return ApiResponse.success(message="Permission revoked")


@router.post(
    "/check",
    response_model=ApiResponse[PermissionCheckOut],
    summary="Check whether a user can perform an action",
)
def check_permission(
    payload: PermissionCheckIn,
    project: Project = Depends(get_verified_project),
    service: PermissionService = Depends(get_permission_service),
):
    allowed, reason = service.check(
        str(project.id), payload.user_id, payload.action, scope_id=payload.scope_id,
    )
    return ApiResponse.success(
        data=PermissionCheckOut(allowed=allowed, reason=reason),
        message="Checked",
    )
