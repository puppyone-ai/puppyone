"""Access Point scoped filesystem API.

This router exposes POSIX-like filesystem operations through an access point
credential. It is intentionally provider-agnostic: any access point with a
valid ``config.scope`` can use it.
"""

from __future__ import annotations

import asyncio
import fnmatch
import json as _json
import re
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
_GREP_DEFAULT_LIMIT = 1000
_GREP_MAX_LIMIT = 20000
_GREP_DEFAULT_FILE_LIMIT = 5000
_GREP_MAX_FILE_LIMIT = 50000
_GREP_DEFAULT_BYTE_LIMIT = 16 * 1024 * 1024
_GREP_MAX_BYTE_LIMIT = 256 * 1024 * 1024
_GREP_PATTERN_MAX_CHARS = 2048
_BINARY_SAMPLE_BYTES = 4096
_TEXT_MIME_EXACT = frozenset({
    "application/dart",
    "application/graphql",
    "application/javascript",
    "application/json",
    "application/sql",
    "application/toml",
    "application/typescript",
    "application/vnd.coffeescript",
    "application/x-bat",
    "application/x-csh",
    "application/x-ipynb+json",
    "application/x-ndjson",
    "application/x-php",
    "application/x-powershell",
    "application/x-sh",
    "application/x-subrip",
    "application/x-tcl",
    "application/x-tex",
    "application/xml",
    "application/yaml",
    "image/svg+xml",
})
_TEXT_BASENAMES = frozenset({
    ".babelrc",
    ".dockerignore",
    ".env",
    ".eslintrc",
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".python-version",
    ".tool-versions",
    "Dockerfile",
    "Makefile",
    "README",
})
_TEXT_BASENAMES_LOWER = frozenset(name.lower() for name in _TEXT_BASENAMES)


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


def _fs_error(
    status_code: int,
    error_code: str,
    message: str,
    *,
    path: str | None = None,
) -> HTTPException:
    detail: dict[str, Any] = {
        "error_code": error_code,
        "message": message,
    }
    if path is not None:
        detail["path"] = path
    return HTTPException(status_code=status_code, detail=detail)


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


def _query_limited_int(value: Any, default: int, maximum: int) -> int:
    return validate_limit(_query_int(value, default), default=default, maximum=maximum)


def _operator(auth: dict) -> str:
    return f"access_point:{auth.get('agent', 'unknown')}"


def _ops_stat(
    ops: MutOps,
    project_id: str,
    scope: dict,
    rel_path: str,
    *,
    include_size: bool = False,
):
    scoped = getattr(ops, "stat_in_scope", None)
    if scoped is not None:
        return scoped(
            project_id,
            scope["path"],
            rel_path,
            include_size=include_size,
        )
    return ops.stat(
        project_id,
        _join_scope(scope["path"], rel_path),
        include_size=include_size,
    )


def _ops_list_dir(
    ops: MutOps,
    project_id: str,
    scope: dict,
    rel_path: str,
    *,
    include_size: bool = False,
):
    scoped = getattr(ops, "list_dir_in_scope", None)
    if scoped is not None:
        return scoped(
            project_id,
            scope["path"],
            rel_path,
            include_size=include_size,
        )
    return ops.list_dir(
        project_id,
        _join_scope(scope["path"], rel_path),
        include_size=include_size,
    )


def _ops_list_tree(
    ops: MutOps,
    project_id: str,
    scope: dict,
    rel_path: str,
    max_depth: int,
    *,
    include_size: bool = False,
    max_entries: int | None = None,
):
    scoped = getattr(ops, "list_tree_in_scope", None)
    if scoped is not None:
        return scoped(
            project_id,
            scope["path"],
            rel_path,
            max_depth=max_depth,
            include_size=include_size,
            max_entries=max_entries,
        )
    return ops.list_tree(
        project_id,
        _join_scope(scope["path"], rel_path),
        max_depth=max_depth,
        include_size=include_size,
        max_entries=max_entries,
    )


