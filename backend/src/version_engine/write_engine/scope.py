"""Scope permission checks owned by PuppyOne."""

from __future__ import annotations

from src.version_engine.write_engine.path_utils import normalize_path


def _resolve_path(path: str) -> str:
    parts: list[str] = []
    for segment in path.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            if parts:
                parts.pop()
        else:
            parts.append(segment)
    return "/".join(parts)


def check_path_permission(scope: dict, file_path: str, action: str = "read") -> bool:
    scope_path = normalize_path(scope["path"])
    norm_path = _resolve_path(normalize_path(file_path))

    if scope_path and not (norm_path == scope_path or norm_path.startswith(scope_path + "/")):
        return False

    for excluded in scope.get("exclude", []):
        exc = normalize_path(excluded)
        if norm_path == exc or norm_path.startswith(exc + "/"):
            return False

    if action == "write" and scope.get("mode", "r") == "r":
        return False

    return True
