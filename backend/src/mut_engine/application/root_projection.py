"""DB-authoritative root projection and scope subtree grafting.

This module preserves the mature MUT subtree-graft design while making it an
explicit application-layer primitive for Git-native writes too. Scope heads are
the source of truth; the materialized project root is a projection rebuilt from
that registry.
"""

from __future__ import annotations

from src.mut_engine.infrastructure.git_format import (
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    decode_tree,
    encode_tree,
)


def build_root_from_scope_state(
    repo,
    just_pushed_scope: str,
    just_pushed_hash: str,
) -> str:
    """Build a complete root tree from DB scope state + the just-pushed hash.

    The algorithm deliberately reads ``mut_scope_state`` rather than the
    previous materialized root. That keeps the registry authoritative and avoids
    data loss from partial object-store reads during concurrent scope pushes.
    """

    scopes = repo.get_all_scope_hashes()
    if just_pushed_hash:
        scopes[just_pushed_scope] = just_pushed_hash

    root_scope_hash = scopes.get("", "")
    if root_scope_hash:
        current_root = root_scope_hash
    else:
        # Empty git tree: same canonical SHA-1 as ``git mktree </dev/null``.
        current_root = repo.store.put_tree(encode_tree([]))

    other_scopes = sorted(
        ((path, scope_hash) for path, scope_hash in scopes.items() if path and scope_hash),
        key=lambda item: (item[0].count("/"), item[0]),
    )

    for scope_path, scope_hash in other_scopes:
        current_root = graft_subtree(repo.store, current_root, scope_path, scope_hash)

    return current_root


def graft_subtree(store, old_root_hash: str, scope_path: str, new_subtree_hash: str) -> str:
    """Replace the subtree at ``scope_path`` under ``old_root_hash``.

    This is pure Git tree manipulation against the ObjectStore API. It is shared
    by MUT-native writes, Git-native pushes, and tests that assert scope history
    grafting remains intact.
    """

    if not scope_path:
        return new_subtree_hash
    parts = [part for part in scope_path.strip("/").split("/") if part]
    return _graft_recursive(store, old_root_hash, parts, new_subtree_hash)


def _graft_recursive(store, tree_hash: str, path_parts: list[str], new_hash: str) -> str:
    obj_type, content = store.get_object(tree_hash)
    if obj_type != "tree":
        raise ValueError(
            f"_graft_recursive: object {tree_hash} is a {obj_type}, expected tree"
        )

    entries = list(decode_tree(content))
    target = path_parts[0]
    remaining = path_parts[1:]

    existing = next((entry for entry in entries if entry.name == target), None)
    if existing is None:
        if remaining:
            empty_tree_hash = store.put_tree(encode_tree([]))
            child_hash = _graft_recursive(store, empty_tree_hash, remaining, new_hash)
        else:
            child_hash = new_hash
    elif remaining:
        if not existing.is_dir:
            empty_tree_hash = store.put_tree(encode_tree([]))
            child_hash = _graft_recursive(store, empty_tree_hash, remaining, new_hash)
        else:
            child_hash = _graft_recursive(store, existing.sha1_hex, remaining, new_hash)
    else:
        child_hash = new_hash

    new_entries = [entry for entry in entries if entry.name != target]
    new_entries.append(TreeEntry(
        name=target,
        mode=MODE_FILE if (
            existing is not None
            and not existing.is_dir
            and not remaining
            # Re-using the leaf's mode only matters when we replace a leaf with
            # another leaf hash; scope grafts produce directory trees.
            and False
        ) else MODE_DIR,
        sha1_hex=child_hash,
    ))
    return store.put_tree(encode_tree(new_entries))