def _ops_read_file(ops: MutOps, project_id: str, scope: dict, rel_path: str):
    scoped = getattr(ops, "read_file_in_scope", None)
    if scoped is not None:
        return scoped(project_id, scope["path"], rel_path)
    return ops.read_file(project_id, _join_scope(scope["path"], rel_path))


def _ops_read_file_range(
    ops: MutOps,
    project_id: str,
    scope: dict,
    rel_path: str,
    *,
    start: int = 0,
    limit: int | None = None,
):
    scoped = getattr(ops, "read_file_range_in_scope", None)
    if scoped is not None:
        return scoped(
            project_id,
            scope["path"],
            rel_path,
            start=start,
            limit=limit,
        )
    return ops.read_file_range(
        project_id,
        _join_scope(scope["path"], rel_path),
        start=start,
        limit=limit,
    )


def _looks_text_entry(entry) -> bool:
    if getattr(entry, "type", "") in {"json", "markdown"}:
        return True
    mime = (getattr(entry, "mime_type", "") or "").lower()
    if mime.startswith("text/"):
        return True
    if mime in _TEXT_MIME_EXACT:
        return True
    base = _basename(getattr(entry, "path", "") or getattr(entry, "name", ""))
    return base.lower() in _TEXT_BASENAMES_LOWER


def _looks_binary(content: bytes) -> bool:
    sample = content[:_BINARY_SAMPLE_BYTES]
    return b"\x00" in sample


def _decode_grep_text(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("utf-8", errors="replace")


def _split_grep_globs(value: str | None) -> list[str]:
    if not isinstance(value, str) or not value:
        return []
    return [item.strip() for item in str(value).splitlines() if item.strip()]


def _matches_grep_glob(path: str, pattern: str) -> bool:
    clean = path.strip("/")
    base = _basename(clean)
    return fnmatch.fnmatchcase(clean, pattern) or fnmatch.fnmatchcase(base, pattern)


def _matches_any_grep_glob(path: str, patterns: list[str]) -> bool:
    return any(_matches_grep_glob(path, pattern) for pattern in patterns)


def _matches_exclude_dir_glob(path: str, patterns: list[str]) -> bool:
    parts = [part for part in path.strip("/").split("/")[:-1] if part]
    return any(fnmatch.fnmatchcase(part, pattern) for part in parts for pattern in patterns)


def _grep_matcher(pattern: str, *, regex: bool, ignore_case: bool):
    if len(pattern) > _GREP_PATTERN_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"grep pattern exceeds {_GREP_PATTERN_MAX_CHARS} characters",
        )

    if regex:
        flags = re.IGNORECASE if ignore_case else 0
        try:
            compiled = re.compile(pattern, flags)
        except re.error as exc:
            raise HTTPException(status_code=400, detail=f"Invalid regex: {exc}") from exc

        def _match(line: str) -> list[tuple[int, int]]:
            spans: list[tuple[int, int]] = []
            for match in compiled.finditer(line):
                start, end = match.start(), match.end()
                if start == end:
                    continue
                spans.append((start, end))
            return spans

        return _match

    needle = pattern.casefold() if ignore_case else pattern

    def _fixed_match(line: str) -> list[tuple[int, int]]:
        if needle == "":
            return [(0, 0)]
        haystack = line.casefold() if ignore_case else line
        spans: list[tuple[int, int]] = []
        start_at = 0
        while True:
            index = haystack.find(needle, start_at)
            if index < 0:
                break
            spans.append((index, index + len(pattern)))
            start_at = index + max(len(needle), 1)
        return spans

    return _fixed_match


def _basename(path: str) -> str:
    return path.rstrip("/").rsplit("/", 1)[-1]


def _destination_child_path(directory_rel: str, old_rel: str) -> str:
    child_name = _basename(old_rel)
    clean_dir = directory_rel.rstrip("/")
    return f"{clean_dir}/{child_name}" if clean_dir else child_name


def _dirname(path: str) -> str:
    clean = path.strip("/")
    if not clean or "/" not in clean:
        return ""
    return clean.rsplit("/", 1)[0]


