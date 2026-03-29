"""
Content API — REST HTTP shell for MutOps.

Provides POSIX-like file system operations (ls, cat, write, mkdir, mv, rm)
on the MUT content tree. Used by the frontend Web UI and internal services.

MutOps is the sole entry point for operations; this file only handles:
  HTTP parameter parsing + authentication + calling MutOps + formatting responses

Endpoints:
  GET  /ls       — list directory contents
  GET  /cat      — read file contents
  GET  /stat     — get file/directory info
  GET  /tree     — get full directory tree
  POST /write    — write a file
  POST /mkdir    — create a directory
  POST /mv       — move/rename
  POST /rm       — delete (move to .trash)
  POST /restore  — restore from .trash
  GET  /trash    — list trash bin contents
  GET  /versions — version history
  GET  /version-content — get file contents at a specific version
  GET  /diff     — compare two versions
  POST /rollback — rollback to a specific version
"""

from __future__ import annotations

import asyncio
import json as _json

from fastapi import APIRouter, Depends, HTTPException, Query

from src.common_schemas import ApiResponse
from src.exceptions import ErrorCode, NotFoundException
from src.mut_engine.dependencies import (
    get_mut_admin_service,
    get_mut_ops,
    get_repo_manager,
)
from src.mut_engine.schemas import (
    BulkWriteRequest,
    FileVersionInfo,
    ListDirResponse,
    MkdirRequest,
    MoveRequest,
    MutEntryResponse,
    ReadFileResponse,
    RemoveRequest,
    RestoreRequest,
    RollbackRequest,
    RollbackResponse,
    StatResponse,
    TrashListResponse,
    TreeResponse,
    VersionHistoryResponse,
    WriteFileRequest,
)
from src.mut_engine.server.admin import MutAdminService
from src.mut_engine.server.repo_manager import MutRepoManager
from src.mut_engine.services.ops import MutOps
from src.mut_engine.services.tree_reader import MutEntry
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

router = APIRouter(
    prefix="/content",
    tags=["content"],
)


def _ensure_project_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> None:
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise NotFoundException(
            f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND
        )


def _entry_to_response(entry: MutEntry) -> MutEntryResponse:
    return MutEntryResponse(
        name=entry.name,
        path=entry.path,
        type=entry.type,
        content_hash=entry.content_hash,
        size_bytes=entry.size_bytes,
        mime_type=entry.mime_type,
        children_count=entry.children_count,
    )


# ═══════════════════════════════════════════════
# Read API
# ═══════════════════════════════════════════════

@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = ops.list_dir(project_id, clean_path)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = ops.get_version(project_id)

    return ApiResponse.success(data=ListDirResponse(
        path=clean_path,
        entries=[_entry_to_response(e) for e in entries],
        version=version,
    ))


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

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
        except (ValueError, UnicodeDecodeError):
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


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

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


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)
    clean_path = path.strip("/")

    entries = ops.list_tree(project_id, clean_path, max_depth=max_depth)
    entries = [e for e in entries if not e.path.startswith(".trash/") and e.path != ".trash"]
    version = ops.get_version(project_id)

    return ApiResponse.success(data=TreeResponse(
        path=clean_path,
        entries=[_entry_to_response(e) for e in entries],
        version=version,
    ))


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)

    entries = ops.list_dir(project_id, ".trash")
    return ApiResponse.success(data=TrashListResponse(
        entries=[_entry_to_response(e) for e in entries],
    ))


# ═══════════════════════════════════════════════
# Write API (via MutOps)
# ═══════════════════════════════════════════════

