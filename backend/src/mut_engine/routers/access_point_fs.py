"""Access Point scoped filesystem API.

This router exposes POSIX-like filesystem operations through an access point
credential. It is intentionally provider-agnostic: any access point with a
valid ``config.scope`` can use it.
"""

from __future__ import annotations

import asyncio
import json as _json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.routers.access_point import resolve_access_point
from src.mut_engine.routers.content_write import _serialize_content
from src.mut_engine.schemas import (
    CopyRequest,
    MkdirRequest,
    MoveRequest,
    RemoveRequest,
    RmdirRequest,
    TouchRequest,
    WriteFileRequest,
)
from src.mut_engine.server.auth import enforce_channel_pause
from src.mut_engine.server.validation import (
    validate_content_size,
    validate_limit,
    validate_path,
)
from src.mut_engine.services.direct_writer import ConcurrentMutationError
from src.mut_engine.services.ops import MutOps


router = APIRouter(prefix="/ap-fs", tags=["access-point-fs"])

_READ_MODES = frozenset({"r", "rw", "read", "write"})
_WRITE_MODES = frozenset({"rw", "write", "w"})
_RECURSIVE_DEFAULT_LIMIT = 5000
_RECURSIVE_MAX_LIMIT = 50000


def _normalize_access_key(x_access_key: str | None) -> str:
    key = (x_access_key or "").strip()
    if not key:
        raise HTTPException(status_code=401, detail="X-Access-Key header is required")
    return key


async def _resolve_auth(
    x_access_key: str | None,
    x_mut_user: str | None,
    x_puppy_client: str | None = None,
) -> tuple[str, dict, dict]:
    project_id, auth = await asyncio.to_thread(
        resolve_access_point, _normalize_access_key(x_access_key),
    )

    bound_identity = auth.get("_user_identity", "")
    if bound_identity:
        if not x_mut_user:
            raise HTTPException(
                status_code=401,
                detail="X-Mut-User header required: key is bound to a specific user",
            )
        if x_mut_user != bound_identity:
            raise HTTPException(
                status_code=401,
                detail="User identity mismatch: key is bound to a different user",
            )

    scope = auth.get("_scope") or {}
    scope_path = validate_path(scope.get("path", ""))
    mode = str(scope.get("mode", "r")).lower()
    if mode not in _READ_MODES:
        raise HTTPException(status_code=403, detail="Access point does not allow filesystem reads")

    # /ap-fs is the PuppyOne scoped filesystem command surface. Treat missing
    # legacy headers as the CLI channel so pause/resume remains enforceable
    # for older puppyone CLI builds, while still honoring explicit overrides.
    enforce_channel_pause(auth, x_puppy_client or "cli", log_prefix="[AP-FS]")

    normalized_scope = {
        "id": scope.get("id") or auth.get("agent"),
        "path": scope_path,
        "mode": mode,
        "exclude": scope.get("exclude") if isinstance(scope.get("exclude"), list) else [],
    }
    return project_id, auth, normalized_scope


def _ensure_writable(scope: dict) -> None:
    if str(scope.get("mode", "r")).lower() not in _WRITE_MODES:
        raise HTTPException(status_code=403, detail="Access point is read-only")


def _clean_relative(path: str | None) -> str:
    raw = (path or "").strip()
    if raw in ("", "/", "."):
        return ""
    return validate_path(raw)


def _join_scope(scope_path: str, relative_path: str) -> str:
    if not scope_path:
        return relative_path
    if not relative_path:
        return scope_path
    return f"{scope_path}/{relative_path}"


def _relative_to_scope(full_path: str, scope_path: str) -> str:
    clean = full_path.strip("/")
    scope = scope_path.strip("/")
    if not scope:
        return clean
    if clean == scope:
        return ""
    prefix = f"{scope}/"
    if clean.startswith(prefix):
        return clean[len(prefix):]
    return clean


