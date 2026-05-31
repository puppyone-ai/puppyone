"""L5 structural write-diff boundary.

TreeDelta is the write-engine's machine diff: path/tree/blob changes used for
scope validation, sparse merge, conflict policy input, history facts, and audit.
It is intentionally not a human-readable semantic diff.
"""

from src.version_engine.write_engine.tree_delta.builder import (
    build_file_map_delta,
    build_manifest_delta,
    build_tree_delta,
)
from src.version_engine.write_engine.tree_delta.content import (
    build_default_content_delta_registry,
    ContentDelta,
    ContentDeltaRegistry,
    ContentDeltaStrategy,
)
from src.version_engine.write_engine.tree_delta.models import (
    ChangeAction,
    EntryKind,
    TreeChange,
    TreeDelta,
)
from src.version_engine.write_engine.tree_delta.projection import (
    changed_relative_paths,
    changes_from_file_maps,
    changes_from_tree_delta,
    paths_from_tree_delta,
)

__all__ = [
    "ChangeAction",
    "ContentDelta",
    "ContentDeltaRegistry",
    "ContentDeltaStrategy",
    "EntryKind",
    "TreeChange",
    "TreeDelta",
    "build_file_map_delta",
    "build_default_content_delta_registry",
    "build_manifest_delta",
    "build_tree_delta",
    "changed_relative_paths",
    "changes_from_file_maps",
    "changes_from_tree_delta",
    "paths_from_tree_delta",
]
