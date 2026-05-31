"""GAP-5: child-scope merge must run at the blob-OID level (no blob downloads).

The 3-way merge that projects a project-root commit into child scopes used
to flatten three subtrees to *bytes* (downloading every blob ×3) on the
request path. It now flattens to ``{path: blob_oid}`` (tree objects only)
and rebuilds from oids. These tests lock in:

  - ``build_tree_from_blob_ids`` is equivalent to ``build_tree_from_files``,
  - the merge keeps parent-authoritative semantics (root wins on changed
    paths, child edits preserved on untouched paths, deletes propagate),
  - the stale-root divergence guard still holds.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.tree import tree_to_flat, write_tree
from src.version_engine.write_engine.tree_objects import (
    build_tree_from_blob_ids,
    build_tree_from_files,
)
from src.version_engine.derived.hooks import _merge_project_root_delta_into_child_scope


@pytest.fixture
def store(tmp_path):
    return ObjectStore(tmp_path / "objects")


def _flat_bytes(store, tree_hash):
    """Resolve a tree to {path: bytes} for assertion convenience."""
    return {p: store.get(oid) for p, oid in tree_to_flat(store, tree_hash).items()}


def _root_with_scope(store, scope_name, subtree_hash):
    """A project-root tree carrying one child scope directory."""
    if not subtree_hash:
        return write_tree(store, {})
    return write_tree(store, {scope_name: ["T", subtree_hash]})


# ── build_tree_from_blob_ids equivalence ────────────────────────────


def test_build_from_blob_ids_matches_build_from_files(store):
    files = {
        "a.txt": b"alpha",
        "dir/b.txt": b"beta",
        "dir/sub/c.txt": b"gamma",
    }
    by_bytes = build_tree_from_files(store, files)
    oid_map = tree_to_flat(store, by_bytes)
    by_oids = build_tree_from_blob_ids(store, oid_map)
    assert by_oids == by_bytes  # identical tree object id


def test_build_from_blob_ids_skips_empty(store):
    assert build_tree_from_blob_ids(store, {}) == write_tree(store, {})


# ── merge semantics ─────────────────────────────────────────────────


def _merge(store, *, old_files, new_files, current_files, scope="docs", stale=False,
           changed=None):
    old_sub = build_tree_from_files(store, old_files) if old_files else ""
    new_sub = build_tree_from_files(store, new_files) if new_files else ""
    cur_sub = build_tree_from_files(store, current_files) if current_files else ""
    prev_root = _root_with_scope(store, scope, old_sub)
    new_root = _root_with_scope(store, scope, new_sub)
    repo = SimpleNamespace(store=store)
    merged_hash = _merge_project_root_delta_into_child_scope(
        repo=repo,
        scope_path=scope,
        previous_project_root_hash=prev_root,
        project_root_hash=new_root,
        current_scope_hash=cur_sub,
        changed_paths=changed if changed is not None else [f"{scope}/x"],
        stale_project_root=stale,
    )
    return _flat_bytes(store, merged_hash) if merged_hash else {}


def test_parent_wins_child_edits_preserved(store):
    merged = _merge(
        store,
        old_files={"a.txt": b"1", "b.txt": b"2"},
        new_files={"a.txt": b"1-mod", "b.txt": b"2", "c.txt": b"3"},
        current_files={"a.txt": b"1", "b.txt": b"2-child", "d.txt": b"child"},
    )
    assert merged == {
        "a.txt": b"1-mod",   # root changed a -> parent wins
        "b.txt": b"2-child", # root left b alone -> child edit preserved
        "c.txt": b"3",       # root added c
        "d.txt": b"child",   # child-only file untouched by root delta
    }


def test_root_delete_propagates(store):
    merged = _merge(
        store,
        old_files={"a.txt": b"1", "b.txt": b"2"},
        new_files={"a.txt": b"1"},               # root deleted b
        current_files={"a.txt": b"1", "b.txt": b"2", "e.txt": b"keep"},
    )
    assert "b.txt" not in merged
    assert merged["a.txt"] == b"1"
    assert merged["e.txt"] == b"keep"


def test_stale_root_skips_diverged_path(store):
    # root changed a 1->1-mod, but the child already moved a to a-child.
    # Under a stale root projection the child's divergent value must win.
    merged = _merge(
        store,
        old_files={"a.txt": b"1"},
        new_files={"a.txt": b"1-mod"},
        current_files={"a.txt": b"a-child"},
        stale=True,
    )
    assert merged["a.txt"] == b"a-child"


def test_non_stale_root_overwrites_even_if_diverged(store):
    # The same divergence under a FRESH (non-stale) root: parent is
    # authoritative and wins.
    merged = _merge(
        store,
        old_files={"a.txt": b"1"},
        new_files={"a.txt": b"1-mod"},
        current_files={"a.txt": b"a-child"},
        stale=False,
    )
    assert merged["a.txt"] == b"1-mod"


def test_merge_preserves_blob_modes(store):
    """A1-1: the OID merge must carry blob modes — a child-only executable
    is kept, a parent-added executable is taken, neither downgraded to file."""
    from src.version_engine.write_engine.git_object_format import (
        MODE_EXECUTABLE, MODE_FILE,
    )
    from src.version_engine.write_engine.tree import tree_path_modes

    scope = "docs"
    cur_sub = build_tree_from_files(
        store, {"keep.sh": b"#!/bin/sh\n", "a.txt": b"1"},
        modes={"keep.sh": MODE_EXECUTABLE},
    )
    old_sub = build_tree_from_files(store, {"a.txt": b"1"})
    new_sub = build_tree_from_files(
        store, {"a.txt": b"1", "bin.sh": b"#!/bin/sh\nrun\n"},
        modes={"bin.sh": MODE_EXECUTABLE},
    )
    merged = _merge_project_root_delta_into_child_scope(
        repo=SimpleNamespace(store=store),
        scope_path=scope,
        previous_project_root_hash=_root_with_scope(store, scope, old_sub),
        project_root_hash=_root_with_scope(store, scope, new_sub),
        current_scope_hash=cur_sub,
        changed_paths=[f"{scope}/bin.sh"],
        stale_project_root=False,
    )
    modes = tree_path_modes(store, merged)
    assert modes["keep.sh"] == MODE_EXECUTABLE   # child-only executable kept
    assert modes["bin.sh"] == MODE_EXECUTABLE    # parent-added executable taken
    assert modes["a.txt"] == MODE_FILE


def test_oid_merge_matches_reference_byte_merge(store):
    """Exhaustive equivalence: the OID merge yields the same file set the
    old byte-level merge would have produced."""
    old_files = {"a.txt": b"1", "b.txt": b"2", "x/y.txt": b"deep"}
    new_files = {"a.txt": b"1-mod", "x/y.txt": b"deep", "n.txt": b"new"}
    current_files = {"a.txt": b"1", "b.txt": b"2-child", "z.txt": b"zonly"}

    merged = _merge(
        store, old_files=old_files, new_files=new_files, current_files=current_files,
    )

    # Reference: byte-level 3-way merge (parent wins on changed paths).
    expected = dict(current_files)
    for path in set(old_files) | set(new_files):
        before = old_files.get(path)
        after = new_files.get(path)
        if before == after:
            continue
        if after is None:
            expected.pop(path, None)
        else:
            expected[path] = after
    assert merged == expected