def _matches_exclude(relative_path: str, excludes: list[Any]) -> bool:
    rel = relative_path.strip("/")
    if not rel:
        return False
    segments = rel.split("/")
    for item in excludes:
        pattern = str(item).strip("/")
        if not pattern:
            continue
        if "/" in pattern:
            if rel == pattern or rel.startswith(f"{pattern}/"):
                return True
        elif pattern in segments:
            return True
    return False


def _assert_not_excluded(relative_path: str, scope: dict) -> None:
    if _matches_exclude(relative_path, scope.get("exclude") or []):
        raise HTTPException(status_code=403, detail=f"Path is excluded from this access point: {relative_path}")


def _entry_to_scoped_response(entry, scope: dict) -> dict:
    rel_path = _relative_to_scope(entry.path, scope["path"])
    return {
        "name": entry.name,
        "path": rel_path,
        "mut_path": entry.path,
        "type": entry.type,
        "content_hash": entry.content_hash,
        "size_bytes": entry.size_bytes,
        "mime_type": entry.mime_type,
        "children_count": entry.children_count,
        "created_at": getattr(entry, "created_at", None),
        "modified_at": getattr(entry, "modified_at", None),
    }


def _is_hidden_path(path: str) -> bool:
    return any(part.startswith(".") for part in path.strip("/").split("/") if part)


def _filter_entries(entries: list, scope: dict, *, include_hidden: bool = False) -> list:
    filtered = []
    excludes = list(scope.get("exclude") or [])
    for entry in entries:
        rel_path = _relative_to_scope(entry.path, scope["path"])
        if not include_hidden and _is_hidden_path(rel_path):
            continue
        if _matches_exclude(rel_path, excludes):
            continue
        filtered.append(entry)
    return filtered


def _filter_directories(entries: list) -> list:
    return [entry for entry in entries if entry.type == "folder"]


def _scope_payload(scope: dict) -> dict:
    return {
        "path": scope["path"],
        "mode": scope["mode"],
        "exclude": scope.get("exclude") or [],
    }


def _query_bool(value: Any, default: bool = False) -> bool:
    return value if isinstance(value, bool) else default


def _query_int(value: Any, default: int) -> int:
    return value if isinstance(value, int) else default


def _query_optional_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _operator(auth: dict) -> str:
    return f"access_point:{auth.get('agent', 'unknown')}"


