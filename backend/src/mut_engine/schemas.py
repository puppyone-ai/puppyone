"""
Mut Engine — Data models

All data types used by the PuppyOne platform layer:
1. Tree API request/response schemas
2. Version history, diff, and rollback schemas
"""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional, Any, List
from datetime import datetime


# ============================================================
# Tree API request schemas
# ============================================================

class WriteFileRequest(BaseModel):
    """Write file request"""
    path: str
    content: Any
    message: str = ""
    base_version: int = 0
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
    """Delete request"""
    path: str
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
    files: List[BulkWriteItem]
    message: str = ""


# ============================================================
# Tree API response schemas
# ============================================================

class MutEntryResponse(BaseModel):
    """A single entry in the Mut tree"""
    name: str
    path: str
    type: str  # "folder" | "json" | "markdown" | "file"
    content_hash: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    children_count: Optional[int] = None


class ListDirResponse(BaseModel):
    """Response for listing directory contents"""
    path: str
    entries: List[MutEntryResponse]
    version: int = 0


class ReadFileResponse(BaseModel):
    """Response for reading file contents"""
    path: str
    type: str
    content: Any = None
    content_text: Optional[str] = None
    content_hash: Optional[str] = None
    version: int = 0


class StatResponse(BaseModel):
    """File/directory information"""
    path: str
    type: str
    name: str
    content_hash: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    children_count: Optional[int] = None
    exists: bool = True


class TreeResponse(BaseModel):
    """Full directory tree response"""
    path: str
    entries: List[MutEntryResponse]
    version: int = 0


class TrashListResponse(BaseModel):
    """Trash bin contents"""
    entries: List[MutEntryResponse]


# ============================================================
# Version history schemas
# ============================================================

class FileVersionInfo(BaseModel):
    """Version list item"""
    version: int
    who: str = ""
    message: str = ""
    changes: List[dict] = []
    conflicts: List[dict] = []
    root_hash: str = ""
    scope_path: str = ""
    created_at: Optional[datetime] = None


class VersionHistoryResponse(BaseModel):
    """Version history response"""
    project_id: str
    path: Optional[str] = None
    current_version: int
    root_hash: str = ""
    commits: List[FileVersionInfo]
    total: int


class RollbackResponse(BaseModel):
    """Rollback response"""
    project_id: str
    new_version: int
    rolled_back_to: int


class DiffItem(BaseModel):
    """A single change in a diff"""
    path: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    change_type: str


class DiffResponse(BaseModel):
    """Diff result between two versions"""
    project_id: str = ""
    v1: int
    v2: int
    changes: List[DiffItem]


class RollbackRequest(BaseModel):
    """Rollback request"""
    target_version: int


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
    detail: Optional[str] = None
    kept: Optional[str] = None


class MutCommitInfo(BaseModel):
    """Project-level commit record"""
    version: int
    root_hash: str = ""
    scope_path: str = ""
    who: str
    message: str = ""
    changes: List[MutCommitChange] = []
    conflicts: List[MutCommitConflict] = []
    created_at: Optional[datetime] = None


class MutProjectHistoryResponse(BaseModel):
    """Project-level Mut commit history"""
    project_id: str
    current_version: int
    root_hash: str = ""
    commits: List[MutCommitInfo]
    total: int