def _resolve_copy_move_destination(
    project_id: str,
    scope: dict,
    ops: MutOps,
    old_rel: str,
    new_rel: str,
    *,
    target_directory: bool,
    no_target_directory: bool,
) -> tuple[str, str, Any | None]:
    if target_directory and no_target_directory:
        raise HTTPException(
            status_code=400,
            detail="target_directory and no_target_directory cannot both be true",
        )

    new_full = _join_scope(scope["path"], new_rel)
    new_entry = _ops_stat(ops, project_id, scope, new_rel)

    if target_directory:
        if new_entry is None or new_entry.type != "folder":
            raise _fs_error(
                400,
                "NOT_A_DIRECTORY",
                f"Not a directory: {new_rel or '.'}",
                path=new_rel,
            )
        new_rel = _destination_child_path(new_rel, old_rel)
        _assert_not_excluded(new_rel, scope)
        new_full = _join_scope(scope["path"], new_rel)
        new_entry = _ops_stat(ops, project_id, scope, new_rel)
    elif new_entry and new_entry.type == "folder" and not no_target_directory:
        new_rel = _destination_child_path(new_rel, old_rel)
        _assert_not_excluded(new_rel, scope)
        new_full = _join_scope(scope["path"], new_rel)
        new_entry = _ops_stat(ops, project_id, scope, new_rel)

    return new_rel, new_full, new_entry


def _is_directory_empty(project_id: str, rel_path: str, scope: dict, ops: MutOps) -> bool:
    return len(_ops_list_dir(ops, project_id, scope, rel_path)) == 0


