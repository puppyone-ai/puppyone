"""Compatibility readers for pre-Git-format MUT objects.

New writes store canonical Git loose objects through ``ObjectStore``. Some
existing projects still point at older raw JSON tree objects and raw blob
bytes. These helpers keep those projects readable while any future write
naturally rewrites touched tree nodes into Git object format.
"""

from __future__ import annotations

import json
from typing import Any

from src.mut_engine.application import tree as tree_mod
from src.mut_engine.application.object_store import ObjectStore


def read_tree_compat(store: ObjectStore, tree_hash: str) -> dict:
    """Read either a Git-format tree object or a legacy raw JSON tree.

    This read helper is deliberately non-promoting so directory listings stay
    cheap. Write paths that are about to publish a Git tree should call
    ``promote_tree_compat`` instead.
    """
    if not tree_hash:
        return {}
    try:
        return tree_mod.read_tree(store, tree_hash)
    except Exception as original_exc:
        try:
            return _decode_legacy_tree(read_raw_compat(store, tree_hash))
        except Exception:
            raise original_exc


def read_blob_compat(store: ObjectStore, blob_hash: str) -> bytes:
    """Read either a Git-format blob object or legacy raw blob bytes."""
    try:
        return store.get(blob_hash)
    except Exception as original_exc:
        try:
            return read_raw_compat(store, blob_hash)
        except Exception:
            raise original_exc


def read_raw_compat(store: ObjectStore, object_hash: str) -> bytes:
    """Return raw bytes from the underlying object backend."""
    get_loose = getattr(store, "get_loose", None)
    if callable(get_loose):
        return get_loose(object_hash)
    backend = getattr(store, "_backend", None)
    if backend is None:
        raise FileNotFoundError(f"object backend unavailable: {object_hash}")
    return backend.get(object_hash)


def promote_tree_compat(store: ObjectStore, tree_hash: str) -> tuple[str, dict]:
    """Return a Git-format tree hash and entries for either tree format."""
    if not tree_hash:
        promoted_hash = tree_mod.write_tree(store, {})
        return promoted_hash, {}
    return _promote_legacy_tree(store, tree_hash, {})


def _decode_legacy_tree(raw: bytes) -> dict:
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("legacy tree object is not a JSON object")

    entries: dict[str, list[str]] = {}
    for name, value in parsed.items():
        if not isinstance(name, str):
            raise ValueError("legacy tree entry name is not a string")
        typ, object_hash = _decode_legacy_entry(value)
        entries[name] = [typ, object_hash]
    return entries


def _promote_legacy_tree(
    store: ObjectStore,
    tree_hash: str,
    memo: dict[str, tuple[str, dict]],
) -> tuple[str, dict]:
    cached = memo.get(tree_hash)
    if cached is not None:
        return cached

    try:
        entries = tree_mod.read_tree(store, tree_hash)
        memo[tree_hash] = (tree_hash, entries)
        return tree_hash, entries
    except Exception:
        pass

    legacy_entries = _decode_legacy_tree(read_raw_compat(store, tree_hash))
    promoted_entries: dict[str, list[str]] = {}
    for name, (typ, object_hash) in legacy_entries.items():
        if typ == "T":
            promoted_hash, _entries = _promote_legacy_tree(store, object_hash, memo)
            promoted_entries[name] = ["T", promoted_hash]
        else:
            promoted_entries[name] = ["B", _promote_legacy_blob(store, object_hash)]

    promoted_tree_hash = tree_mod.write_tree(store, promoted_entries)
    memo[tree_hash] = (promoted_tree_hash, promoted_entries)
    return promoted_tree_hash, promoted_entries


def _promote_legacy_blob(store: ObjectStore, blob_hash: str) -> str:
    try:
        obj_type, _content = store.get_object(blob_hash)
        if obj_type == "blob":
            return blob_hash
    except Exception:
        pass
    return store.put_blob(read_raw_compat(store, blob_hash))


def _decode_legacy_entry(value: Any) -> tuple[str, str]:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        typ, object_hash = value[0], value[1]
    elif isinstance(value, dict):
        typ = value.get("type") or value.get("kind")
        object_hash = value.get("hash") or value.get("sha1") or value.get("id")
    else:
        raise ValueError("legacy tree entry has unsupported shape")

    if typ in ("T", "tree", "folder", "dir", "directory"):
        marker = "T"
    elif typ in ("B", "blob", "file"):
        marker = "B"
    else:
        raise ValueError(f"legacy tree entry has unsupported type: {typ!r}")

    if not isinstance(object_hash, str) or not object_hash:
        raise ValueError("legacy tree entry hash is empty")
    return marker, object_hash
