"""Tree lookup, diff, and sparse-merge helpers for L5.

These functions are below intent handling and above physical storage. They work
with Git object trees and byte maps, but they do not decide permissions,
protocol semantics, or publish authority.
"""

from __future__ import annotations

from src.version_engine.adapters.product.tree_patch import splice_batch
from src.version_engine.write_engine.diff import diff_trees
from src.version_engine.write_engine.git_commit import commit_tree_id
from src.version_engine.write_engine.git_object_format import encode_tree
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_objects import (
    flatten_tree_to_bytes,
    join_scope_path,
)


def scope_files_for_head(repo, scope_path: str, scope_hash: str) -> dict[str, bytes]:
    if scope_hash:
        return flatten_tree_to_bytes(repo.store, scope_hash)
    scope = {"id": scope_path or "_root", "path": scope_path, "exclude": [], "mode": "rw"}
    try:
        return repo.list_scope_files(scope)
    except Exception:
        return {}


def changed_relative_paths(
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
) -> list[str]:
    changed: list[str] = []
    for path in sorted(set(old_files) | set(new_files)):
        if old_files.get(path) != new_files.get(path):
            changed.append(path)
    return changed


def changed_paths_from_tree_diff(repo, old_tree: str, new_tree: str) -> list[str]:
    return [
        normalize_path(change.get("path", ""))
        for change in expanded_tree_diff(repo, old_tree, new_tree)
        if normalize_path(change.get("path", ""))
    ]


def changes_from_tree_diff(
    repo,
    scope_path: str,
    old_tree: str,
    new_tree: str,
) -> list[dict]:
    op_to_action = {
        "added": "add",
        "deleted": "delete",
        "modified": "update",
    }
    scope_norm = normalize_path(scope_path)
    changes: list[dict] = []
    for change in expanded_tree_diff(repo, old_tree, new_tree):
        rel_path = normalize_path(change.get("path", ""))
        if not rel_path:
            continue
        changes.append({
            "path": join_scope_path(scope_norm, rel_path),
            "action": op_to_action.get(change.get("op"), "update"),
        })
    return changes


def expanded_tree_diff(repo, old_tree: str, new_tree: str) -> list[dict]:
    expanded: list[dict] = []
    for change in raw_tree_diff(repo, old_tree, new_tree):
        rel_path = normalize_path(change.get("path", ""))
        op = change.get("op")
        if op in {"added", "deleted"}:
            source_tree = new_tree if op == "added" else old_tree
            child_paths = expand_tree_path_if_directory(repo, source_tree, rel_path)
            if child_paths:
                expanded.extend({"path": path, "op": op} for path in child_paths)
                continue
        expanded.append(change)
    return expanded


def expand_tree_path_if_directory(repo, tree_hash: str, rel_path: str) -> list[str]:
    entry = entry_at_tree_path(repo, tree_hash, rel_path)
    if not entry or entry[0] != "T":
        return []
    from src.version_engine.write_engine import tree as tree_mod

    flat = tree_mod.tree_to_flat(repo.store, entry[1])
    if not flat:
        return [rel_path]
    return [
        f"{rel_path}/{child}" if rel_path else child
        for child in sorted(flat)
    ]


def raw_tree_diff(repo, old_tree: str, new_tree: str) -> list[dict]:
    if old_tree == new_tree:
        return []
    if not old_tree:
        old_tree = repo.store.put_tree(encode_tree([]))
    if not new_tree:
        new_tree = repo.store.put_tree(encode_tree([]))
    return diff_trees(repo.store, old_tree, new_tree)


def tree_hash_at_commit(repo, scope_path: str, commit_id: str) -> str:
    if not commit_id:
        return ""
    entry = repo.get_history_entry(commit_id)
    if entry:
        scope_hash = entry.get("scope_hash", "")
        if scope_hash and repo.store.exists(scope_hash):
            return scope_hash
        root_hash = entry.get("root") or entry.get("root_hash", "")
        if root_hash and repo.store.exists(root_hash):
            return tree_hash_at_path(repo, root_hash, scope_path)
        return ""
    try:
        obj_type, _body = repo.store.get_object(commit_id)
        if obj_type != "commit":
            return ""
        tree_id = commit_tree_id(repo, commit_id)
        return tree_id if tree_id and repo.store.exists(tree_id) else ""
    except Exception:
        return ""