@router.post(
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
    _ensure_project_access(project_service, current_user, project_id)

    clean_path = body.path.strip("/")
    if body.node_type == "json":
        if isinstance(body.content, str):
            content_bytes = body.content.encode("utf-8")
        else:
            content_bytes = _json.dumps(body.content, ensure_ascii=False, indent=2).encode("utf-8")
        if not clean_path.endswith(".json"):
            clean_path += ".json"
    elif body.node_type == "markdown":
        content_bytes = (body.content if isinstance(body.content, str) else str(body.content)).encode("utf-8")
        if not clean_path.endswith(".md"):
            clean_path += ".md"
    else:
        if isinstance(body.content, bytes):
            content_bytes = body.content
        elif isinstance(body.content, str):
            content_bytes = body.content.encode("utf-8")
        else:
            content_bytes = _json.dumps(body.content, ensure_ascii=False).encode("utf-8")

    who = f"user:{current_user.user_id}"
    result = await ops.write_file(
        project_id, clean_path, content_bytes,
        who=who, message=body.message or f"edit {clean_path}",
    )

    return ApiResponse.success(data={
        "version": result.version,
        "path": clean_path,
        "merged": result.merged,
        "conflicts": result.conflicts,
    })


@router.post(
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
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"
    result = await ops.mkdir(project_id, body.path, who=who)
    return ApiResponse.success(data={"path": body.path.strip("/"), "version": result.version})


@router.post(
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
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"

    try:
        result = await ops.move(
            project_id, body.old_path, body.new_path,
            who=who, message=body.message or f"moved {body.old_path} → {body.new_path}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ApiResponse.success(data={
        "version": result.version,
        "old_path": body.old_path.strip("/"),
        "new_path": body.new_path.strip("/"),
    })


@router.post(
    "/{project_id}/rm",
    summary="Delete (move to .trash)",
)
async def remove(
    project_id: str,
    body: RemoveRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"
    clean_path = body.path.strip("/")

    if body.permanent:
        result = await ops.permanent_delete(project_id, clean_path, who=who)
        return ApiResponse.success(data={
            "version": result.version,
            "path": clean_path,
        })
    else:
        result = await ops.trash(project_id, clean_path, who=who)
        trash_path = [p for p in result.paths if p.startswith(".trash/")]
        return ApiResponse.success(data={
            "version": result.version,
            "path": clean_path,
            "old_path": clean_path,
            "new_path": trash_path[0] if trash_path else "",
        })


@router.post(
    "/{project_id}/restore",
    summary="Restore from .trash",
)
async def restore(
    project_id: str,
    body: RestoreRequest,
    ops: MutOps = Depends(get_mut_ops),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    who = f"user:{current_user.user_id}"

    result = await ops.restore(
        project_id, body.trash_path, body.original_path, who=who,
    )

    return ApiResponse.success(data={
        "version": result.version,
        "old_path": body.trash_path.strip("/"),
        "new_path": body.original_path.strip("/"),
    })


@router.post(
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
    _ensure_project_access(project_service, current_user, project_id)

    modified: dict[str, bytes] = {}
    for item in body.files:
        clean_path = item.path.strip("/")
        if item.node_type == "json":
            content_bytes = _json.dumps(item.content, ensure_ascii=False, indent=2).encode("utf-8")
            if not clean_path.endswith(".json"):
                clean_path += ".json"
        elif item.node_type == "markdown":
            content_bytes = (item.content if isinstance(item.content, str) else str(item.content)).encode("utf-8")
            if not clean_path.endswith(".md"):
                clean_path += ".md"
        else:
            content_bytes = (item.content if isinstance(item.content, str) else _json.dumps(item.content)).encode("utf-8")
        modified[clean_path] = content_bytes

    who = f"user:{current_user.user_id}"
    result = await ops.bulk_write(
        project_id, modified, who=who,
        message=body.message or "bulk write",
    )

    return ApiResponse.success(data={
        "version": result.version,
        "total": len(modified),
        "merged": result.merged,
    })


# ═══════════════════════════════════════════════
# Version history API (uses MutAdminService for admin/history queries)
# ═══════════════════════════════════════════════

@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)

    entries = await mut_admin.get_version_history(
        project_id=project_id,
        path=path.strip("/") if path else None,
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


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)

    clean_path = path.strip("/")
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
        except (ValueError, UnicodeDecodeError):
            pass

    return ApiResponse.success(data={
        "path": clean_path,
        "version": version,
        "type": node_type,
        "content_text": content.decode("utf-8", errors="replace"),
    })


@router.get(
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
    _ensure_project_access(project_service, current_user, project_id)

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


@router.post(
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
    _ensure_project_access(project_service, current_user, project_id)

    from mut.server.handlers import handle_rollback

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
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ApiResponse.success(data=RollbackResponse(
        project_id=project_id,
        new_version=result.get("new_version", 0),
        rolled_back_to=body.target_version,
    ))
