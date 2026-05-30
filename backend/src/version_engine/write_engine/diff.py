"""Git tree diff helpers owned by PuppyOne."""

from __future__ import annotations

from src.version_engine.write_engine import tree as tree_mod
from src.version_engine.storage.object_store import ObjectStore
from src.utils.logger import log_warning


def diff_trees(
    store: ObjectStore,
    h1: str,
    h2: str,
    prefix: str = "",
    *,
    tolerant: bool = False,
) -> list[dict]:
    """Diff two trees.

    When ``tolerant`` is set, a tree object that cannot be read (missing or
    corrupt) is treated as empty and logged, so a single bad object yields a
    best-effort partial diff instead of aborting the whole comparison. The
    strict default is kept for write-path callers that must surface read
    failures; the read-only commit-diff endpoint opts into tolerant mode so it
    degrades gracefully rather than returning a 500.
    """
    if h1 == h2:
        return []
    changes: list[dict] = []
    _diff_recursive(store, h1, h2, prefix, changes, tolerant)
    return changes


def _safe_read_tree(store: ObjectStore, h: str, tolerant: bool) -> dict:
    try:
        return tree_mod.read_tree(store, h)
    except Exception as exc:  # noqa: BLE001 — tolerant mode downgrades to empty
        if tolerant:
            log_warning(f"[diff] tree {h[:12]} unreadable, treating as empty: {exc}")
            return {}
        raise


def _diff_recursive(
    store: ObjectStore, h1: str, h2: str, prefix: str, out: list, tolerant: bool = False
) -> None:
    if h1 == h2:
        return
    left = _safe_read_tree(store, h1, tolerant)
    right = _safe_read_tree(store, h2, tolerant)
    for name in sorted(set(left) | set(right)):
        path = f"{prefix}/{name}" if prefix else name
        a = left.get(name)
        b = right.get(name)
        if a is None:
            out.append({"path": path, "op": "added"})
        elif b is None:
            out.append({"path": path, "op": "deleted"})
        elif a[1] != b[1]:
            if a[0] == "T" and b[0] == "T":
                _diff_recursive(store, a[1], b[1], path, out, tolerant)
            else:
                out.append({"path": path, "op": "modified"})


def diff_manifests(old: dict, new: dict) -> list[dict]:
    changes: list[dict] = []
    for path in sorted(set(old) | set(new)):
        if path not in old:
            changes.append({"path": path, "op": "added"})
        elif path not in new:
            changes.append({"path": path, "op": "deleted"})
        elif old[path] != new[path]:
            changes.append({"path": path, "op": "modified"})
    return changes
