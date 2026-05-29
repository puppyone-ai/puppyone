"""Compatibility wrappers for L5 TreeDelta.

New write-engine code should use ``write_engine.tree_delta`` directly. This
module preserves the historical compact dict shape used by older read/admin
and test call sites.
"""

from __future__ import annotations

from src.version_engine.storage.object_store import ObjectStore
from src.version_engine.write_engine.tree_delta import (
    build_manifest_delta,
    build_tree_delta,
)


def diff_trees(
    store: ObjectStore,
    h1: str,
    h2: str,
    prefix: str = "",
    *,
    tolerant: bool = False,
) -> list[dict]:
    """Diff two trees and return the historical compact change shape."""
    return build_tree_delta(store, h1, h2, prefix, tolerant=tolerant).to_legacy_changes()


def diff_manifests(old: dict, new: dict) -> list[dict]:
    return build_manifest_delta(old, new).to_legacy_changes()
