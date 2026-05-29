"""Projection helpers for L5 TreeDelta."""

from __future__ import annotations

from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_delta.builder import build_file_map_delta
from src.version_engine.write_engine.tree_delta.models import TreeDelta


def paths_from_tree_delta(delta: TreeDelta) -> list[str]:
    return [normalize_path(change.path) for change in delta.changes if normalize_path(change.path)]


def changed_relative_paths(
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
) -> list[str]:
    return paths_from_tree_delta(build_file_map_delta(old_files, new_files))


def changes_from_file_maps(
    scope_path: str,
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
) -> list[dict]:
    return changes_from_tree_delta(
        build_file_map_delta(old_files, new_files),
        scope_path,
    )


def changes_from_tree_delta(delta: TreeDelta, scope_path: str = "") -> list[dict]:
    scope_norm = normalize_path(scope_path)
    return [
        {
            "path": _join(scope_norm, change.path),
            "action": change.action,
        }
        for change in delta.changes
        if normalize_path(change.path)
    ]


def legacy_changes_from_tree_delta(delta: TreeDelta) -> list[dict]:
    return delta.to_legacy_changes()


def _join(scope_path: str, rel_path: str) -> str:
    rel = normalize_path(rel_path)
    if not scope_path:
        return rel
    if not rel:
        return scope_path
    return f"{scope_path}/{rel}"