def tree_hash_at_path(repo, root_hash: str, scope_path: str) -> str:
    if not root_hash:
        return ""
    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return root_hash
    from src.version_engine.write_engine import tree as tree_mod

    current = root_hash
    for part in [p for p in scope_norm.split("/") if p]:
        try:
            entries = tree_mod.read_tree(repo.store, current)
        except Exception:
            return ""
        typ, child = entries.get(part, (None, None))
        if typ != "T" or not child:
            return ""
        current = child
    return current


def sparse_files_at_tree_paths(
    repo,
    tree_hash: str,
    paths: list[str],
) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for path in sorted({normalize_path(path) for path in paths if normalize_path(path)}):
        blob_hash = blob_hash_at_tree_path(repo, tree_hash, path)
        if blob_hash:
            files[path] = repo.store.get(blob_hash)
    return files


def blob_hash_at_tree_path(repo, tree_hash: str, rel_path: str) -> str:
    entry = entry_at_tree_path(repo, tree_hash, rel_path)
    if not entry:
        return ""
    typ, child = entry
    return child if typ == "B" else ""


def entry_at_tree_path(repo, tree_hash: str, rel_path: str) -> tuple[str, str] | None:
    if not tree_hash:
        return None
    parts = [p for p in normalize_path(rel_path).split("/") if p]
    if not parts:
        return None
    from src.version_engine.write_engine import tree as tree_mod

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


def apply_sparse_file_merge(
    repo,
    current_tree: str,
    current_files: dict[str, bytes],
    merged_files: dict[str, bytes],
    changed_paths: list[str],
) -> tuple[str, list[tuple[str, str]]]:
    ops: list[tuple] = []
    paths = sorted(
        {normalize_path(p) for p in changed_paths if normalize_path(p)}
        | set(current_files)
        | set(merged_files)
    )
    for path in paths:
        if path in merged_files:
            ops.append(("put", path, merged_files[path]))
        elif path in current_files:
            ops.append(("rm", path))
    if not ops:
        return current_tree, []
    return splice_batch(repo.store, current_tree, ops)


def files_at_commit(repo, scope_path: str, commit_id: str) -> dict[str, bytes]:
    if not commit_id:
        return {}
    tree_hash = tree_hash_at_commit(repo, scope_path, commit_id)
    if tree_hash:
        return flatten_tree_to_bytes(repo.store, tree_hash)
    entry = repo.get_history_entry(commit_id)
    if not entry:
        try:
            obj_type, _body = repo.store.get_object(commit_id)
            if obj_type != "commit":
                return {}
            tree_id = commit_tree_id(repo, commit_id)
            if not tree_id or not repo.store.exists(tree_id):
                return {}
            return flatten_tree_to_bytes(repo.store, tree_id)
        except Exception:
            return {}
    scope_hash = entry.get("scope_hash", "")
    if scope_hash and repo.store.exists(scope_hash):
        return flatten_tree_to_bytes(repo.store, scope_hash)
    root_hash = entry.get("root") or entry.get("root_hash", "")
    if not root_hash or not repo.store.exists(root_hash):
        return {}

    try:
        from src.version_engine.write_engine import tree as tree_mod

        parts = [p for p in normalize_path(scope_path).split("/") if p]
        current = root_hash
        for part in parts:
            entries = tree_mod.read_tree(repo.store, current)
            typ, child = entries.get(part, (None, None))
            if typ != "T":
                return {}
            current = child
        return flatten_tree_to_bytes(repo.store, current)
    except Exception:
        return {}


def compute_merged_changes(
    our_files: dict[str, bytes],
    merged_files: dict[str, bytes],
    their_files: dict[str, bytes],
    scope_path: str,
) -> list[dict]:
    merged_changes: list[dict] = []
    scope_prefix = normalize_path(scope_path)
    for rel_path, content in merged_files.items():
        full = f"{scope_prefix}/{rel_path}" if scope_prefix else rel_path
        if rel_path not in their_files and rel_path in our_files:
            merged_changes.append({"path": full, "action": "merged_from_server"})
        elif rel_path in their_files and rel_path in our_files:
            if content != their_files[rel_path] and content != our_files.get(rel_path):
                merged_changes.append({"path": full, "action": "content_merged"})
    return merged_changes
