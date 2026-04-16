"""Content History API — versions, version-content, diff, rollback."""

from __future__ import annotations

import asyncio
import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_admin_service, get_mut_ops, get_repo_manager
from src.mut_engine.routers._content_helpers import ensure_project_access, ensure_write_access
from src.mut_engine.schemas import (
    FileVersionInfo,
    RollbackRequest,
    RollbackResponse,
    VersionHistoryResponse,
)
from src.mut_engine.server.admin import MutAdminService
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.server.validation import validate_path
from src.mut_engine.services.ops import MutOps
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

history_router = APIRouter()


@history_router.get(
    "/{project_id}/versions",
    response_model=ApiResponse[VersionHistoryResponse],
    summary="Version history",
)
async def get_versions(
    project_id: str,
    path: str = Query(None, description="File path (omit for project-level history)"),
    limit: int = Query(50, description="Maximum number of results"),
    since_version: int = Query(0, description="Start from after this version"),
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    entries = await mut_admin.get_version_history(
        project_id=project_id,
        path=validate_path(path) if path else None,
        limit=limit,
        since_version=since_version,
    )
    current_version = ops.get_version(project_id)

    versions = []
    for e in entries:
        versions.append(FileVersionInfo(
            version=e.get("version", 0),
            who=e.get("who", ""),
            message=e.get("message", ""),
            changes=e.get("changes") or [],
            conflicts=e.get("conflicts") or [],
            root_hash=e.get("root_hash", ""),
            scope_path=e.get("scope_path", ""),
            created_at=e.get("created_at"),
        ))

    root_hash = ops.get_root_hash(project_id) or ""

    return ApiResponse.success(data=VersionHistoryResponse(
        project_id=project_id,
        path=path,
        current_version=current_version,
        root_hash=root_hash,
        commits=versions,
        total=len(versions),
    ))


@history_router.get(
    "/{project_id}/version-content",
    summary="Get file contents at a specific version",
)
async def get_version_content(
    project_id: str,
    path: str = Query(..., description="File path"),
    version: int = Query(..., description="Version number"),
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    clean_path = validate_path(path)
    try:
        content = await mut_admin.get_version_content(project_id, clean_path, version)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))

    from src.mut_engine.services.tree_reader import detect_type
    node_type = detect_type(clean_path)

    if node_type == "json":
        try:
            return ApiResponse.success(data={
                "path": clean_path,
                "version": version,
                "type": "json",
                "content": _json.loads(content.decode("utf-8")),
            })
        except ValueError:
            pass

    return ApiResponse.success(data={
        "path": clean_path,
        "version": version,
        "type": node_type,
        "content_text": content.decode("utf-8", errors="replace"),
    })


@history_router.get(
    "/{project_id}/diff",
    summary="Compare two versions",
)
async def diff_versions(
    project_id: str,
    v1: int = Query(..., description="Version 1"),
    v2: int = Query(..., description="Version 2"),
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    try:
        changes = await mut_admin.compute_diff(project_id, v1, v2)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data={
        "project_id": project_id,
        "v1": v1,
        "v2": v2,
        "changes": changes,
    })


@history_router.post(
    "/{project_id}/rollback",
    response_model=ApiResponse[RollbackResponse],
    summary="Rollback to a specific version",
)
async def rollback(
    project_id: str,
    body: RollbackRequest,
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)

    from mut.foundation.error import LockError, ObjectNotFoundError, PermissionDenied
    from mut.server.handlers import handle_rollback
    from src.mut_engine.services.hooks import run_post_push_hook

    who = f"user:{current_user.user_id}"
    auth = {
        "agent": who,
        "_scope": {"id": who, "path": "", "exclude": [], "mode": "rw"},
    }
    mut_body = {"target_version": body.target_version}

    try:
        repo = repo_manager.get_server_repo(project_id)
        result = await asyncio.to_thread(
            handle_rollback, repo, auth, mut_body,
        )
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except (ValueError, ObjectNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    await asyncio.to_thread(run_post_push_hook, project_id, repo_manager, result)

    return ApiResponse.success(data=RollbackResponse(
        project_id=project_id,
        new_version=result.get("new_version", 0),
        rolled_back_to=body.target_version,
    ))
