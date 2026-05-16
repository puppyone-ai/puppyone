"""Git tree helpers for scoped transaction decisions."""

from __future__ import annotations

from src.mut_engine.infrastructure import tree as tree_mod
from src.mut_engine.infrastructure.git_format import MODE_DIR, MODE_FILE, TreeEntry, encode_tree
from src.mut_engine.infrastructure.paths import normalize_path


def flatten_tree_to_bytes(store, tree_hash: str) -> dict[str, bytes]:
    """Return ``{path: blob_bytes}`` for every file in a Git tree."""

    if not tree_hash:
        return {}
    flat_hashes = tree_mod.tree_to_flat(store, tree_hash)
    return {path: store.get(blob_hash) for path, blob_hash in flat_hashes.items()}


def build_tree_from_files(store, files: dict[str, bytes]) -> str:
    """Build a Git tree object from a flat ``{path: bytes}`` mapping."""

    nested: dict = {}
    for path, content in files.items():
        clean = normalize_path(path)
        if not clean:
            continue
        parts = [part for part in clean.split("/") if part]
        node = nested
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = ("B", store.put_blob(content))
    return _write_nested_tree(store, nested)


def compute_changeset(
    scope_path: str,
    old_files: dict[str, bytes],
    new_files: dict[str, bytes],
) -> list[dict]:
    """Compute full project-root history changes for a scoped file map."""

    scope_prefix = normalize_path(scope_path)
    changes: list[dict] = []
    for rel_path, new_data in sorted(new_files.items()):
        full = join_scope_path(scope_prefix, rel_path)
        if rel_path not in old_files:
            changes.append({"path": full, "action": "add"})
        elif old_files[rel_path] != new_data:
            changes.append({"path": full, "action": "update"})
    for rel_path in sorted(old_files):
        if rel_path not in new_files:
            changes.append({
                "path": join_scope_path(scope_prefix, rel_path),
                "action": "delete",
            })
    return changes


def build_full_changes(
    scope_path: str,
    changes: list[tuple[str, str]],
) -> list[dict]:
    """Convert splice ``(action, rel_path)`` tuples to history rows."""

    scope_norm = normalize_path(scope_path)
    out: list[dict] = []
    for action, rel in changes:
        out.append({"path": join_scope_path(scope_norm, rel), "action": action})
    return out


def join_scope_path(scope_path: str, rel_path: str) -> str:
    scope = normalize_path(scope_path)
    rel = normalize_path(rel_path)
    if not scope:
        return rel
    if not rel:
        return scope
    return f"{scope}/{rel}"


def scope_owner_for_path(scope_paths: list[str], full_path: str) -> str:
    """Return the deepest scope path that owns ``full_path``."""

    clean = normalize_path(full_path)
    owner = ""
    for scope_path in scope_paths:
        scope = normalize_path(scope_path)
        if not scope:
            continue
        if clean == scope or clean.startswith(scope + "/"):
            if len(scope) > len(owner):
                owner = scope
    return owner


def known_scope_paths(repo) -> list[str]:
    """Best-effort list of scope paths known by definitions or state."""

    paths = {""}
    try:
        paths.update((p or "").strip("/") for p in repo.get_all_scope_hashes().keys())
    except Exception:
        pass
    try:
        for scope in repo.scopes.list_all():
            paths.add(normalize_path(scope.get("path", "")))
    except Exception:
        pass
    return sorted(paths)


def validate_scope_bound_files(
    repo,
    scope_path: str,
    rel_paths: list[str],
    scope_excludes: list[str] | None = None,
) -> list[str]:
    """Return full paths that are outside scope ownership or excluded."""

    scope_norm = normalize_path(scope_path)
    scopes = known_scope_paths(repo)
    excludes = [normalize_path(path) for path in (scope_excludes or [])]
    rejected: list[str] = []
    for rel_path in rel_paths:
        full_path = join_scope_path(scope_norm, rel_path)
        owner = scope_owner_for_path(scopes, full_path)
        if owner != scope_norm or is_path_excluded(full_path, excludes):
            rejected.append(full_path)
    return rejected


def is_path_excluded(full_path: str, excludes: list[str]) -> bool:
    clean = normalize_path(full_path)
    for excluded in excludes:
        exc = normalize_path(excluded)
        if not exc:
            continue
        if clean == exc or clean.startswith(exc + "/"):
            return True
    return False


def _write_nested_tree(store, node: dict) -> str:
    entries: list[TreeEntry] = []
    for name, val in sorted(node.items()):
        if isinstance(val, tuple):
            kind, sub_hash = val
            entries.append(TreeEntry(
                name=name,
                mode=MODE_FILE if kind == "B" else MODE_DIR,
                sha1_hex=sub_hash,
            ))
        else:
            sub_hash = _write_nested_tree(store, val)
            entries.append(TreeEntry(name=name, mode=MODE_DIR, sha1_hex=sub_hash))
    return store.put_tree(encode_tree(entries))
