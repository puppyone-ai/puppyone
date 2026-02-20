"""
L2.5 Sync — Data Models

SyncSource  — External data source connection (a directory / Notion workspace / GitHub repo).
              Stored in `sync_sources` table.

SyncMapping — Per-node sync state. Backed by sync fields on `content_nodes` table
              (sync_source_id, external_resource_id, remote_hash, last_sync_version, ...).
              No separate table — one content_node row = one sync binding.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from pydantic import BaseModel


# ============================================================
# Core Models
# ============================================================

@dataclass
class SyncSource:
    """External data source connection. Maps to sync_sources table."""
    id: int
    project_id: str
    adapter_type: str               # filesystem | github | notion | ...
    config: Dict[str, Any]          # adapter-specific configuration
    trigger_config: Dict[str, Any]  # { type: "watchdog" | "polling" | "webhook", ... }
    sync_mode: str                  # bidirectional | pull_only | push_only
    conflict_strategy: str          # three_way_merge | external_wins | puppyone_wins | manual
    status: str                     # active | paused | error
    last_error: Optional[str] = None
    credentials_ref: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class SyncMapping:
    """Per-node sync state. Backed by sync fields on content_nodes table."""
    source_id: int
    node_id: str
    external_resource_id: str       # resource identifier within source (relative path / page_id)
    remote_hash: Optional[str] = None
    last_sync_version: int = 0
    status: str = "idle"            # idle | syncing | synced | error


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
