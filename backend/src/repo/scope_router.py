"""HTTP API for repo_scopes CRUD.

Mounted at /api/v1/projects/{project_id}/scopes by main.py.
Every endpoint depends on get_verified_project for tenant isolation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional

from src.common_schemas import ApiResponse
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_verified_project
from src.platform.project.models import Project
from src.repo.scope_service import ScopeService
from src.repo.schemas import (
    ScopeIn, ScopePatch, ScopeOut, ScopeAutoSuggestOut,
)
from src.repo.models import RepoScope


router = APIRouter(
    prefix="/projects/{project_id}/scopes",
    tags=["repo-scopes"],
)


# ──────────────────────────────────────────────────────────────────────────
# DI
# ──────────────────────────────────────────────────────────────────────────

def get_scope_service() -> ScopeService:
    return ScopeService()


# ──────────────────────────────────────────────────────────────────────────
# Mappers
# ──────────────────────────────────────────────────────────────────────────

def _to_out(scope: RepoScope, *, reveal_key: bool = False) -> ScopeOut:
    return ScopeOut(
        id=scope.id,
        project_id=scope.project_id,
        name=scope.name,
        path=scope.path,
        exclude=scope.exclude,
        mode=scope.mode,           # type: ignore[arg-type]
        is_root=scope.is_root,
        access_key=scope.access_key if reveal_key else None,
        access_key_revoked=scope.access_key_revoked_at is not None,
        created_at=scope.created_at,
        updated_at=scope.updated_at,
    )


# ──────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=ApiResponse[list[ScopeOut]],
    summary="List scopes for a project",
)
def list_scopes(
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    # The current user is verified as a project member by get_verified_project.
    # We expose access_key only to project members for now (i.e. always, given
    # the dep gate). Phase C tightens this by consulting repo_user_permissions
    # for fine-grained admin/editor distinction.
    scopes = service.list_for_project(str(project.id))
    return ApiResponse.success(
        data=[_to_out(s, reveal_key=True) for s in scopes],
        message="Scopes listed",
    )


@router.post(
    "",
    response_model=ApiResponse[ScopeOut],
    status_code=status.HTTP_201_CREATED,
    summary="Create a scope (auto-INSERTs cli + agent connectors)",
)
def create_scope(
    payload: ScopeIn,
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    scope = service.create(
        project_id=str(project.id),
        name=payload.name,
        path=payload.path,
        exclude=payload.exclude,
        mode=payload.mode,
    )
    return ApiResponse.success(data=_to_out(scope, reveal_key=True), message="Scope created")


@router.patch(
    "/{scope_id}",
    response_model=ApiResponse[ScopeOut],
    summary="Update name / exclude / mode (path is immutable)",
)
def update_scope(
    scope_id: str,
    payload: ScopePatch,
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    existing = service.get(scope_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Scope not found")
    updated = service.update(
        scope_id,
        name=payload.name,
        exclude=payload.exclude,
        mode=payload.mode,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Scope not found after update")
    return ApiResponse.success(data=_to_out(updated, reveal_key=True), message="Scope updated")


@router.delete(
    "/{scope_id}",
    response_model=ApiResponse[None],
    summary="Delete a non-root scope (cascades cli/agent connectors)",
)
def delete_scope(
    scope_id: str,
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    existing = service.get(scope_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Scope not found")
    # has_bound_connectors: count connectors that are NOT cli/agent (which
    # are auto-managed and cascade with the scope).
    from src.repo.connector_repository import ConnectorRepository
    conn_repo = ConnectorRepository()
    n_third_party = conn_repo.count_third_party_for_scope(scope_id)
    service.delete(scope_id, has_bound_connectors=n_third_party > 0)
    return ApiResponse.success(message="Scope deleted")


@router.post(
    "/{scope_id}/regenerate-key",
    response_model=ApiResponse[ScopeOut],
    summary="Mint a new access_key for the scope",
)
def regenerate_scope_key(
    scope_id: str,
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    existing = service.get(scope_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Scope not found")
    new_key = service.regenerate_access_key(scope_id)
    if new_key is None:
        raise HTTPException(status_code=500, detail="Failed to regenerate key")
    refreshed = service.get(scope_id)
    return ApiResponse.success(data=_to_out(refreshed, reveal_key=True), message="Key regenerated")


@router.post(
    "/auto-suggest",
    response_model=ApiResponse[ScopeAutoSuggestOut],
    summary="Suggest new scopes from current top-level folders",
)
def auto_suggest_scopes(
    project: Project = Depends(get_verified_project),
    service: ScopeService = Depends(get_scope_service),
):
    """Reads the current version tree's top-level folders and returns those
    not already covered by an existing scope as proposed scope candidates."""
    from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
    ops = build_worker_version_engine_container().product_operations()
    try:
        entries = ops.list_dir(str(project.id), "")
    except Exception:
        entries = []
    folder_names = [e.name for e in entries if getattr(e, "type", None) == "folder"]
    suggestions = service.auto_suggest_from_tree(str(project.id), folder_names)
    return ApiResponse.success(
        data=ScopeAutoSuggestOut(suggestions=[
            ScopeIn(**s) for s in suggestions
        ]),
        message="Suggestions generated",
    )
