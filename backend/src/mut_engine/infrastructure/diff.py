"""Diff computation between two trees or between manifests.

Formerly ``mut.core.diff``.
"""

from __future__ import annotations

from src.mut_engine.infrastructure import tree as tree_mod
from src.mut_engine.infrastructure.object_store import ObjectStore


def diff_trees(store: ObjectStore, h1: str, h2: str, prefix: str = "") -> list[dict]:
    """Compare two tree hashes, return list of {path, op} changes."""
    if h1 == h2:
        return []
    changes: list[dict] = []
    _diff_recursive(store, h1, h2, prefix, changes)
    return changes


def _diff_recursive(store: ObjectStore, h1: str, h2: str, prefix: str, out: list):
    if h1 == h2:
        return
    e1 = tree_mod.read_tree(store, h1)
    e2 = tree_mod.read_tree(store, h2)
    for name in sorted(set(e1) | set(e2)):
        p = f"{prefix}/{name}" if prefix else name
        a, b = e1.get(name), e2.get(name)
        if a is None:
            out.append({"path": p, "op": "added"})
        elif b is None:
            out.append({"path": p, "op": "deleted"})
        elif a[1] != b[1]:
            if a[0] == "T" and b[0] == "T":
                _diff_recursive(store, a[1], b[1], p, out)
            else:
                out.append({"path": p, "op": "modified"})


def diff_manifests(old: dict, new: dict) -> list:
    """Compare two flat manifests {path: hash}, return changes."""
    changes: list[dict] = []
    for path in sorted(set(old) | set(new)):
        if path not in old:
            changes.append({"path": path, "op": "added"})
        elif path not in new:
            changes.append({"path": path, "op": "deleted"})
        elif old[path] != new[path]:
            changes.append({"path": path, "op": "modified"})
    return changes
