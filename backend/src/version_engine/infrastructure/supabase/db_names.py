"""Persistent database identifiers for the Version Engine boundary.

The runtime architecture is Git-native and product-facing code uses
Version Engine names. These constants centralise the physical DB names
so a rename is a one-file change.

Tables + RPCs were flipped from the legacy prefix to ``version_*`` by
migration ``20260528000000_version_table_rename_phase2``. That migration
keeps legacy-named compatibility views + delegating RPC wrappers alive
for a zero-downtime rolling deploy; they're dropped by a later Phase-3
migration once nothing reads the old names.

Two product-table columns are intentionally NOT renamed (they live on
``projects`` / ``github_sync_log``, not the version-engine tables, and
several RPC bodies still reference the old column name). The two
``*_COLUMN`` constants below therefore keep their legacy values. See the
rename-plan doc under ``docs/architecture/`` (07, rename plan).
"""

COMMIT_HISTORY_TABLE = "version_commits"
SCOPE_STATE_TABLE = "version_scope_state"
VERSION_INDEX_TABLE = "version_view_commits"
VERSION_OUTBOX_TABLE = "version_outbox"
OBJECT_LOCATIONS_TABLE = "version_object_locations"
CONFLICTS_TABLE = "version_conflicts"

# Deferred — product-table columns, not version-engine tables (see docstring).
PROJECT_ROOT_HASH_COLUMN = "mut_root_hash"
GITHUB_SYNC_VERSION_COLUMN = "mut_commit_id"

PUBLISH_SCOPE_UPDATE_RPC = "publish_version_scope_update"
PUBLISH_PROJECT_UPDATE_RPC = "publish_version_project_update"
PROJECT_WRITE_STATE_RPC = "get_version_project_write_state"
CLAIM_OUTBOX_RPC = "claim_version_outbox_batch"
COMPLETE_OUTBOX_RPC = "complete_version_outbox"
FAIL_OUTBOX_RPC = "fail_version_outbox"
