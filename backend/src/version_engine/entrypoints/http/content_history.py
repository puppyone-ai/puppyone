"""Commit history API — commits, commit-content, diff, rollback.

All commit identity is hash-based (40-hex SHA-1 ``commit_id`` over the
git ``commit`` object body). Commits are
returned ordered by ``(created_at ASC, commit_id ASC)``. The frontend
history page reverses in-place to show newest-first; the ASC order
keeps the linear-catch-up semantics usable by the Write Engine's
clone/pull response fields.

The tuple tiebreaker on ``commit_id`` keeps the order deterministic
even if two commits land in the same microsecond on the server.
"""

from __future__ import annotations

import asyncio
import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query

from src.common_schemas import ApiResponse
from src.version_engine.bootstrap.dependencies import get_version_admin_service, get_product_operation_adapter, get_repo_manager
from src.version_engine.read.history_changes import normalize_history_changes
from src.version_engine.entrypoints.http.content_helpers import ensure_project_access, ensure_write_access
from src.version_engine.entrypoints.http.schemas import (
    DiffResponse,
    FileVersionInfo,
    RollbackRequest,
    RollbackResponse,
    VersionHistoryResponse,
)
from src.version_engine.read.admin import VersionAdminService
from src.version_engine.infrastructure.supabase.repo_manager import VersionRepoManager
from src.version_engine.admission.validation import validate_path
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

history_router = APIRouter()


@history_router.get(
    "/{project_id}/commits",
    response_model=ApiResponse[VersionHistoryResponse],
    summary="Commit history",
)
async def get_commits(
    project_id: str,
    path: str = Query(None, description="File path (omit for project-level history)"),
    limit: int = Query(50, description="Maximum number of results"),
    since_commit_id: str = Query(
        "",
        description=(
            "Exclusive anchor — only commits strictly newer than this one "
            "are returned. Leave empty to fetch the most recent ``limit`` "
            "commits (the default)."
        ),
    ),
    version_admin: VersionAdminService = Depends(get_version_admin_service),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    entries = await version_admin.get_commit_history(
        project_id=project_id,
        path=validate_path(path) if path else None,
        limit=limit,
        since_commit_id=since_commit_id,
    )

    commits = [
        FileVersionInfo(
            commit_id=e.get("commit_id", ""),
            who=e.get("who", ""),
            message=e.get("message", ""),
            changes=normalize_history_changes(e.get("changes")),
            conflicts=e.get("conflicts") or [],
            root_hash=e.get("root_hash", ""),
            scope_path=e.get("scope_path", ""),
            created_at=e.get("created_at"),
        )
        for e in entries
    ]
    head_commit_id = commits[-1].commit_id if commits else ""

    root_hash = ops.get_root_hash(project_id) or ""

    return ApiResponse.success(data=VersionHistoryResponse(
        project_id=project_id,
        path=path,
        head_commit_id=head_commit_id,
        root_hash=root_hash,
        commits=commits,
        total=len(commits),
    ))


@history_router.get(
    "/{project_id}/commit-content",
    summary="Get file contents at a specific commit",
)
async def get_commit_content(
    project_id: str,
    path: str = Query(..., description="File path"),
    commit_id: str = Query(..., description="Commit id (40-hex SHA-1)"),
    version_admin: VersionAdminService = Depends(get_version_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    clean_path = validate_path(path)
    try:
        content = await version_admin.get_commit_content(project_id, clean_path, commit_id)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))

    from src.version_engine.read.tree_reader import detect_mime, detect_type
    from src.version_engine.read.text_detection import is_binary_content

    node_type = detect_type(clean_path)
    mime_type = detect_mime(clean_path)
    base = {
        "path": clean_path,
        "commit_id": commit_id,
        "type": node_type,
        "mime_type": mime_type,
        "size_bytes": len(content),
    }

    if node_type == "json":
        try:
            return ApiResponse.success(data={
                **base,
                "is_binary": False,
                "content": _json.loads(content.decode("utf-8")),
            })
        except ValueError:
            pass

    if is_binary_content(content, node_type=node_type, mime_type=mime_type):
        return ApiResponse.success(data={**base, "is_binary": True})

    return ApiResponse.success(data={
        **base,
        "is_binary": False,
        "content_text": content.decode("utf-8", errors="replace"),
    })


@history_router.get(
    "/{project_id}/diff",
    response_model=ApiResponse[DiffResponse],
    summary="Compare two commits",
)
async def diff_commits(
    project_id: str,
    from_commit_id: str = Query(..., description="Source commit id"),
    to_commit_id: str = Query(..., description="Target commit id"),
    version_admin: VersionAdminService = Depends(get_version_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    try:
        changes = await version_admin.compute_diff(project_id, from_commit_id, to_commit_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data=DiffResponse(
        project_id=project_id,
        from_commit_id=from_commit_id,
        to_commit_id=to_commit_id,
        changes=changes,
    ))


@history_router.post(
    "/{project_id}/rollback",
    response_model=ApiResponse[RollbackResponse],
    summary="Rollback to a specific commit",
)
async def rollback(
    project_id: str,
    body: RollbackRequest,
    repo_manager: VersionRepoManager = Depends(get_repo_manager),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)

    from src.version_engine.write_engine.engine import VersionWriteEngine
    from src.version_engine.domain.intents import RollbackIntent

    who = f"user:{current_user.user_id}"
    engine = VersionWriteEngine(repo_manager)

    try:
        result = await engine.rollback(RollbackIntent(
            project_id=project_id,
            scope_path="",
            actor=who,
            source_channel="papi",
            target_commit_id=body.target_commit_id,
            message=f"rollback to {body.target_commit_id}",
        ))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    return ApiResponse.success(data=RollbackResponse(
        project_id=project_id,
        new_commit_id=result.commit_id,
        rolled_back_to=body.target_commit_id,
    ))
