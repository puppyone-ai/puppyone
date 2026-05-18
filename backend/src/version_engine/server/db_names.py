"""Persistent database identifiers for the Version Engine boundary.

The runtime architecture is Git-native and product-facing code should use
Version Engine names. These constants isolate historical database names whose
schema rename is intentionally deferred so callers do not spread them through
application code.
"""

COMMIT_HISTORY_TABLE = "mut_commits"
SCOPE_STATE_TABLE = "mut_scope_state"
VERSION_INDEX_TABLE = "mut_version_index"
VERSION_OUTBOX_TABLE = "mut_version_outbox"
OBJECT_LOCATIONS_TABLE = "mut_object_locations"
CONFLICTS_TABLE = "mut_conflicts"

PROJECT_ROOT_HASH_COLUMN = "mut_root_hash"
GITHUB_SYNC_VERSION_COLUMN = "mut_commit_id"

PUBLISH_SCOPE_UPDATE_RPC = "publish_mut_scope_update"
PUBLISH_PROJECT_UPDATE_RPC = "publish_mut_project_update"
PROJECT_WRITE_STATE_RPC = "get_mut_project_write_state"
CLAIM_OUTBOX_RPC = "claim_mut_version_outbox_batch"
COMPLETE_OUTBOX_RPC = "complete_mut_version_outbox"
FAIL_OUTBOX_RPC = "fail_mut_version_outbox"
