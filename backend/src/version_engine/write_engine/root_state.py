"""Root-first state helpers for L5.

This module owns the mechanics of reading root/scope state, repairing legacy
scope-only roots, and grafting an accepted scope tree back into the canonical
project root. It does not publish rows; SQL/RPC publishing remains in the
engine boundary.
"""

from __future__ import annotations

from src.version_engine.write_engine.git_object_format import EMPTY_TREE_SHA1, encode_tree
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.write_engine.tree_access import (
    blob_hash_at_tree_path,
    tree_hash_at_path,
)
from src.utils.logger import log_warning


def get_scope_state(repo, scope_path: str) -> tuple[str, str]:
    get_state = getattr(repo, "get_scope_state", None)
    if callable(get_state):
        scope_hash, head_commit_id = get_state(scope_path)
        return scope_hash or "", head_commit_id or ""
    return (
        repo.get_scope_hash(scope_path) or "",
        repo.get_scope_head_commit_id(scope_path) or "",
    )


def get_project_root_hash(repo) -> str:
    try:
        return repo.get_root_hash() or ""
    except Exception:
        return ""


def get_project_view_head(repo, project_root_hash: str = "") -> str:
    root_state = getattr(repo, "get_scope_state", None)
    if callable(root_state):
        try:
            root_hash, root_head = root_state("")
            if root_head and root_hash == project_root_hash:
                return root_head
        except Exception:
            pass
    latest = getattr(repo, "get_latest_project_view_commit_id", None)
    if callable(latest):
        try:
            commit_id = latest() or ""
            if commit_id:
                return commit_id
        except Exception:
            pass
    head = getattr(repo, "get_head_commit_id", None)
    if callable(head):
        try:
            return head() or ""
        except Exception:
            return ""
    return ""


def get_project_root_state_for_write(repo) -> tuple[str, str]:
    """Return ``(db_root_hash, usable_root_hash)`` for a root-first write."""

    db_root_hash = get_project_root_hash(repo)
    usable_root = db_root_hash
    if (
        not usable_root
        or usable_root == EMPTY_TREE_SHA1
        or not tree_exists(repo, usable_root)
    ):
        legacy_root = legacy_root_from_scope_state(repo, db_root_hash)
        if legacy_root and legacy_root != db_root_hash:
            try:
                cas_update = getattr(repo, "cas_update_root_hash", None)
                if callable(cas_update) and cas_update(db_root_hash or "", legacy_root):
                    db_root_hash = legacy_root
                    usable_root = legacy_root
                else:
                    refreshed = get_project_root_hash(repo)
                    if refreshed:
                        db_root_hash = refreshed
                        usable_root = refreshed
            except Exception as exc:
                log_warning(
                    f"[version_engine][root-first] legacy root repair failed: {exc}",
                )

    if not usable_root or not tree_exists(repo, usable_root):
        usable_root = repo.store.put_tree(encode_tree([]))
        if not db_root_hash:
            db_root_hash = ""
    return db_root_hash, usable_root


def legacy_root_from_scope_state(repo, current_root_hash: str) -> str:
    get_all = getattr(repo, "get_all_scope_hashes", None)
    if not callable(get_all):
        return ""
    try:
        scope_hashes = get_all()
    except Exception:
        return ""
    if not any(hash_value for path, hash_value in scope_hashes.items() if path):
        return ""
    try:
        from src.version_engine.derived.projection import build_root_from_scope_state

        root_hash = build_root_from_scope_state(repo, "", "")
        return root_hash if root_hash and root_hash != current_root_hash else ""
    except Exception as exc:
        log_warning(
            f"[version_engine][root-first] could not rebuild legacy root: {exc}",
        )
        return ""


def scope_tree_hash_for_write(repo, root_hash: str, scope_path: str) -> str:
    scope_norm = normalize_path(scope_path)
    scope_hash = tree_hash_at_path(repo, root_hash, scope_norm)
    if scope_hash and tree_exists(repo, scope_hash):
        return scope_hash
    legacy_scope_hash, _head = get_scope_state(repo, scope_norm)
    if (
        legacy_scope_hash
        and tree_exists(repo, legacy_scope_hash)
        and (not root_hash or root_hash == EMPTY_TREE_SHA1)
    ):
        return legacy_scope_hash
    return repo.store.put_tree(encode_tree([]))


def graft_scope_tree(repo, base_root_hash: str, scope_path: str, scope_hash: str) -> str:
    if not normalize_path(scope_path):
        return scope_hash
    from src.version_engine.derived.projection import graft_subtree

    root_hash = base_root_hash if base_root_hash and tree_exists(repo, base_root_hash) else ""
    if not root_hash:
        root_hash = repo.store.put_tree(encode_tree([]))
    return graft_subtree(repo.store, root_hash, scope_path, scope_hash)


def tree_exists(repo, tree_hash: str) -> bool:
    if not tree_hash:
        return False
    try:
        obj_type, _body = repo.store.get_object(tree_hash)
        return obj_type == "tree"
    except Exception:
        return False


def parent_scope_files(
    repo,
    scope_path: str,
    relative_paths: list[str],
) -> dict[str, bytes]:
    """Return files owned by the nearest ancestor scope for merge policy."""

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return {}
    parents = list(ancestor_scope_paths(repo, scope_norm))
    if not parents:
        return {}
    relevant: set[str] = set(relative_paths or [])
    if not relevant:
        return {}

    parent_files: dict[str, bytes] = {}
    root_hash = get_project_root_hash(repo)
    for parent_scope in parents:
        parent_scope_hash = tree_hash_at_path(repo, root_hash, parent_scope)
        if not parent_scope_hash:
            try:
                parent_scope_hash, _ = get_scope_state(repo, parent_scope)
            except Exception:
                parent_scope_hash = ""
        if not parent_scope_hash:
            continue
        prefix = scope_norm[len(parent_scope):].lstrip("/") if parent_scope else scope_norm
        for rel in relevant:
            if rel in parent_files:
                continue
            lookup = f"{prefix}/{rel}" if prefix else rel
            blob_hash = blob_hash_at_tree_path(repo, parent_scope_hash, lookup)
            if blob_hash:
                try:
                    parent_files[rel] = repo.store.get(blob_hash)
                except Exception:
                    continue
        if len(parent_files) == len(relevant):
            break
    return parent_files


def ancestor_scope_paths(repo, scope_path: str) -> list[str]:
    """Return ancestor scope paths, nearest first."""

    scope_norm = normalize_path(scope_path)
    if not scope_norm:
        return []
    declared: set[str] = set()
    try:
        all_scopes = repo.get_all_scope_hashes()
        declared = {normalize_path(p) for p in all_scopes.keys()}
    except Exception:
        declared = set()
    ancestors: list[str] = []
    parts = scope_norm.split("/")
    for i in range(len(parts) - 1, 0, -1):
        ancestor = "/".join(parts[:i])
        if not declared or ancestor in declared:
            ancestors.append(ancestor)
    if not declared or "" in declared:
        ancestors.append("")
    return ancestors
