"""
Mut Engine — Data models

All data types used by the PuppyOne platform layer:
1. Tree API request/response schemas
2. Commit history, diff, and rollback schemas

Identity model (post mut/feat/git-format-storage):
    Commits are identified by a 40-hex SHA-1 commit_id — the SHA-1
    over the git ``commit`` object body produced by ``encode_commit``
    (tree + parent + author/committer lines + message). On disk the
    commit body is stored as a zlib-compressed loose object whose
    SHA-1 is exactly this commit_id, so PuppyOne and any standard git
    tool agree byte-for-byte.
    The old integer `version` columns / fields are gone.
    Clients that need to represent "no prior state" send an
    empty string "" as the base_commit_id.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

# ============================================================
# Tree API request schemas
# ============================================================

class WriteFileRequest(BaseModel):
    """Write file request.

    ``base_commit_id`` is an optional precondition: when provided, the
    backend atomically verifies it is still the current scope head before
    committing. A mismatch returns 409 so one-shot REST/CLI writes never
    silently overwrite another collaborator. Omit it only for callers that
    intentionally accept last-writer-wins semantics or use the MUT merge
    protocol separately.
    """
    path: str
    content: Any
    message: str = ""
    base_commit_id: str | None = None
    node_type: str = "json"  # json | markdown | file


class MkdirRequest(BaseModel):
    """Create directory request"""
    path: str
    base_commit_id: str | None = None
    parents: bool = False


class MoveRequest(BaseModel):
    """Move/rename request"""
    old_path: str
    new_path: str
    message: str = ""
    base_commit_id: str | None = None
    no_clobber: bool = False
    target_directory: bool = False
    no_target_directory: bool = False


class CopyRequest(BaseModel):
    """Copy request"""
    old_path: str
    new_path: str
    message: str = ""
    base_commit_id: str | None = None
    recursive: bool = False
    no_clobber: bool = False
    target_directory: bool = False
    no_target_directory: bool = False


class TouchRequest(BaseModel):
    """Touch/create empty files request"""
    path: str = ""
    paths: list[str] | None = None
    base_commit_id: str | None = None


class RemoveRequest(BaseModel):
    """Delete request.

    Either ``path`` (single) or ``paths`` (multi-select) may be set.
    If both are set, ``paths`` wins. Deletes remove paths from the
    current tree; recovery is handled through MUT history/rollback.
    """
    path: str = ""
    paths: list[str] | None = None
    permanent: bool = True  # Deprecated compatibility field; delete is always permanent.
    force: bool = False
    recursive: bool = False
    base_commit_id: str | None = None


class RmdirRequest(BaseModel):
    """Remove empty directories request."""
    path: str = ""
    paths: list[str] | None = None
    parents: bool = False
    base_commit_id: str | None = None


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
    head_commit_id: str = ""
    scope_head_commit_id: str = ""


class TreeResponse(BaseModel):
    """Full directory tree response"""
    path: str
    entries: list[MutEntryResponse]
    head_commit_id: str = ""


# ============================================================
# Commit history schemas
# ============================================================

class MutCommitChange(BaseModel):
    """A single file change in a commit.

    ``action`` is the MUT-native operation stored in history rows.
    ``op`` is the stable Git-style UI/API operation label.
    """
    path: str
    action: Literal["add", "update", "delete"] = "update"
    op: Literal["added", "modified", "deleted"] = "modified"


class FileVersionInfo(BaseModel):
    """History list item for a single commit."""
    commit_id: str
    who: str = ""
    message: str = ""
    changes: list[MutCommitChange] = []
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
