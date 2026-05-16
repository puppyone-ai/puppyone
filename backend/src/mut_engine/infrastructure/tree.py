"""Merkle tree operations using git's binary tree object format.

Formerly ``mut.core.tree``. Each tree object is stored under
``objects/<sha1[:2]>/<sha1[2:]>`` as zlib-compressed
``b"tree <size>\\x00<entries>"``.
"""

from __future__ import annotations

from pathlib import Path

from src.mut_engine.infrastructure.fs_utils import rmtree
from src.mut_engine.infrastructure.git_format import (
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    decode_tree,
    encode_tree,
)
from src.mut_engine.infrastructure.ignore import IgnoreRules
from src.mut_engine.infrastructure.object_store import ObjectStore

MAX_DEPTH = 100


# ── primitive object writers ──────────────────────────────────────

def write_blob(store: ObjectStore, content: bytes) -> str:
    return store.put_blob(content)


def write_tree(store: ObjectStore, entries) -> str:
    """Accept either a list[TreeEntry] (preferred) or a legacy dict
    ``{name: ["B"|"T", sha1]}`` so older call sites keep working while
    the codebase migrates.
    """
    if isinstance(entries, dict):
        converted: list[TreeEntry] = []
        for name, value in entries.items():
            typ, sha1 = value
            mode = MODE_DIR if typ == "T" else MODE_FILE
            converted.append(TreeEntry(name=name, mode=mode, sha1_hex=sha1))
        entries = converted
    return store.put_tree(encode_tree(entries))


def read_tree(store: ObjectStore, h: str) -> dict:
    """Return a dict shaped like the legacy JSON tree
    ``{name: ["B"|"T", sha1]}``.
    """
    obj_type, content = store.get_object(h)
    if obj_type != "tree":
        raise ValueError(f"object {h} is a {obj_type}, expected tree")
    out: dict = {}
    for entry in decode_tree(content):
        marker = "T" if entry.is_dir else "B"
        out[entry.name] = [marker, entry.sha1_hex]
    return out


def read_tree_entries(store: ObjectStore, h: str) -> list[TreeEntry]:
    obj_type, content = store.get_object(h)
    if obj_type != "tree":
        raise ValueError(f"object {h} is a {obj_type}, expected tree")
    return decode_tree(content)


# ── working-directory scan ────────────────────────────────────────

def scan_dir(store: ObjectStore, dirpath: Path, ignore: IgnoreRules,
             _depth: int = 0) -> str:
    if _depth > MAX_DEPTH:
        raise RecursionError(f"directory nesting exceeds {MAX_DEPTH} levels")
    entries: list[TreeEntry] = []
    for child in sorted(dirpath.iterdir()):
        if ignore.should_ignore(child.name):
            continue
        if child.is_file():
            blob_hash = write_blob(store, child.read_bytes())
            entries.append(TreeEntry(name=child.name, mode=MODE_FILE, sha1_hex=blob_hash))
        elif child.is_dir():
            tree_hash = scan_dir(store, child, ignore, _depth + 1)
            entries.append(TreeEntry(name=child.name, mode=MODE_DIR, sha1_hex=tree_hash))
    return store.put_tree(encode_tree(entries))


# ── restore ───────────────────────────────────────────────────────

def _cleanup_removed(dirpath: Path, existing: set, ignore: IgnoreRules):
    if not dirpath.exists():
        return
    for child in dirpath.iterdir():
        if child.name in existing or ignore.should_ignore(child.name):
            continue
        if child.is_file():
            child.unlink()
        elif child.is_dir():
            rmtree(child)


def restore_tree(store: ObjectStore, tree_hash: str, dirpath: Path, ignore: IgnoreRules):
    stack = [(tree_hash, dirpath)]
    while stack:
        th, dp = stack.pop()
        entries = read_tree_entries(store, th)
        existing = {e.name for e in entries}
        for entry in entries:
            target = dp / entry.name
            if entry.is_dir:
                target.mkdir(exist_ok=True)
                stack.append((entry.sha1_hex, target))
            else:
                _type, content = store.get_object(entry.sha1_hex)
                target.write_bytes(content)
        _cleanup_removed(dp, existing, ignore)


def tree_to_flat(store: ObjectStore, tree_hash: str, prefix: str = "") -> dict:
    """Flatten a tree into {relative_path: blob_hash}."""
    result: dict = {}
    stack = [(tree_hash, prefix)]
    while stack:
        th, pfx = stack.pop()
        for entry in read_tree_entries(store, th):
            path = f"{pfx}{entry.name}" if not pfx else f"{pfx}/{entry.name}"
            if entry.is_dir:
                stack.append((entry.sha1_hex, path))
            else:
                result[path] = entry.sha1_hex
    return result


def collect_reachable_hashes(store: ObjectStore, tree_hash: str) -> set:
    result: set = set()
    visited_trees: set[str] = set()
    stack = [tree_hash]
    while stack:
        th = stack.pop()
        if th in visited_trees:
            continue
        visited_trees.add(th)
        result.add(th)
        for entry in read_tree_entries(store, th):
            result.add(entry.sha1_hex)
            if entry.is_dir and entry.sha1_hex not in visited_trees:
                stack.append(entry.sha1_hex)
    return result


def format_tree(store: ObjectStore, h: str, prefix: str = "", name: str = "") -> list[str]:
    entries = read_tree_entries(store, h)
    lines = []
    if name:
        lines.append(f"{prefix}{name}/  ({h})")
    else:
        lines.append(f"{prefix}.  ({h})")
    items = sorted(entries, key=lambda e: e.name)
    for i, entry in enumerate(items):
        is_last = (i == len(items) - 1)
        connector = "└── " if is_last else "├── "
        if entry.is_dir:
            lines.extend(format_tree(store, entry.sha1_hex, prefix + connector, entry.name))
        else:
            lines.append(f"{prefix}{connector}{entry.name}  ({entry.sha1_hex})")
    return lines
