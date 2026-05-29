"""Build structural L5 deltas from Git trees and flat file maps."""

from __future__ import annotations

from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine import tree as tree_mod
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_delta.models import (
    EntryKind,
    TreeChange,
    TreeDelta,
)

_GIT_TYPE_TO_KIND = {
    "B": "blob",
    "T": "tree",
}


def build_tree_delta(
    store: ObjectStore,
    old_tree: str,
    new_tree: str,
    prefix: str = "",
) -> TreeDelta:
    """Compare two Git trees and return their structural delta."""

    if old_tree == new_tree:
        return TreeDelta()
    changes: list[TreeChange] = []
    _diff_tree_recursive(store, old_tree, new_tree, normalize_path(prefix), changes)
    return TreeDelta(tuple(changes))


def build_file_map_delta(
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
    prefix: str = "",
) -> TreeDelta:
    """Compare two flat ``{path: bytes}`` maps as blob-only changes."""

    prefix_norm = normalize_path(prefix)
    changes: list[TreeChange] = []
    for rel_path, new_data in sorted(new_files.items()):
        path = _join(prefix_norm, rel_path)
        if rel_path not in old_files:
            changes.append(TreeChange(path=path, action="add", new_type="blob"))
        elif old_files[rel_path] != new_data:
            changes.append(
                TreeChange(path=path, action="update", old_type="blob", new_type="blob"),
            )
    for rel_path in sorted(old_files):
        if rel_path not in new_files:
            changes.append(
                TreeChange(path=_join(prefix_norm, rel_path), action="delete", old_type="blob"),
            )
    return TreeDelta(tuple(changes))


def build_manifest_delta(old: dict, new: dict, prefix: str = "") -> TreeDelta:
    """Compare two path->hash manifests as blob-like structural changes."""

    prefix_norm = normalize_path(prefix)
    changes: list[TreeChange] = []
    for rel_path in sorted(set(old) | set(new)):
        path = _join(prefix_norm, rel_path)
        if rel_path not in old:
            changes.append(TreeChange(path=path, action="add", new_type="blob", new_oid=new[rel_path]))
        elif rel_path not in new:
            changes.append(
                TreeChange(path=path, action="delete", old_type="blob", old_oid=old[rel_path]),
            )
        elif old[rel_path] != new[rel_path]:
            changes.append(
                TreeChange(
                    path=path,
                    action="update",
                    old_type="blob",
                    new_type="blob",
                    old_oid=old[rel_path],
                    new_oid=new[rel_path],
                ),
            )
    return TreeDelta(tuple(changes))


def _diff_tree_recursive(
    store: ObjectStore,
    old_tree: str,
    new_tree: str,
    prefix: str,
    out: list[TreeChange],
) -> None:
    if old_tree == new_tree:
        return
    left = _read_tree_or_empty(store, old_tree)
    right = _read_tree_or_empty(store, new_tree)
    for name in sorted(set(left) | set(right)):
        path = _join(prefix, name)
        old_entry = left.get(name)
        new_entry = right.get(name)
        if old_entry is None:
            new_type, new_oid = new_entry
            out.append(
                TreeChange(
                    path=path,
                    action="add",
                    new_type=_entry_kind(new_type),
                    new_oid=new_oid,
                ),
            )
        elif new_entry is None:
            old_type, old_oid = old_entry
            out.append(
                TreeChange(
                    path=path,
                    action="delete",
                    old_type=_entry_kind(old_type),
                    old_oid=old_oid,
                ),
            )
        elif old_entry[1] != new_entry[1]:
            old_type, old_oid = old_entry
            new_type, new_oid = new_entry
            if old_type == "T" and new_type == "T":
                _diff_tree_recursive(store, old_oid, new_oid, path, out)
            else:
                out.append(
                    TreeChange(
                        path=path,
                        action="update",
                        old_type=_entry_kind(old_type),
                        new_type=_entry_kind(new_type),
                        old_oid=old_oid,
                        new_oid=new_oid,
                    ),
                )


def _read_tree_or_empty(store: ObjectStore, tree_hash: str) -> dict:
    if not tree_hash:
        return {}
    return tree_mod.read_tree(store, tree_hash)


def _entry_kind(git_type: str) -> EntryKind:
    return _GIT_TYPE_TO_KIND[git_type]


def _join(prefix: str, rel_path: str) -> str:
    rel = normalize_path(rel_path)
    if not prefix:
        return rel
    if not rel:
        return prefix
    return f"{prefix}/{rel}"
