"""Commit history API — commits, commit-content, diff, rollback.

All commit identity is hash-based (40-hex SHA-1 ``commit_id`` over the
git ``commit`` object body). Commits are
returned ordered by ``(created_at ASC, commit_id ASC)`` — matching the
``mut.server.history`` filesystem backend contract. The frontend
history page reverses in-place to show newest-first; the ASC order
keeps the linear-catch-up semantics usable by the MUT protocol's
clone/pull response fields.

The tuple tiebreaker on ``commit_id`` keeps the order deterministic
even if two commits land in the same microsecond on the server.
"""

from __future__ import annotations

import asyncio
import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_admin_service, get_mut_ops, get_repo_manager
from src.mut_engine.history_changes import normalize_history_changes
from src.mut_engine.routers._content_helpers import ensure_project_access, ensure_write_access
from src.mut_engine.schemas import (
    DiffResponse,
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
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    entries = await mut_admin.get_commit_history(
        project_id=project_id,
        path=validate_path(path) if path else None,
        limit=limit,
        since_commit_id=since_commit_id,
    )
    head_commit_id = ops.get_head_commit_id(project_id)

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
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    clean_path = validate_path(path)
    try:
        content = await mut_admin.get_commit_content(project_id, clean_path, commit_id)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))

    from src.mut_engine.services.tree_reader import detect_mime, detect_type
    from src.mut_engine.text_detection import is_binary_content

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
    mut_admin: MutAdminService = Depends(get_mut_admin_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    try:
        changes = await mut_admin.compute_diff(project_id, from_commit_id, to_commit_id)
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
    repo_manager: MutRepoManager = Depends(get_repo_manager),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)

    from src.mut_engine.adapters.mut.rollback_adapter import submit_mut_rollback
    from src.mut_engine.adapters.mut.protocol import PROTOCOL_VERSION
    from src.mut_engine.application.errors import (
        ClientTooOldError,
        LockError,
        ObjectNotFoundError,
        PermissionDenied,
    )

    who = f"user:{current_user.user_id}"
    auth = {
        "agent": who,
        "_scope": {"id": who, "path": "", "exclude": [], "mode": "rw"},
    }
    mut_body = {
        "protocol_version": PROTOCOL_VERSION,
        "target_commit_id": body.target_commit_id,
    }

    try:
        result = await submit_mut_rollback(repo_manager, project_id, auth, mut_body)
    except ClientTooOldError as e:
        raise HTTPException(status_code=426, detail=str(e))
    except PermissionDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except (ValueError, ObjectNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LockError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {e}")

    return ApiResponse.success(data=RollbackResponse(
        project_id=project_id,
        new_commit_id=result.get("new_commit_id", ""),
        rolled_back_to=body.target_commit_id,
    ))
