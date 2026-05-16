"""Git tree diff helpers owned by PuppyOne."""

from __future__ import annotations

from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.object_store import ObjectStore


def diff_trees(store: ObjectStore, h1: str, h2: str, prefix: str = "") -> list[dict]:
    if h1 == h2:
        return []
    changes: list[dict] = []
    _diff_recursive(store, h1, h2, prefix, changes)
    return changes


def _diff_recursive(store: ObjectStore, h1: str, h2: str, prefix: str, out: list) -> None:
    if h1 == h2:
        return
    left = tree_mod.read_tree(store, h1)
    right = tree_mod.read_tree(store, h2)
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
                _diff_recursive(store, a[1], b[1], path, out)
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