def _rmdir_chain(project_id: str, rel_path: str, scope: dict, ops: MutOps, *, parents: bool) -> list[str]:
    """Return deepest-first empty directory chain removable by rmdir."""
    entry = _ops_stat(ops, project_id, scope, rel_path)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No such file or directory: {rel_path}")
    if entry.type != "folder":
        raise HTTPException(status_code=400, detail=f"Not a directory: {rel_path}")
    if not _is_directory_empty(project_id, rel_path, scope, ops):
        raise HTTPException(status_code=400, detail=f"Directory not empty: {rel_path}")

    removable = [rel_path]
    if not parents:
        return removable

    child_rel = rel_path
    parent_rel = _dirname(rel_path)
    while parent_rel:
        _assert_not_excluded(parent_rel, scope)
        parent = _ops_stat(ops, project_id, scope, parent_rel)
        if parent is None or parent.type != "folder":
            break
        remaining = [
            e for e in _ops_list_dir(ops, project_id, scope, parent_rel)
            if e.path.strip("/") != _join_scope(scope["path"], child_rel).strip("/")
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
    target = _ops_stat(ops, project_id, scope, rel_path, include_size=include_size)
    if target is None and rel_path:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")
    target_type = target.type if target else ""
    if target and target.type != "folder":
        # POSIX ls on a file lists that file itself, not the parent directory.
        entries = [target]
    else:
        entries = _filter_entries(
            _ops_list_dir(ops, project_id, scope, rel_path, include_size=include_size), scope,
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
    target = _ops_stat(ops, project_id, scope, rel_path, include_size=include_size)
    if target is None and rel_path:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")
    target_type = target.type if target else ""
    if target and target.type != "folder":
        entries = [] if directories_only else [target]
        truncated = False
    else:
        entries = _filter_entries(
            _ops_list_tree(
                ops, project_id, scope, rel_path, max_depth=max_depth,
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


@router.get("/grep", response_model=ApiResponse)
async def grep(
    pattern: str = Query(..., description="Fixed string or regex pattern to match"),
    path: str = Query("", description="File or directory path relative to the access point scope"),
    regex: bool = Query(False, description="Treat pattern as a regular expression"),
    ignore_case: bool = Query(False, description="Case-insensitive matching"),
    invert_match: bool = Query(False, description="Select non-matching lines"),
    only_matching: bool = Query(False, description="Return only the matching text"),
    include_hidden: bool = Query(False, description="Include entries whose names begin with '.'"),
    include: str = Query("", description="Newline-separated file glob patterns to include"),
    exclude: str = Query("", description="Newline-separated file glob patterns to exclude"),
    exclude_dir: str = Query("", description="Newline-separated directory glob patterns to exclude"),
    max_depth: int = Query(-1, description="Maximum recursion depth for directories, -1 = unlimited"),
    max_count: int = Query(0, description="Maximum matching lines returned per file, 0 = unlimited"),
    before_context: int = Query(0, description="Context lines before each match"),
    after_context: int = Query(0, description="Context lines after each match"),
    include_offsets: bool = Query(False, description="Include byte offsets in match metadata"),
    limit: int = Query(_GREP_DEFAULT_LIMIT, description="Maximum matching lines returned"),
    max_files: int = Query(_GREP_DEFAULT_FILE_LIMIT, description="Maximum file candidates scanned"),
    max_bytes: int = Query(_GREP_DEFAULT_BYTE_LIMIT, description="Maximum decoded text bytes scanned"),
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
    invert_match = _query_bool(invert_match)
    only_matching = _query_bool(only_matching)
    include_offsets = _query_bool(include_offsets)
    per_file_limit = max(0, _query_int(max_count, 0))
    before_context = min(max(0, _query_int(before_context, 0)), 100)
    after_context = min(max(0, _query_int(after_context, 0)), 100)
    include_patterns = _split_grep_globs(include)
    exclude_patterns = _split_grep_globs(exclude)
    exclude_dir_patterns = _split_grep_globs(exclude_dir)
    safe_limit = _query_limited_int(limit, _GREP_DEFAULT_LIMIT, _GREP_MAX_LIMIT)
    safe_file_limit = _query_limited_int(max_files, _GREP_DEFAULT_FILE_LIMIT, _GREP_MAX_FILE_LIMIT)
    safe_byte_limit = _query_limited_int(max_bytes, _GREP_DEFAULT_BYTE_LIMIT, _GREP_MAX_BYTE_LIMIT)
    match_line = _grep_matcher(pattern, regex=regex, ignore_case=ignore_case)

    full_path = _join_scope(scope["path"], rel_path)
    target = _ops_stat(ops, project_id, scope, rel_path)
    if target is None and rel_path:
        raise HTTPException(status_code=404, detail=f"Path not found: {rel_path}")

    truncated = False
    truncation_reason = ""

    def mark_truncated(reason: str) -> None:
        nonlocal truncated, truncation_reason
        truncated = True
        if not truncation_reason:
            truncation_reason = reason

    if target and target.type != "folder":
        target_type = target.type
        candidates = [target]
    else:
        target_type = "folder"
        tree_entries = _filter_entries(
            _ops_list_tree(
                ops,
                project_id,
                scope,
                rel_path,
                max_depth=max_depth,
                include_size=False,
                max_entries=safe_file_limit + 1,
            ),
            scope,
            include_hidden=include_hidden,
        )
        if len(tree_entries) > safe_file_limit:
            mark_truncated("file_limit_exceeded")
            tree_entries = tree_entries[:safe_file_limit]
        candidates = [entry for entry in tree_entries if entry.type != "folder"]

    matches: list[dict[str, Any]] = []
    files: list[dict[str, Any]] = []
    content_cache: dict[str, bytes] = {}
    scanned_files = 0
    scanned_bytes = 0
    skipped = {
        "non_text": 0,
        "binary": 0,
        "too_large": 0,
        "read_errors": 0,
    }

    for entry in candidates:
        rel_entry_path = _relative_to_scope(entry.path, scope["path"])
        if _matches_exclude(rel_entry_path, scope.get("exclude") or []):
            continue
        if include_patterns and not _matches_any_grep_glob(rel_entry_path, include_patterns):
            continue
        if exclude_patterns and _matches_any_grep_glob(rel_entry_path, exclude_patterns):
            continue
        if exclude_dir_patterns and _matches_exclude_dir_glob(rel_entry_path, exclude_dir_patterns):
            continue
        if not _looks_text_entry(entry):
            skipped["non_text"] += 1
            continue

        content_hash = getattr(entry, "content_hash", None) or ""
        try:
            if content_hash and content_hash in content_cache:
                content = content_cache[content_hash]
            else:
                content = _ops_read_file(ops, project_id, scope, rel_entry_path)
                if content_hash:
                    content_cache[content_hash] = content
        except FileNotFoundError:
            skipped["read_errors"] += 1
            mark_truncated("read_error")
            continue
        except Exception:
            skipped["read_errors"] += 1
            mark_truncated("read_error")
            continue

        if _looks_binary(content):
            skipped["binary"] += 1
            continue
        if scanned_bytes + len(content) > safe_byte_limit:
            skipped["too_large"] += 1
            mark_truncated("byte_limit_exceeded")
            break

        scanned_files += 1
        scanned_bytes += len(content)
        text = _decode_grep_text(content)
        need_line_offsets = include_offsets or before_context > 0 or after_context > 0
        if need_line_offsets:
            raw_lines = text.splitlines(keepends=True)
            line_items: list[tuple[str, int | None]] = []
            byte_cursor = 0
            for raw_line in raw_lines:
                clean_line = raw_line.rstrip("\r\n")
                line_items.append((clean_line, byte_cursor))
                byte_cursor += len(raw_line.encode("utf-8"))
            if text and not raw_lines:
                line_items.append((text, 0))
        else:
            line_items = [(line, None) for line in text.splitlines()]

        file_match_count = 0
        for line_number, (line_text, line_byte_offset) in enumerate(line_items, start=1):
            spans = match_line(line_text)
            matched = bool(spans)
            if invert_match:
                matched = not matched
            if not matched:
                continue
            if only_matching and not invert_match and spans:
                output_spans = spans
            else:
                first_span = spans[0] if spans else (None, None)
                output_spans = [first_span]

            for match_start, match_end in output_spans:
                match_text = (
                    line_text[match_start:match_end]
                    if isinstance(match_start, int) and isinstance(match_end, int)
                    else ""
                )
                match_byte_offset = None
                if isinstance(line_byte_offset, int):
                    match_byte_offset = (
                        line_byte_offset + len(line_text[:match_start].encode("utf-8"))
                        if isinstance(match_start, int)
                        else line_byte_offset
                    )
                before_lines = []
                if before_context:
                    start_index = max(0, line_number - 1 - before_context)
                    for ctx_index in range(start_index, line_number - 1):
                        before_lines.append({
                            "line_number": ctx_index + 1,
                            "line_text": line_items[ctx_index][0],
                            "byte_offset": line_items[ctx_index][1],
                        })
                after_lines = []
                if after_context:
                    end_index = min(len(line_items), line_number + after_context)
                    for ctx_index in range(line_number, end_index):
                        after_lines.append({
                            "line_number": ctx_index + 1,
                            "line_text": line_items[ctx_index][0],
                            "byte_offset": line_items[ctx_index][1],
                        })
                matches.append({
                    "path": rel_entry_path,
                    "mut_path": _join_scope(scope["path"], rel_entry_path),
                    "line_number": line_number,
                    "line_text": line_text,
                    "match_start": match_start,
                    "match_end": match_end,
                    "match_text": match_text,
                    "byte_offset": line_byte_offset,
                    "match_byte_offset": match_byte_offset,
                    "before_context": before_lines,
                    "after_context": after_lines,
                    "content_hash": content_hash or None,
                })
                file_match_count += 1
                if len(matches) >= safe_limit:
                    mark_truncated("result_limit_exceeded")
                    break
                if per_file_limit and file_match_count >= per_file_limit:
                    break
            if truncated and truncation_reason == "result_limit_exceeded":
                break
            if per_file_limit and file_match_count >= per_file_limit:
                break
        files.append({
            "path": rel_entry_path,
            "mut_path": _join_scope(scope["path"], rel_entry_path),
            "match_count": file_match_count,
            "content_hash": content_hash or None,
        })
        if truncated and truncation_reason == "result_limit_exceeded":
            break

    scope_head_commit_id = ops.get_scope_head_commit_id(project_id, scope["path"])
    matched_files = len([item for item in files if item.get("match_count", 0) > 0])
    return ApiResponse.success(data={
        "pattern": pattern,
        "path": rel_path,
        "mut_path": full_path,
        "scope": _scope_payload(scope),
        "target_type": target_type,
        "regex": regex,
        "ignore_case": ignore_case,
        "invert_match": invert_match,
        "only_matching": only_matching,
        "include_offsets": include_offsets,
        "include": include_patterns,
        "exclude": exclude_patterns,
        "exclude_dir": exclude_dir_patterns,
        "limit": safe_limit,
        "max_count": per_file_limit,
        "before_context": before_context,
        "after_context": after_context,
        "max_files": safe_file_limit,
        "max_bytes": safe_byte_limit,
        "returned_count": len(matches),
        "matched_files": matched_files,
        "candidate_files": len(candidates),
        "scanned_files": scanned_files,
        "scanned_bytes": scanned_bytes,
        "skipped": skipped,
        "complete": not truncated,
        "truncated": truncated,
        "truncation_reason": truncation_reason,
        "files": files,
        "matches": matches,
        "head_commit_id": scope_head_commit_id,
        "scope_head_commit_id": scope_head_commit_id,
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
        content = _ops_read_file(ops, project_id, scope, rel_path)
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
        if hasattr(ops, "read_file_range_in_scope") or hasattr(ops, "read_file_range"):
            blob = _ops_read_file_range(
                ops,
                project_id,
                scope,
                rel_path,
                start=start,
                limit=limit,
            )
            chunk = blob.content
            total = blob.total_size
        else:
            content = _ops_read_file(ops, project_id, scope, rel_path)
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
            defer_projection=True,
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
    scope_head_commit_id = ops.get_scope_head_commit_id(project_id, scope["path"])
    if not rel_path:
        return ApiResponse.success(data={
            "path": "",
            "mut_path": full_path,
            "scope": _scope_payload(scope),
            "exists": True,
            "type": "folder",
            "name": _basename(scope["path"]) if scope["path"] else "",
            "content_hash": "",
            "size_bytes": 0,
            "mime_type": "inode/directory",
            "children_count": None,
            "head_commit_id": scope_head_commit_id,
            "scope_head_commit_id": scope_head_commit_id,
            "metadata_source": "scope_state",
            "timestamp_source": "scope_state",
            "compatibility": {
                "mode": "pseudo",
                "uid": "pseudo",
                "gid": "pseudo",
                "device": "not_modeled",
                "inode": "not_modeled",
                "links": "pseudo",
            },
        })

    head_commit_id = ops.get_head_commit_id(project_id)
    entry = _ops_stat(ops, project_id, scope, rel_path, include_size=True)
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
            defer_projection=True,
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
    existing = _ops_stat(ops, project_id, scope, rel_path)
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
        parent = _ops_stat(ops, project_id, scope, parent_rel)
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
            defer_projection=True,
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
        existing = _ops_stat(ops, project_id, scope, rel_path)
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
                defer_projection=True,
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
                defer_projection=True,
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
    if not old_rel:
        raise HTTPException(status_code=400, detail="Both old_path and new_path are required")
    _assert_not_excluded(old_rel, scope)
    _assert_not_excluded(new_rel, scope)

    old_full = _join_scope(scope["path"], old_rel)
    old_entry = _ops_stat(ops, project_id, scope, old_rel)
    if old_entry is None:
        raise _fs_error(404, "NOT_FOUND", f"Path not found: {old_rel}", path=old_rel)

    new_rel, new_full, new_entry = _resolve_copy_move_destination(
        project_id,
        scope,
        ops,
        old_rel,
        new_rel,
        target_directory=body.target_directory,
        no_target_directory=body.no_target_directory,
    )

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
        if body.no_target_directory and new_entry.type == "folder":
            raise _fs_error(400, "IS_DIRECTORY", f"Is a directory: {new_rel}", path=new_rel)
        if new_entry.type == "folder" and old_entry.type != "folder":
            raise _fs_error(400, "IS_DIRECTORY", f"Is a directory: {new_rel}", path=new_rel)
        if new_entry.type != "folder" and old_entry.type == "folder":
            raise _fs_error(400, "NOT_A_DIRECTORY", f"Not a directory: {new_rel}", path=new_rel)

    try:
        result = await ops.move(
            project_id,
            old_rel,
            new_rel,
            who=_operator(auth),
            scope=scope["path"],
            message=body.message or f"ap move {old_rel} -> {new_rel}",
            base_commit_id=body.base_commit_id,
            defer_projection=True,
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
    if not old_rel:
        raise HTTPException(status_code=400, detail="Both old_path and new_path are required")
    _assert_not_excluded(old_rel, scope)
    _assert_not_excluded(new_rel, scope)

    old_full = _join_scope(scope["path"], old_rel)
    old_entry = _ops_stat(ops, project_id, scope, old_rel)
    if old_entry is None:
        raise _fs_error(404, "NOT_FOUND", f"Path not found: {old_rel}", path=old_rel)
    if old_entry.type == "folder" and not body.recursive:
        raise _fs_error(400, "IS_DIRECTORY", f"Is a directory: {old_rel}", path=old_rel)

    new_rel, new_full, new_entry = _resolve_copy_move_destination(
        project_id,
        scope,
        ops,
        old_rel,
        new_rel,
        target_directory=body.target_directory,
        no_target_directory=body.no_target_directory,
    )

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
        if body.no_target_directory and new_entry.type == "folder":
            raise _fs_error(400, "IS_DIRECTORY", f"Is a directory: {new_rel}", path=new_rel)
        if new_entry.type == "folder" and old_entry.type != "folder":
            raise _fs_error(400, "IS_DIRECTORY", f"Is a directory: {new_rel}", path=new_rel)
        if new_entry.type != "folder" and old_entry.type == "folder":
            raise _fs_error(400, "NOT_A_DIRECTORY", f"Not a directory: {new_rel}", path=new_rel)

    try:
        result = await ops.copy(
            project_id,
            old_rel,
            new_rel,
            who=_operator(auth),
            scope=scope["path"],
            message=body.message or f"ap copy {old_rel} -> {new_rel}",
            base_commit_id=body.base_commit_id,
            defer_projection=True,
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
            defer_projection=True,
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
        entry = _ops_stat(ops, project_id, scope, rel_path)
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
            defer_projection=True,
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


# ── H2/H4/H5: fs_path_index-backed find + admin rebuild ──────────────


@router.get("/find", response_model=ApiResponse)
async def find_index(
    name: str = Query("", description="fnmatch-style glob over the basename"),
    path: str = Query("", description="Subpath under the scope to narrow the search"),
    mime: str = Query("", description="Optional mime-type prefix filter (e.g. 'text/')"),
    type_: str = Query(
        "any",
        alias="type",
        description="'file' or 'any'; folders aren't indexed, only blobs",
    ),
    limit: int = Query(1000, ge=1, le=20000),
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
):
    """Server-side accelerated ``puppyone fs find`` (H2).

    Queries the materialised ``fs_path_index`` instead of walking the
    Merkle tree, so large projects answer in milliseconds. Scope and
    exclude rules from the caller's access point are applied as
    SQL filters (H4) so a scoped credential never sees out-of-scope
    rows even if the index has them.

    The index is refreshed asynchronously by the outbox worker. A
    just-pushed file may take one worker tick (~30s) to appear; for
    correctness-critical callers use ``/stat`` or ``/ls`` which walk
    the live tree.
    """

    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    scope_full = _join_scope(scope["path"], _clean_relative(path)) if path else (scope["path"] or "")
    scope_full = scope_full.strip("/")

    from src.infra.supabase.client import SupabaseClient

    client = SupabaseClient().client
    builder = client.table("fs_path_index").select(
        "full_path, size_bytes, mime_type, last_who, last_commit_id, last_updated_at",
    ).eq("project_id", project_id)

    # H4 — permission filter at query time.
    if scope_full:
        # We use a LIKE-style match so paths under the scope prefix are
        # returned. The pg_trgm index lets this run cheaply.
        builder = builder.like("full_path", f"{scope_full}/%")
        # Also accept the scope path itself if it is a single file (rare).
        # The OR is expressed by the next query, merged client-side; for
        # V1 we stick with the strict prefix because file-scopes are not
        # in production yet.
    # Reject hits inside any exclude pattern. The patterns are absolute
    # paths (per the resolved convention) so we can filter on full_path
    # directly.
    for excl in scope.get("exclude") or []:
        clean = (excl or "").strip("/")
        if not clean:
            continue
        builder = builder.not_.like("full_path", f"{clean}%")

    if mime:
        builder = builder.like("mime_type", f"{mime}%")
    if type_ == "file":
        # Folder entries are not indexed; this is a no-op but lets the
        # caller request strict file semantics for symmetry with POSIX find.
        pass

    rows = (builder.limit(limit).execute()).data or []

    # Apply name-glob filter in Python (pg_trgm doesn't do fnmatch).
    if name:
        import fnmatch
        rows = [
            r for r in rows
            if fnmatch.fnmatch(_basename(r["full_path"]), name)
        ]

    # Re-shape paths to scope-relative for the caller.
    scope_prefix = (scope["path"] or "").strip("/")
    out = []
    for r in rows[:limit]:
        full = r["full_path"]
        if scope_prefix:
            if full == scope_prefix:
                rel = ""
            elif full.startswith(scope_prefix + "/"):
                rel = full[len(scope_prefix) + 1:]
            else:
                continue  # belt-and-braces: scope mismatch
        else:
            rel = full
        out.append({
            "path": rel,
            "mut_path": full,
            "size_bytes": r.get("size_bytes", 0),
            "mime_type": r.get("mime_type", ""),
            "last_who": r.get("last_who", ""),
            "last_commit_id": r.get("last_commit_id", ""),
            "last_updated_at": r.get("last_updated_at", ""),
        })
    return ApiResponse.success(data={
        "scope": _scope_payload(scope),
        "entries": out,
        "returned_count": len(out),
        "truncated": len(rows) >= limit,
        "source": "fs_path_index",
    })


@router.post("/admin/fs-index/rebuild", response_model=ApiResponse)
async def rebuild_fs_index(
    x_access_key: str | None = Header(None, alias="X-Access-Key"),
    x_mut_user: str | None = Header(None, alias="X-Mut-User"),
    x_puppy_client: str | None = Header(None, alias="X-Puppy-Client"),
    ops: MutOps = Depends(get_mut_ops),
):
    """H5: drop and rebuild ``fs_path_index`` rows for this project.

    Used after manual DB surgery, missed outbox events, or after a
    schema migration that widened the index. Requires the access point
    to be in ``rw`` mode — same gate as any write operation, so any
    misuse is captured in the standard audit flow.
    """

    project_id, _auth, scope = await _resolve_auth(x_access_key, x_mut_user, x_puppy_client)
    if str(scope.get("mode", "r")).lower() not in _WRITE_MODES:
        raise HTTPException(status_code=403, detail="rebuild requires a writable access point")

    repo = ops._repos.get_server_repo(project_id)  # noqa: SLF001 — admin path
    from src.mut_engine.services.fs_path_index import (
        rebuild_fs_path_index_for_project,
    )
    touched = await asyncio.to_thread(rebuild_fs_path_index_for_project, repo, project_id)
    return ApiResponse.success(data={
        "project_id": project_id,
        "rows_written": touched,
    })
