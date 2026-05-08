"""
Mut Engine — Data models

All data types used by the PuppyOne platform layer:
1. Tree API request/response schemas
2. Commit history, diff, and rollback schemas

Identity model (as of 20260418):
    Commits are identified by a 16-hex commit_id (SHA256 over
    scope_path | scope_hash | created_at_iso | who).
    The old integer `version` columns / fields are gone.
    Clients that need to represent "no prior state" send an
    empty string "" as the base_commit_id.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

# ============================================================
# Tree API request schemas
# ============================================================

class WriteFileRequest(BaseModel):
    """Write file request.

    `base_commit_id` is the client's expectation of the current
    scope head. Empty string means "I have no base / this is the
    first write". Mismatches trigger server-side three-way merge.
    """
    path: str
    content: Any
    message: str = ""
    base_commit_id: str = ""
    node_type: str = "json"  # json | markdown | file


class MkdirRequest(BaseModel):
    """Create directory request"""
    path: str


class MoveRequest(BaseModel):
    """Move/rename request"""
    old_path: str
    new_path: str
    message: str = ""


class RemoveRequest(BaseModel):
    """Delete request.

    Either ``path`` (single) or ``paths`` (multi-select) may be set.
    If both are set, ``paths`` wins. Multi-path soft-delete batches
    every move into a single commit per scope, so removing 50 files
    costs one MUT commit, not 50.
    """
    path: str = ""
    paths: list[str] | None = None
    permanent: bool = False  # True = permanent delete, False = move to .trash


class RestoreRequest(BaseModel):
    """Restore from .trash request"""
    trash_path: str
    original_path: str


class BulkWriteItem(BaseModel):
    """A single file in a bulk write operation"""
    path: str
    content: Any
    node_type: str = "json"


class BulkWriteRequest(BaseModel):
    """Bulk write request"""
    files: list[BulkWriteItem]
    message: str = ""


# ============================================================
# Tree API response schemas
# ============================================================

class MutEntryResponse(BaseModel):
    """A single entry in the Mut tree"""
    name: str
    path: str
    type: str  # "folder" | "json" | "markdown" | "file"
    content_hash: str | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    children_count: int | None = None


class ListDirResponse(BaseModel):
    """Response for listing directory contents"""
    path: str
    entries: list[MutEntryResponse]
    head_commit_id: str = ""


class ReadFileResponse(BaseModel):
    """Response for reading file contents"""
    path: str
    type: str
    content: Any = None
    content_text: str | None = None
    content_hash: str | None = None
    head_commit_id: str = ""


class StatResponse(BaseModel):
    """File/directory information"""
    path: str
    type: str
    name: str
    content_hash: str | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    children_count: int | None = None
    exists: bool = True


class TreeResponse(BaseModel):
    """Full directory tree response"""
    path: str
    entries: list[MutEntryResponse]
    head_commit_id: str = ""


class TrashListResponse(BaseModel):
    """Trash bin contents"""
    entries: list[MutEntryResponse]


# ============================================================
# Commit history schemas
# ============================================================

class FileVersionInfo(BaseModel):
    """History list item for a single commit."""
    commit_id: str
    who: str = ""
    message: str = ""
    changes: list[dict] = []
    conflicts: list[dict] = []
    root_hash: str = ""
    scope_hash: str = ""
    scope_path: str = ""
    created_at: datetime | None = None


class VersionHistoryResponse(BaseModel):
    """Commit history response (kept name for API compat)."""
    project_id: str
    path: str | None = None
    head_commit_id: str = ""
    root_hash: str = ""
    commits: list[FileVersionInfo]
    total: int


class RollbackResponse(BaseModel):
    """Rollback creates a new forward-commit reverting content."""
    project_id: str
    new_commit_id: str = ""
    rolled_back_to: str = ""


class DiffItem(BaseModel):
    """A single change in a diff"""
    path: str
    old_value: Any | None = None
    new_value: Any | None = None
    change_type: str


class DiffResponse(BaseModel):
    """Diff result between two commits"""
    project_id: str = ""
    from_commit_id: str = ""
    to_commit_id: str = ""
    changes: list[DiffItem]


class RollbackRequest(BaseModel):
    """Rollback request — restore the scope to the state at
    target_commit_id by creating a new forward commit."""
    target_commit_id: str


# ============================================================
# Project-level Mut Commit History
# ============================================================

class MutCommitChange(BaseModel):
    """A single file change in a commit"""
    path: str
    op: str  # "added" | "modified" | "deleted"


class MutCommitConflict(BaseModel):
    """Conflict record in a commit"""
    path: str
    strategy: str
    detail: str | None = None
    kept: str | None = None


class MutCommitInfo(BaseModel):
    """Project-level commit record."""
    commit_id: str
    root_hash: str = ""
    scope_hash: str = ""
    scope_path: str = ""
    who: str
    message: str = ""
    changes: list[MutCommitChange] = []
    conflicts: list[MutCommitConflict] = []
    created_at: datetime | None = None


class MutProjectHistoryResponse(BaseModel):
    """Project-level Mut commit history"""
    project_id: str
    head_commit_id: str = ""
    root_hash: str = ""
    commits: list[MutCommitInfo]
    total: int
