"""view_projection exclude-filter is OID-level (no blob downloads) and
tolerant of a damaged/missing leaf blob.

Previously the scope-view projection flattened the whole tree to BYTES to
apply excludes (download every blob, O(N×S)) — and a single missing blob
bricked the entire scope's Git/AP view. It now rebuilds from blob OIDs, so
it never reads blob content: faster, and a damaged leaf blob no longer
breaks the view.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.version_engine.domain.errors import ObjectNotFoundError
from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.git_commit import build_git_commit
from src.version_engine.write_engine.tree import tree_to_flat
from src.version_engine.write_engine.tree_objects import (
    build_tree_from_files,
    flatten_tree_to_bytes,
)
from src.version_engine.adapters.git.view_projection import filtered_commit_tree

_EPOCH = "1970-01-01T00:00:00+00:00"


@pytest.fixture
def store(tmp_path):
    return ObjectStore(tmp_path / "obj")


class DamagedBlobStore:
    """Wraps an ObjectStore but raises ObjectNotFoundError when a specific
    object's bytes are read — simulating a damaged/missing blob while the
    surrounding tree objects stay intact. All other calls delegate."""

    def __init__(self, inner: ObjectStore, damaged_hash: str):
        self._inner = inner
        self._damaged = damaged_hash

    def get_object(self, sha1: str):
        if sha1 == self._damaged:
            raise ObjectNotFoundError(f"object not found: {sha1}")
        return self._inner.get_object(sha1)

    def get(self, h: str) -> bytes:
        if h == self._damaged:
            raise ObjectNotFoundError(f"object not found: {h}")
        return self._inner.get(h)

    def __getattr__(self, name):  # delegate put_tree/put_blob/exists/...
        return getattr(self._inner, name)


def _commit(store, files):
    tree = build_tree_from_files(store, files)
    repo = SimpleNamespace(store=store)
    commit = build_git_commit(
        repo, tree_sha=tree, parent_sha="", who="t", message="m",
        created_at_iso=_EPOCH,
    )
    return tree, commit


def test_filtered_commit_tree_excludes_paths(store):
    tree, commit = _commit(store, {
        "a.txt": b"A", "docs/b.txt": b"B", "docs/secret.txt": b"S",
    })
    repo = SimpleNamespace(store=store)

    ft = filtered_commit_tree(repo, commit, "", ["docs/secret.txt"])
    flat = tree_to_flat(store, ft)

    assert set(flat) == {"a.txt", "docs/b.txt"}      # secret excluded
    # content preserved: the kept entries point at the same blob oids
    original = tree_to_flat(store, tree)
    assert flat["a.txt"] == original["a.txt"]
    assert flat["docs/b.txt"] == original["docs/b.txt"]


def test_filtered_commit_tree_tolerates_damaged_blob(store):
    tree, commit = _commit(store, {
        "a.txt": b"A", "docs/b.txt": b"B", "docs/secret.txt": b"S",
    })
    a_oid = tree_to_flat(store, tree)["a.txt"]

    damaged = DamagedBlobStore(store, a_oid)
    repo = SimpleNamespace(store=damaged)

    # OID-level filter never reads blob content → succeeds despite the
    # damaged a.txt blob, and still strips the excluded path.
    ft = filtered_commit_tree(repo, commit, "", ["docs/secret.txt"])
    flat = tree_to_flat(store, ft)
    assert set(flat) == {"a.txt", "docs/b.txt"}

    # Regression guard: the old byte-flatten path WOULD blow up on the same
    # damaged blob — proving the OID rewrite is what buys the tolerance.
    with pytest.raises(ObjectNotFoundError):
        flatten_tree_to_bytes(damaged, tree)
