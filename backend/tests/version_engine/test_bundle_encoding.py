"""Regression: ``_encode_object_bundle`` is deterministic.

Two calls with the same object set must produce byte-identical bundles
— otherwise the same set of writes would upload to different S3 keys
on each retry, wasting space and breaking the read path's location
lookup (``mut_object_locations.pack_key``).

This is a sanity test; an audit flagged "S3 bundle non-idempotent put"
which turned out to be incorrect. Lock the behavior in so a future
refactor (e.g. switching the header to JSON-with-timestamps) doesn't
silently regress this.
"""

import hashlib

from src.version_engine.storage.backends.s3 import (
    _encode_object_bundle,
)


def test_bundle_byte_identical_across_runs():
    objs = {
        "aaa" * 14: b"file content A",
        "bbb" * 14: b"file content B",
        "ccc" * 14: b"file content C",
    }
    bundle1, entries1 = _encode_object_bundle(objs)
    bundle2, entries2 = _encode_object_bundle(dict(objs))
    assert bundle1 == bundle2
    assert entries1 == entries2


def test_bundle_invariant_under_insert_order():
    """dict insertion order must not change the bundle."""
    objs1 = {"a" * 40: b"x", "b" * 40: b"y", "c" * 40: b"z"}
    objs2 = {"c" * 40: b"z", "a" * 40: b"x", "b" * 40: b"y"}
    bundle1, _ = _encode_object_bundle(objs1)
    bundle2, _ = _encode_object_bundle(objs2)
    assert bundle1 == bundle2
    assert hashlib.sha256(bundle1).digest() == hashlib.sha256(bundle2).digest()


def test_bundle_entries_carry_correct_offsets():
    """Each entry's ``offset_bytes`` must point at the start of its
    data inside the bundle, with no overlap."""
    objs = {"a" * 40: b"alpha", "b" * 40: b"beta-content"}
    bundle, entries = _encode_object_bundle(objs)
    for entry in entries:
        start = entry["offset_bytes"]
        size = entry["size_bytes"]
        # Bytes at this slice must match what we put in.
        assert bundle[start:start + size] == objs[entry["object_id"]]