def _basename(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[-1]


def _dirname(path: str) -> str:
    clean = path.strip("/")
    if not clean or "/" not in clean:
        return ""
    return clean.rsplit("/", 1)[0]


def _is_directory_empty(project_id: str, path: str, ops: MutOps) -> bool:
    return len(ops.list_dir(project_id, path)) == 0


def _rmdir_chain(project_id: str, rel_path: str, scope: dict, ops: MutOps, *, parents: bool) -> list[str]:
    """Return deepest-first empty directory chain removable by rmdir."""
    full_path = _join_scope(scope["path"], rel_path)
    entry = ops.stat(project_id, full_path)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No such file or directory: {rel_path}")
    if entry.type != "folder":
        raise HTTPException(status_code=400, detail=f"Not a directory: {rel_path}")
    if not _is_directory_empty(project_id, full_path, ops):
        raise HTTPException(status_code=400, detail=f"Directory not empty: {rel_path}")

    removable = [rel_path]
    if not parents:
        return removable

    child_rel = rel_path
    parent_rel = _dirname(rel_path)
    while parent_rel:
        _assert_not_excluded(parent_rel, scope)
        parent_full = _join_scope(scope["path"], parent_rel)
        parent = ops.stat(project_id, parent_full)
        if parent is None or parent.type != "folder":
            break
        child_full = _join_scope(scope["path"], child_rel)
        remaining = [
            e for e in ops.list_dir(project_id, parent_full)
            if e.path.strip("/") != child_full.strip("/")
        ]
        if remaining:
            break
        removable.append(parent_rel)
        child_rel = parent_rel
        parent_rel = _dirname(parent_rel)

    return removable


def _attach_timestamps(
    project_id: str,
    entries: list,
    ops: MutOps,
    *,
    extra_paths: list[str] | None = None,
) -> None:
    paths = [entry.path for entry in entries]
    if extra_paths:
        paths.extend(extra_paths)
    timestamps = ops.get_path_timestamps(project_id, paths)
    for entry in entries:
        data = timestamps.get(entry.path.strip("/")) or {}
        entry.created_at = data.get("created_at") or None
        entry.modified_at = data.get("modified_at") or None


@router.get("/ls", response_model=ApiResponse)
async def list_dir(
    path: str = Query("", description="Path relative to the access point scope"),
    include_hidden: bool = Query(False, description="Include entries whose names begin with '.'"),
    include_size: bool = Query(False, description="Include file sizes by reading file blobs"),
    include_times: bool = Query(False, description="Include timestamps derived from MUT history"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    target = ops.stat(project_id, full_path, include_size=include_size)
    if target is None and rel_path:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")
    target_type = target.type if target else ""
    if target and target.type != "folder":
        # POSIX ls on a file lists that file itself, not the parent directory.
        entries = [target]
    else:
        entries = _filter_entries(
            ops.list_dir(project_id, full_path, include_size=include_size), scope,
            include_hidden=include_hidden,
        )
    if include_times:
        _attach_timestamps(project_id, entries, ops, extra_paths=[full_path])
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "target_type": target_type,
        "entries": [_entry_to_scoped_response(e, scope) for e in entries],
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/tree", response_model=ApiResponse)
async def tree(
    path: str = Query("", description="Path relative to the access point scope"),
    max_depth: int = Query(-1, description="Maximum recursion depth, -1 = unlimited"),
    limit: int = Query(
        _RECURSIVE_DEFAULT_LIMIT,
        description="Maximum entries returned before truncation",
    ),
    include_hidden: bool = Query(False, description="Include entries whose names begin with '.'"),
    include_size: bool = Query(False, description="Include file sizes by reading file blobs"),
    include_times: bool = Query(False, description="Include timestamps derived from MUT history"),
    directories_only: bool = Query(False, description="Only include directories"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)
    max_depth = _query_int(max_depth, -1)
    include_hidden = _query_bool(include_hidden)
    include_size = _query_bool(include_size)
    include_times = _query_bool(include_times)
    directories_only = _query_bool(directories_only)
    safe_limit = validate_limit(
        _query_int(limit, _RECURSIVE_DEFAULT_LIMIT),
        default=_RECURSIVE_DEFAULT_LIMIT,
        maximum=_RECURSIVE_MAX_LIMIT,
    )

    full_path = _join_scope(scope["path"], rel_path)
    target = ops.stat(project_id, full_path, include_size=include_size)
    if target is None and rel_path:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")
    target_type = target.type if target else ""
    if target and target.type != "folder":
        entries = [] if directories_only else [target]
        truncated = False
    else:
        entries = _filter_entries(
            ops.list_tree(
                project_id, full_path, max_depth=max_depth,
                include_size=include_size,
                max_entries=safe_limit + 1,
            ), scope,
            include_hidden=include_hidden,
        )
        truncated = len(entries) > safe_limit
        if truncated:
            entries = entries[:safe_limit]
        if directories_only:
            entries = _filter_directories(entries)
    if include_times:
        _attach_timestamps(project_id, entries, ops, extra_paths=[full_path])
    response_entries = [_entry_to_scoped_response(e, scope) for e in entries]
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "target_type": target_type,
        "directories_only": directories_only,
        "limit": safe_limit,
        "returned_count": len(response_entries),
        "complete": not truncated,
        "truncated": truncated,
        "truncation_reason": "entry_limit_exceeded" if truncated else "",
        "entries": response_entries,
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/cat", response_model=ApiResponse)
async def read_file(
    path: str = Query(..., description="File path relative to the access point scope"),
    structured: bool = Query(False, description="Parse JSON files into structured content"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    rel_path = _clean_relative(path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="File path is required")
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    try:
        content = ops.read_file(project_id, full_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {rel_path}")

    from src.mut_engine.services.tree_reader import detect_type
    node_type = detect_type(full_path)
    content_json = None
    content_text = content.decode("utf-8", errors="replace")
    if structured and node_type == "json":
        try:
            content_json = _json.loads(content_text)
            content_text = None
        except ValueError:
            pass

    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "type": node_type,
        "content": content_json,
        "content_text": content_text,
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/raw")
async def raw_file(
    path: str = Query(..., description="File path relative to the access point scope"),
    start: int = Query(0, ge=0, description="Start byte offset"),
    limit: int | None = Query(None, ge=0, description="Maximum bytes to return"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    rel_path = _clean_relative(path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="File path is required")
    _assert_not_excluded(rel_path, scope)
    start = _query_int(start, 0)
    limit = _query_optional_int(limit)

    full_path = _join_scope(scope["path"], rel_path)
    try:
        if hasattr(ops, "read_file_range"):
            blob = ops.read_file_range(
                project_id,
                full_path,
                start=start,
                limit=limit,
            )
            chunk = blob.content
            total = blob.total_size
        else:
            content = ops.read_file(project_id, full_path)
            total = len(content)
            end = total if limit is None else min(total, start + limit)
            chunk = content[start:end]
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {rel_path}")

    headers = {
        "Content-Length": str(len(chunk)),
        "Accept-Ranges": "bytes",
        "X-Puppyone-Path": rel_path,
        "X-Puppyone-Size": str(total),
    }
    if start or limit is not None:
        if chunk:
            range_end = start + len(chunk) - 1
            headers["Content-Range"] = f"bytes {start}-{range_end}/{total}"
        else:
            headers["Content-Range"] = f"bytes */{total}"

    return Response(
        content=chunk,
        media_type="application/octet-stream",
        headers=headers,
    )


@router.post("/upload", response_model=ApiResponse)
async def upload_file(
    request: Request,
    path: str = Query(..., description="Destination path relative to the access point scope"),
    base_commit_id: str | None = Query(None, description="Expected current scope head"),
    message: str = Query("", description="Commit message"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_path = _clean_relative(path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="File path is required")
    _assert_not_excluded(rel_path, scope)

    content = await request.body()
    validate_content_size(content)
    full_path = _join_scope(scope["path"], rel_path)
    try:
        result = await ops.write_file(
            project_id,
            rel_path,
            content,
            who=_operator(auth),
            scope=scope["path"],
            message=message or f"ap upload {rel_path}",
            base_commit_id=base_commit_id,
        )
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "size_bytes": len(content),
    })


@router.get("/stat", response_model=ApiResponse)
async def stat(
    path: str = Query("", description="Path relative to the access point scope"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    head_commit_id = ops.get_head_commit_id(project_id)
    scope_head_commit_id = ops.get_scope_head_commit_id(project_id, scope["path"])
    entry = ops.stat(project_id, full_path, include_size=True)
    if not entry:
        return ApiResponse.success(data={
            "path": rel_path,
            "mut_path": full_path,
            "scope": _scope_payload(scope),
            "exists": False,
            "type": "",
            "name": "",
            "head_commit_id": head_commit_id,
            "scope_head_commit_id": scope_head_commit_id,
        })
    _attach_timestamps(project_id, [entry], ops, extra_paths=[full_path])
    data = _entry_to_scoped_response(entry, scope)
    data["exists"] = True
    data["scope"] = _scope_payload(scope)
    data["head_commit_id"] = head_commit_id
    data["scope_head_commit_id"] = scope_head_commit_id
    data["metadata_source"] = "mut_tree"
    data["timestamp_source"] = "mut_history"
    data["compatibility"] = {
        "mode": "pseudo",
        "uid": "pseudo",
        "gid": "pseudo",
        "device": "not_modeled",
        "inode": "not_modeled",
        "links": "pseudo",
    }
    return ApiResponse.success(data=data)


@router.post("/write", response_model=ApiResponse)
async def write_file(
    body: WriteFileRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_path = _clean_relative(body.path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="File path is required")
    _assert_not_excluded(rel_path, scope)

    stored_rel_path, content_bytes = _serialize_content(rel_path, body.content, body.node_type)
    validate_content_size(content_bytes)

    full_path = _join_scope(scope["path"], stored_rel_path)
    try:
        result = await ops.write_file(
            project_id,
            stored_rel_path,
            content_bytes,
            who=_operator(auth),
            scope=scope["path"],
            message=body.message or f"ap write {stored_rel_path}",
            base_commit_id=body.base_commit_id,
        )
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ApiResponse.success(data={
        "path": stored_rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "merged": False,
        "conflicts": 0,
    })


@router.post("/mkdir", response_model=ApiResponse)
async def mkdir(
    body: MkdirRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_path = _clean_relative(body.path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="Directory path is required")
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    existing = ops.stat(project_id, full_path)
    if existing is not None:
        if existing.type == "folder" and body.parents:
            return ApiResponse.success(data={
                "path": rel_path,
                "mut_path": full_path,
                "scope": _scope_payload(scope),
                "commit_id": "",
                "created": False,
            })
        raise HTTPException(status_code=400, detail=f"File exists: {rel_path}")

    parent_rel = _dirname(rel_path)
    if parent_rel and not body.parents:
        parent_full = _join_scope(scope["path"], parent_rel)
        parent = ops.stat(project_id, parent_full)
        if parent is None:
            raise HTTPException(status_code=404, detail=f"No such file or directory: {parent_rel}")
        if parent.type != "folder":
            raise HTTPException(status_code=400, detail=f"Not a directory: {parent_rel}")

    try:
        result = await ops.mkdir(
            project_id,
            rel_path,
            who=_operator(auth),
            scope=scope["path"],
            message=f"ap mkdir {rel_path}",
            base_commit_id=body.base_commit_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
    })


@router.post("/touch", response_model=ApiResponse)
async def touch(
    body: TouchRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_paths = [_clean_relative(p) for p in (body.paths or [body.path])]
    rel_paths = [p for p in rel_paths if p]
    if not rel_paths:
        raise HTTPException(status_code=400, detail="File path is required")

    existing_files: list[str] = []
    missing_files: list[str] = []
    for rel_path in rel_paths:
        _assert_not_excluded(rel_path, scope)
        full_path = _join_scope(scope["path"], rel_path)
        existing = ops.stat(project_id, full_path)
        if existing is not None:
            if existing.type == "folder":
                raise HTTPException(status_code=400, detail=f"Is a directory: {rel_path}")
            existing_files.append(rel_path)
        else:
            missing_files.append(rel_path)

    results_by_path: dict[str, dict] = {}
    base_used = False
    if existing_files:
        try:
            result = await ops.touch(
                project_id,
                existing_files,
                who=_operator(auth),
                scope=scope["path"],
                message=(
                    f"ap touch {existing_files[0]}"
                    if len(existing_files) == 1
                    else f"ap touch {len(existing_files)} files"
                ),
                base_commit_id=body.base_commit_id,
            )
            base_used = True
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except ConcurrentMutationError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        for rel_path in existing_files:
            results_by_path[rel_path] = {
                "path": rel_path,
                "mut_path": _join_scope(scope["path"], rel_path),
                "commit_id": result.commit_id,
                "created": False,
                "touched": True,
            }

    for index, rel_path in enumerate(missing_files):
        full_path = _join_scope(scope["path"], rel_path)
        try:
            result = await ops.write_file(
                project_id,
                rel_path,
                b"",
                who=_operator(auth),
                scope=scope["path"],
                message=f"ap touch {rel_path}",
                base_commit_id=body.base_commit_id if index == 0 and not base_used else None,
            )
        except ConcurrentMutationError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        results_by_path[rel_path] = {
            "path": rel_path,
            "mut_path": full_path,
            "commit_id": result.commit_id,
            "created": True,
            "touched": True,
        }

    results = [results_by_path[p] for p in rel_paths]

    data = {
        "paths": rel_paths,
        "results": results,
        "scope": _scope_payload(scope),
    }
    if len(results) == 1:
        data.update(results[0])
    return ApiResponse.success(data=data)


@router.post("/mv", response_model=ApiResponse)
async def move(
    body: MoveRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    old_rel = _clean_relative(body.old_path)
    new_rel = _clean_relative(body.new_path)
    if not old_rel or not new_rel:
        raise HTTPException(status_code=400, detail="Both old_path and new_path are required")
    _assert_not_excluded(old_rel, scope)
    _assert_not_excluded(new_rel, scope)

    old_full = _join_scope(scope["path"], old_rel)
    old_entry = ops.stat(project_id, old_full)
    if old_entry is None:
        raise HTTPException(status_code=404, detail=f"Path not found: {old_rel}")

    new_full = _join_scope(scope["path"], new_rel)
    new_entry = ops.stat(project_id, new_full)
    if new_entry and new_entry.type == "folder":
        new_rel = f"{new_rel.rstrip('/')}/{_basename(old_rel)}"
        _assert_not_excluded(new_rel, scope)
        new_full = _join_scope(scope["path"], new_rel)
        new_entry = ops.stat(project_id, new_full)

    if new_entry is not None:
        if body.no_clobber:
            return ApiResponse.success(data={
                "old_path": old_rel,
                "new_path": new_rel,
                "old_mut_path": old_full,
                "new_mut_path": new_full,
                "scope": _scope_payload(scope),
                "commit_id": "",
                "skipped": True,
                "reason": "destination exists",
            })
        if new_entry.type == "folder" and old_entry.type != "folder":
            raise HTTPException(status_code=400, detail=f"Is a directory: {new_rel}")
        if new_entry.type != "folder" and old_entry.type == "folder":
            raise HTTPException(status_code=400, detail=f"Not a directory: {new_rel}")

    try:
        result = await ops.move(
            project_id,
            old_rel,
            new_rel,
            who=_operator(auth),
            scope=scope["path"],
            message=body.message or f"ap move {old_rel} -> {new_rel}",
            base_commit_id=body.base_commit_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    return ApiResponse.success(data={
        "old_path": old_rel,
        "new_path": new_rel,
        "old_mut_path": old_full,
        "new_mut_path": new_full,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "skipped": False,
    })


@router.post("/cp", response_model=ApiResponse)
async def copy(
    body: CopyRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    old_rel = _clean_relative(body.old_path)
    new_rel = _clean_relative(body.new_path)
    if not old_rel or not new_rel:
        raise HTTPException(status_code=400, detail="Both old_path and new_path are required")
    _assert_not_excluded(old_rel, scope)
    _assert_not_excluded(new_rel, scope)

    old_full = _join_scope(scope["path"], old_rel)
    old_entry = ops.stat(project_id, old_full)
    if old_entry is None:
        raise HTTPException(status_code=404, detail=f"Path not found: {old_rel}")
    if old_entry.type == "folder" and not body.recursive:
        raise HTTPException(status_code=400, detail=f"Is a directory: {old_rel}")

    new_full = _join_scope(scope["path"], new_rel)
    new_entry = ops.stat(project_id, new_full)
    if new_entry and new_entry.type == "folder":
        new_rel = f"{new_rel.rstrip('/')}/{_basename(old_rel)}"
        _assert_not_excluded(new_rel, scope)
        new_full = _join_scope(scope["path"], new_rel)
        new_entry = ops.stat(project_id, new_full)

    if new_entry is not None:
        if body.no_clobber:
            return ApiResponse.success(data={
                "old_path": old_rel,
                "new_path": new_rel,
                "old_mut_path": old_full,
                "new_mut_path": new_full,
                "scope": _scope_payload(scope),
                "commit_id": "",
                "skipped": True,
                "reason": "destination exists",
            })
        if new_entry.type == "folder" and old_entry.type != "folder":
            raise HTTPException(status_code=400, detail=f"Is a directory: {new_rel}")
        if new_entry.type != "folder" and old_entry.type == "folder":
            raise HTTPException(status_code=400, detail=f"Not a directory: {new_rel}")

    try:
        result = await ops.copy(
            project_id,
            old_rel,
            new_rel,
            who=_operator(auth),
            scope=scope["path"],
            message=body.message or f"ap copy {old_rel} -> {new_rel}",
            base_commit_id=body.base_commit_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    return ApiResponse.success(data={
        "old_path": old_rel,
        "new_path": new_rel,
        "old_mut_path": old_full,
        "new_mut_path": new_full,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "skipped": False,
    })


@router.post("/rmdir", response_model=ApiResponse)
async def rmdir(
    body: RmdirRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_paths = [_clean_relative(p) for p in (body.paths or [body.path])]
    rel_paths = [p for p in rel_paths if p]
    if not rel_paths:
        raise HTTPException(status_code=400, detail="Cannot remove the access point root")

    remove_paths: list[str] = []
    seen: set[str] = set()
    for rel_path in rel_paths:
        _assert_not_excluded(rel_path, scope)
        for candidate in _rmdir_chain(
            project_id,
            rel_path,
            scope,
            ops,
            parents=body.parents,
        ):
            if candidate not in seen:
                remove_paths.append(candidate)
                seen.add(candidate)

    try:
        result = await ops.delete(
            project_id,
            remove_paths,
            who=_operator(auth),
            scope=scope["path"],
            message=(
                f"ap rmdir {remove_paths[0]}"
                if len(remove_paths) == 1
                else f"ap rmdir {len(remove_paths)} directories"
            ),
            base_commit_id=body.base_commit_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    data = {
        "paths": rel_paths,
        "removed_paths": remove_paths,
        "mut_paths": [_join_scope(scope["path"], p) for p in remove_paths],
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "removed": True,
    }
    if len(rel_paths) == 1:
        data["path"] = rel_paths[0]
        data["mut_path"] = _join_scope(scope["path"], rel_paths[0])
    return ApiResponse.success(data=data)


@router.post("/rm", response_model=ApiResponse)
async def remove(
    body: RemoveRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    _ensure_writable(scope)
    rel_paths = [_clean_relative(p) for p in (body.paths or [body.path])]
    rel_paths = [p for p in rel_paths if p]
    if not rel_paths:
        raise HTTPException(status_code=400, detail="Cannot remove the access point root")

    existing_paths: list[str] = []
    missing_paths: list[str] = []
    for rel_path in rel_paths:
        _assert_not_excluded(rel_path, scope)
        full_path = _join_scope(scope["path"], rel_path)
        entry = ops.stat(project_id, full_path)
        if entry is None:
            missing_paths.append(rel_path)
            continue
        if entry.type == "folder" and not body.recursive:
            raise HTTPException(status_code=400, detail=f"Is a directory: {rel_path}")
        existing_paths.append(rel_path)

    if missing_paths and not body.force:
        raise HTTPException(status_code=404, detail=f"Path not found: {missing_paths[0]}")
    if not existing_paths:
        data = {
            "paths": rel_paths,
            "mut_paths": [_join_scope(scope["path"], p) for p in rel_paths],
            "scope": _scope_payload(scope),
            "commit_id": "",
            "removed": False,
        }
        if len(rel_paths) == 1:
            data["path"] = rel_paths[0]
            data["mut_path"] = _join_scope(scope["path"], rel_paths[0])
        return ApiResponse.success(data=data)

    try:
        result = await ops.delete(
            project_id,
            existing_paths,
            who=_operator(auth),
            scope=scope["path"],
            message=(
                f"ap delete {existing_paths[0]}"
                if len(existing_paths) == 1
                else f"ap delete {len(existing_paths)} paths"
            ),
            base_commit_id=body.base_commit_id,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ConcurrentMutationError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    data = {
        "paths": existing_paths,
        "mut_paths": [_join_scope(scope["path"], p) for p in existing_paths],
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
        "removed": True,
    }
    if len(existing_paths) == 1:
        data["path"] = existing_paths[0]
        data["mut_path"] = _join_scope(scope["path"], existing_paths[0])
    return ApiResponse.success(data=data)
