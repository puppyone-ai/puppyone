"""Directory expansion for structural tree deltas."""

from __future__ import annotations

from src.version_engine.write_engine import tree as tree_mod
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_delta.models import TreeChange, TreeDelta


def expand_directory_changes(repo, delta: TreeDelta, old_tree: str, new_tree: str) -> TreeDelta:
    """Expand added/deleted directory changes into file-level changes.

    History, audit, permission, and merge paths are file-oriented. A tree-level
    add/delete is therefore expanded to its child file paths. Empty directories
    remain represented by the directory path itself.
    """

    expanded: list[TreeChange] = []
    for change in delta.changes:
        if change.action in {"add", "delete"} and _changed_entry_is_tree(change):
            source_tree = new_tree if change.action == "add" else old_tree
            child_changes = _expand_directory_file_changes(repo, source_tree, change)
            if child_changes:
                expanded.extend(child_changes)
                continue
        expanded.append(change)
    return TreeDelta(tuple(expanded))


def expand_tree_path_if_directory(repo, tree_hash: str, rel_path: str) -> list[str]:
    return list(_flat_directory_entries(repo, tree_hash, rel_path))


def _expand_directory_file_changes(
    repo,
    tree_hash: str,
    change: TreeChange,
) -> list[TreeChange]:
    entry = _entry_at_tree_path(repo, tree_hash, change.path)
    if not entry or entry[0] != "T":
        return []
    flat = tree_mod.tree_to_flat(repo.store, entry[1])
    if not flat:
        if change.action == "add":
            return [
                TreeChange(
                    path=normalize_path(change.path),
                    action="add",
                    new_type="tree",
                    new_oid=entry[1],
                ),
            ]
        return [
            TreeChange(
                path=normalize_path(change.path),
                action="delete",
                old_type="tree",
                old_oid=entry[1],
            ),
        ]
    rel_norm = normalize_path(change.path)
    entries = {
        f"{rel_norm}/{child}" if rel_norm else child: flat[child]
        for child in sorted(flat)
    }
    if change.action == "add":
        return [
            TreeChange(path=path, action="add", new_type="blob", new_oid=oid)
            for path, oid in entries.items()
        ]
    return [
        TreeChange(path=path, action="delete", old_type="blob", old_oid=oid)
        for path, oid in entries.items()
    ]


def _flat_directory_entries(repo, tree_hash: str, rel_path: str) -> dict[str, str]:
    entry = _entry_at_tree_path(repo, tree_hash, rel_path)
    if not entry or entry[0] != "T":
        return {}
    flat = tree_mod.tree_to_flat(repo.store, entry[1])
    rel_norm = normalize_path(rel_path)
    if not flat:
        return {rel_norm: entry[1]}
    return {
        f"{rel_norm}/{child}" if rel_norm else child: flat[child]
        for child in sorted(flat)
    }


def _changed_entry_is_tree(change: TreeChange) -> bool:
    return (change.action == "add" and change.new_type == "tree") or (
        change.action == "delete" and change.old_type == "tree"
    )


def _entry_at_tree_path(repo, tree_hash: str, rel_path: str) -> tuple[str, str] | None:
    parts = [p for p in normalize_path(rel_path).split("/") if p]
    if not parts:
        return None
    current = tree_hash
    for index, part in enumerate(parts):
        try:
            entries = tree_mod.read_tree(repo.store, current)
        except Exception:
            return None
        typ, child = entries.get(part, (None, None))
        if not typ or not child:
            return None
        if index == len(parts) - 1:
            return typ, child
        if typ != "T":
            return None
        current = child
    return None
