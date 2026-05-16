"""Content Write API — write, mkdir, mv, rm, bulk-write."""

from __future__ import annotations

import json as _json

from fastapi import APIRouter, Depends, HTTPException

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.routers._content_helpers import ensure_write_access
from src.mut_engine.schemas import (
    BulkWriteRequest,
    MkdirRequest,
    MoveRequest,
    RemoveRequest,
    WriteFileRequest,
)
from src.mut_engine.server.validation import validate_content_size, validate_path
from src.mut_engine.application.transaction_engine import ConcurrentMutationError
from src.mut_engine.adapters.operations.ops_adapter import MutOps
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

write_router = APIRouter()

_EXT_MAP = {"json": ".json", "markdown": ".md"}


def _serialize_content(path: str, content, node_type: str) -> tuple[str, bytes]:
    """Convert request content to bytes and enforce the canonical file extension.

    By design, this function appends the canonical extension (e.g. ``.json``,
    ``.md``) when the caller-supplied *path* does not already end with it.
    This is intentional: the MUT tree uses file extensions to determine
    content type during reads (see ``tree_reader.detect_type``), so a JSON
    node stored without ``.json`` would be misclassified on retrieval.
    Callers that want a specific filename should include the extension in
    the request path.
    """
    if node_type == "json":
        if isinstance(content, str):
            data = content.encode("utf-8")
        else:
            data = _json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
    elif node_type == "markdown":
        data = (content if isinstance(content, str) else str(content)).encode("utf-8")
    elif isinstance(content, bytes):
        data = content
    elif isinstance(content, str):
        data = content.encode("utf-8")
    else:
        data = _json.dumps(content, ensure_ascii=False).encode("utf-8")

    ext = _EXT_MAP.get(node_type)
    if ext and not path.endswith(ext):
        path += ext
    return path, data


@write_router.post(
    "/{project_id}/write",
    summary="Write a file",
)
async def write_file_endpoint(
    project_id: str,
    body: WriteFileRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)

    clean_path, content_bytes = _serialize_content(
        validate_path(body.path), body.content, body.node_type,
    )
    validate_content_size(content_bytes)
    who = f"user:{current_user.user_id}"
    try:
        result = await ops.write_file(
            project_id, clean_path, content_bytes,
            who=who, message=body.message or f"edit {clean_path}",
            base_commit_id=body.base_commit_id,
        )
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    return ApiResponse.success(data={
        "commit_id": result.commit_id,
        "path": clean_path,
        "merged": result.merged,
        "conflicts": result.conflicts,
    })


@write_router.post(
    "/{project_id}/mkdir",
    summary="Create a directory",
)
async def mkdir(
    project_id: str,
    body: MkdirRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"
    try:
        result = await ops.mkdir(
            project_id, body.path, who=who,
            base_commit_id=body.base_commit_id,
        )
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ApiResponse.success(data={"path": validate_path(body.path), "commit_id": result.commit_id})


@write_router.post(
    "/{project_id}/mv",
    summary="Move/rename",
)
async def move(
    project_id: str,
    body: MoveRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)
    old_clean = validate_path(body.old_path)
    new_clean = validate_path(body.new_path)
    who = f"user:{current_user.user_id}"

    try:
        result = await ops.move(
            project_id, old_clean, new_clean,
            who=who, message=body.message or f"moved {old_clean} → {new_clean}",
            base_commit_id=body.base_commit_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    return ApiResponse.success(data={
        "commit_id": result.commit_id,
        "old_path": old_clean,
        "new_path": new_clean,
    })


@write_router.post(
    "/{project_id}/rm",
    summary="Delete files or directories",
)
async def remove(
    project_id: str,
    body: RemoveRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Delete one or more paths from the current MUT tree."""
    ensure_write_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"

    paths = body.paths
    if paths:
        clean = [validate_path(p) for p in paths if p]
        if not clean:
            raise HTTPException(status_code=400, detail="paths is empty")
        if not body.force:
            missing = [p for p in clean if ops.stat(project_id, p) is None]
            if missing:
                raise HTTPException(status_code=404, detail=f"Path not found: {missing[0]}")
        try:
            result = await ops.delete(
                project_id, clean, who=who,
                base_commit_id=body.base_commit_id,
            )
        except ConcurrentMutationError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return ApiResponse.success(data={
            "commit_id": result.commit_id,
            "paths": clean,
        })

    clean_path = validate_path(body.path)
    if not body.force and ops.stat(project_id, clean_path) is None:
        raise HTTPException(status_code=404, detail=f"Path not found: {clean_path}")
    try:
        result = await ops.permanent_delete(
            project_id, clean_path, who=who,
            base_commit_id=body.base_commit_id,
        )
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ApiResponse.success(data={
        "commit_id": result.commit_id,
        "path": clean_path,
    })


@write_router.post(
    "/{project_id}/bulk-write",
    summary="Bulk write files",
)
async def bulk_write(
    project_id: str,
    body: BulkWriteRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_write_access(project_service, current_user, project_id)

    modified: dict[str, bytes] = {}
    for item in body.files:
        path, data = _serialize_content(
            validate_path(item.path), item.content, item.node_type,
        )
        validate_content_size(data)
        modified[path] = data

    who = f"user:{current_user.user_id}"
    result = await ops.bulk_write(
        project_id, modified, who=who,
        message=body.message or "bulk write",
    )

    return ApiResponse.success(data={
        "commit_id": result.commit_id,
        "total": len(modified),
        "merged": result.merged,
    })
