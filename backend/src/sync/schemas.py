"""
Unified Sync — Data Models

Sync — A single sync binding between a content_node and an external resource.
       Stored in the `syncs` table. Replaces the old `sync_sources` +
       content_nodes sync fields with one unified row per sync relationship.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from pydantic import BaseModel


# ============================================================
# Core Model
# ============================================================

@dataclass
class Sync:
    """
    Unified sync binding. Maps to the `syncs` table.

    Each row represents one sync relationship between a content_node
    and an external resource, carrying both connection config and
    per-node sync state.
    """
    id: str
    project_id: str
    node_id: str
    direction: str                          # inbound | outbound | bidirectional
    provider: str                           # filesystem | github | notion | ...
    authority: str = "authoritative"        # authoritative | mirror
    config: Dict[str, Any] = field(default_factory=dict)
    credentials_ref: Optional[str] = None
    access_key: Optional[str] = None
    trigger: Dict[str, Any] = field(default_factory=dict)
    conflict_strategy: Optional[str] = None
    status: str = "active"                  # active | paused | error | syncing
    cursor: Optional[int] = None
    last_synced_at: Optional[str] = None
    error_message: Optional[str] = None
    remote_hash: Optional[str] = None
    last_sync_version: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ============================================================
# Adapter Return Types
# ============================================================

@dataclass
class PullResult:
    """Returned by adapter.pull() — content pulled from external source."""
    content: Any                    # dict (JSON) or str (markdown)
    node_type: str                  # json | markdown
    remote_hash: str                # SHA-256 of external content
    summary: Optional[str] = None


@dataclass
class PushResult:
    """Returned by adapter.push()."""
    success: bool
    remote_hash: Optional[str] = None
    error: Optional[str] = None


@dataclass
class ResourceInfo:
    """Returned by adapter.list_resources() — one resource in the external source."""
    external_resource_id: str       # resource identifier (relative path / page_id)
    name: str                       # human-readable name
    node_type: str                  # json | markdown | file
    size_bytes: Optional[int] = None


# ============================================================
# SyncWorker (L1 local file incremental sync)
# ============================================================

@dataclass
class SyncResult:
    synced: int = 0
    skipped: int = 0
    failed: int = 0
    total: int = 0
    elapsed_seconds: float = 0.0


@dataclass
class NodeSyncMeta:
    updated_at: str = ""
    name: str = ""
    node_type: str = ""
    file_path: str = ""
    version: int = 0


class SyncProjectRequest(BaseModel):
    project_id: str
    force: bool = False


class SyncProjectResponse(BaseModel):
    project_id: str
    synced: int
    skipped: int
    failed: int
    total: int
    elapsed_seconds: float
