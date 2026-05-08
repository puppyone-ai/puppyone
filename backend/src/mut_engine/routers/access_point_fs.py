"""Access Point scoped filesystem API.

This router exposes POSIX-like filesystem operations through an access point
credential. It is intentionally provider-agnostic: any access point with a
valid ``config.scope`` can use it.
"""

from __future__ import annotations

import asyncio
import json as _json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from src.common_schemas import ApiResponse
from src.mut_engine.dependencies import get_mut_ops
from src.mut_engine.routers.access_point import resolve_access_point
from src.mut_engine.routers.content_write import _serialize_content
from src.mut_engine.schemas import MkdirRequest, MoveRequest, RemoveRequest, WriteFileRequest
from src.mut_engine.server.validation import validate_content_size, validate_path
from src.mut_engine.services.ops import MutOps


router = APIRouter(prefix="/ap-fs", tags=["access-point-fs"])

_READ_MODES = frozenset({"r", "rw", "read", "write"})
_WRITE_MODES = frozenset({"rw", "write", "w"})
_HIDDEN_PREFIXES = frozenset({".trash"})


def _normalize_access_key(x_access_key: str | None) -> str:
    key = (x_access_key or "").strip()
    if not key:
        raise HTTPException(status_code=401, detail="X-Access-Key header is required")
    return key


async def _resolve_auth(
    x_access_key: str | None,
    x_mut_user: str | None,
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
    }


def _filter_entries(entries: list, scope: dict) -> list:
    filtered = []
    excludes = list(scope.get("exclude") or []) + list(_HIDDEN_PREFIXES)
    for entry in entries:
        rel_path = _relative_to_scope(entry.path, scope["path"])
        if _matches_exclude(rel_path, excludes):
            continue
        filtered.append(entry)
    return filtered


def _scope_payload(scope: dict) -> dict:
    return {
        "path": scope["path"],
        "mode": scope["mode"],
        "exclude": scope.get("exclude") or [],
    }


def _operator(auth: dict) -> str:
    return f"access_point:{auth.get('agent', 'unknown')}"


@router.get("/ls", response_model=ApiResponse)
async def list_dir(
    path: str = Query("", description="Path relative to the access point scope"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    entries = _filter_entries(ops.list_dir(project_id, full_path), scope)
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "entries": [_entry_to_scoped_response(e, scope) for e in entries],
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/tree", response_model=ApiResponse)
async def tree(
    path: str = Query("", description="Path relative to the access point scope"),
    max_depth: int = Query(-1, description="Maximum recursion depth, -1 = unlimited"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    entries = _filter_entries(ops.list_tree(project_id, full_path, max_depth=max_depth), scope)
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "entries": [_entry_to_scoped_response(e, scope) for e in entries],
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/cat", response_model=ApiResponse)
async def read_file(
    path: str = Query(..., description="File path relative to the access point scope"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user)
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
    content_text = None
    if node_type == "json":
        try:
            content_json = _json.loads(content.decode("utf-8"))
        except ValueError:
            content_text = content.decode("utf-8", errors="replace")
    else:
        content_text = content.decode("utf-8", errors="replace")

    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "type": node_type,
        "content": content_json,
        "content_text": content_text,
        "head_commit_id": ops.get_head_commit_id(project_id),
    })


@router.get("/stat", response_model=ApiResponse)
async def stat(
    path: str = Query("", description="Path relative to the access point scope"),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    rel_path = _clean_relative(path)
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    entry = ops.stat(project_id, full_path)
    if not entry:
        return ApiResponse.success(data={
            "path": rel_path,
            "mut_path": full_path,
            "scope": _scope_payload(scope),
            "exists": False,
            "type": "",
            "name": "",
        })
    data = _entry_to_scoped_response(entry, scope)
    data["exists"] = True
    data["scope"] = _scope_payload(scope)
    return ApiResponse.success(data=data)


@router.post("/write", response_model=ApiResponse)
async def write_file(
    body: WriteFileRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    _ensure_writable(scope)
    rel_path = _clean_relative(body.path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="File path is required")
    _assert_not_excluded(rel_path, scope)

    stored_rel_path, content_bytes = _serialize_content(rel_path, body.content, body.node_type)
    validate_content_size(content_bytes)

    full_path = _join_scope(scope["path"], stored_rel_path)
    result = await ops.write_file(
        project_id,
        full_path,
        content_bytes,
        who=_operator(auth),
        message=body.message or f"ap write {stored_rel_path}",
    )
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
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    _ensure_writable(scope)
    rel_path = _clean_relative(body.path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="Directory path is required")
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    result = await ops.mkdir(
        project_id,
        full_path,
        who=_operator(auth),
        message=f"ap mkdir {rel_path}",
    )
    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
    })


@router.post("/mv", response_model=ApiResponse)
async def move(
    body: MoveRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    _ensure_writable(scope)
    old_rel = _clean_relative(body.old_path)
    new_rel = _clean_relative(body.new_path)
    if not old_rel or not new_rel:
        raise HTTPException(status_code=400, detail="Both old_path and new_path are required")
    _assert_not_excluded(old_rel, scope)
    _assert_not_excluded(new_rel, scope)

    old_full = _join_scope(scope["path"], old_rel)
    new_full = _join_scope(scope["path"], new_rel)
    if ops.stat(project_id, old_full) is None:
        raise HTTPException(status_code=404, detail=f"Path not found: {old_rel}")

    try:
        result = await ops.move(
            project_id,
            old_full,
            new_full,
            who=_operator(auth),
            message=body.message or f"ap move {old_rel} -> {new_rel}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ApiResponse.success(data={
        "old_path": old_rel,
        "new_path": new_rel,
        "old_mut_path": old_full,
        "new_mut_path": new_full,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
    })


@router.post("/rm", response_model=ApiResponse)
async def remove(
    body: RemoveRequest,
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    ops: MutOps = Depends(get_mut_ops),
):
    project_id, auth, scope = await _resolve_auth(x_access_key, x_mut_user)
    _ensure_writable(scope)
    rel_path = _clean_relative(body.path)
    if not rel_path:
        raise HTTPException(status_code=400, detail="Cannot remove the access point root")
    _assert_not_excluded(rel_path, scope)

    full_path = _join_scope(scope["path"], rel_path)
    if ops.stat(project_id, full_path) is None:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")

    if body.permanent:
        try:
            result = await ops.permanent_delete(
                project_id,
                full_path,
                who=_operator(auth),
                message=f"ap delete {rel_path}",
            )
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return ApiResponse.success(data={
            "path": rel_path,
            "mut_path": full_path,
            "scope": _scope_payload(scope),
            "commit_id": result.commit_id,
        })

    try:
        result = await ops.trash(
            project_id,
            full_path,
            who=_operator(auth),
            message=f"ap trash {rel_path}",
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # ``MutOps.trash`` returns ``paths=[original_full, trash_full]``; pick the
    # entry that actually lands in ``.trash/`` so we can report both the original
    # and the trash destination back to the CLI.
    trash_full = next(
        (p for p in result.paths if "/.trash/" in p or p.startswith(".trash/")),
        "",
    )
    new_rel = _relative_to_scope(trash_full, scope["path"]) if trash_full else ""

    return ApiResponse.success(data={
        "path": rel_path,
        "mut_path": full_path,
        "new_path": new_rel,
        "new_mut_path": trash_full,
        "scope": _scope_payload(scope),
        "commit_id": result.commit_id,
    })
