"""Content Read API — ls, cat, stat, tree, trash."""

from __future__ import annotations

import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.routers._content_helpers import ensure_project_access, entry_to_response
from src.mut_engine.schemas import (
    ListDirResponse,
    ReadFileResponse,
    StatResponse,
    TrashListResponse,
    TreeResponse,
)
from src.mut_engine.server.validation import validate_path
from src.mut_engine.services.ops import MutOps
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

read_router = APIRouter()

_TRASH_DIR = ".trash"
_TRASH_PREFIX = f"{_TRASH_DIR}/"


def _exclude_trash(entries: list) -> list:
    return [e for e in entries if not e.path.startswith(_TRASH_PREFIX) and e.path != _TRASH_DIR]


@read_router.get(
    "/{project_id}/ls",
    response_model=ApiResponse[ListDirResponse],
    summary="List directory contents",
)
def list_dir(
    project_id: str,
    path: str = Query("", description="Directory path, empty = root directory"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)
    clean_path = validate_path(path)

    entries = ops.list_dir(project_id, clean_path)
    entries = _exclude_trash(entries)
    version = ops.get_version(project_id)

    return ApiResponse.success(data=ListDirResponse(
        path=clean_path,
        entries=[entry_to_response(e) for e in entries],
        version=version,
    ))


@read_router.get(
    "/{project_id}/cat",
    response_model=ApiResponse[ReadFileResponse],
    summary="Read file contents",
)
def read_file(
    project_id: str,
    path: str = Query(..., description="File path"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)
    clean_path = validate_path(path)

    try:
        content = ops.read_file(project_id, clean_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {clean_path}")

    entry = ops.stat(project_id, clean_path)
    node_type = entry.type if entry else "file"
    version = ops.get_version(project_id)

    content_json = None
    content_text = None

    if node_type == "json":
        try:
            content_json = _json.loads(content.decode("utf-8"))
        except ValueError:
            content_text = content.decode("utf-8", errors="replace")
    else:
        content_text = content.decode("utf-8", errors="replace")

    return ApiResponse.success(data=ReadFileResponse(
        path=clean_path,
        type=node_type,
        content=content_json,
        content_text=content_text,
        content_hash=entry.content_hash if entry else None,
        version=version,
    ))


@read_router.get(
    "/{project_id}/stat",
    response_model=ApiResponse[StatResponse],
    summary="Get file/directory info",
)
def stat(
    project_id: str,
    path: str = Query(..., description="Path"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)
    clean_path = validate_path(path)

    entry = ops.stat(project_id, clean_path)
    if not entry:
        return ApiResponse.success(data=StatResponse(
            path=clean_path,
            type="",
            name="",
            exists=False,
        ))

    return ApiResponse.success(data=StatResponse(
        path=entry.path,
        type=entry.type,
        name=entry.name,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
        exists=True,
    ))


@read_router.get(
    "/{project_id}/tree",
    response_model=ApiResponse[TreeResponse],
    summary="Get full directory tree",
)
def full_tree(
    project_id: str,
    path: str = Query("", description="Starting path"),
    max_depth: int = Query(-1, description="Maximum recursion depth, -1 = unlimited"),
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)
    clean_path = validate_path(path)

    entries = ops.list_tree(project_id, clean_path, max_depth=max_depth)
    entries = _exclude_trash(entries)
    version = ops.get_version(project_id)

    return ApiResponse.success(data=TreeResponse(
        path=clean_path,
        entries=[entry_to_response(e) for e in entries],
        version=version,
    ))


@read_router.get(
    "/{project_id}/trash",
    response_model=ApiResponse[TrashListResponse],
    summary="List trash bin contents",
)
def list_trash(
    project_id: str,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    ensure_project_access(project_service, current_user, project_id)

    entries = ops.list_dir(project_id, _TRASH_DIR)
    return ApiResponse.success(data=TrashListResponse(
        entries=[entry_to_response(e) for e in entries],
    ))
