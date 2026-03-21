"""
Mut Engine — 数据模型

PuppyOne 平台层使用的所有数据类型：
1. MutWriteService 结果 (WriteResult, DeleteResult, MoveResult)
2. Tree API 请求/响应 Schema
3. 版本历史、diff、回滚 Schema
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, Any, List, Dict
from datetime import datetime


# ============================================================
# MutWriteService 结果
# ============================================================

class WriteResult(BaseModel):
    """写操作的返回结果"""
    version: int
    content_hash: str = ""
    root_hash: str = ""
    path: str
    op: str = ""  # "added" | "modified" | "unchanged"
    conflicts: list[dict] = []


class DeleteResult(BaseModel):
    version: int
    root_hash: str = ""
    path: str


class MoveResult(BaseModel):
    version: int
    root_hash: str = ""
    old_path: str
    new_path: str


# ============================================================
# Tree API 请求 Schema
# ============================================================

class WriteFileRequest(BaseModel):
    """写入文件请求"""
    path: str
    content: Any
    message: str = ""
    base_version: int = 0
    node_type: str = "json"  # json | markdown | file


class MkdirRequest(BaseModel):
    """创建目录请求"""
    path: str


class MoveRequest(BaseModel):
    """移动/重命名请求"""
    old_path: str
    new_path: str
    message: str = ""


class RemoveRequest(BaseModel):
    """删除请求"""
    path: str
    permanent: bool = False  # True = 真删除, False = 移入 .trash


class RestoreRequest(BaseModel):
    """从 .trash 恢复请求"""
    trash_path: str
    original_path: str


class BulkWriteItem(BaseModel):
    """批量写入中的单个文件"""
    path: str
    content: Any
    node_type: str = "json"


class BulkWriteRequest(BaseModel):
    """批量写入请求"""
    files: List[BulkWriteItem]
    message: str = ""


# ============================================================
# Tree API 响应 Schema
# ============================================================

class MutEntryResponse(BaseModel):
    """Mut tree 中的一个条目"""
    name: str
    path: str
    type: str  # "folder" | "json" | "markdown" | "file"
    content_hash: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    children_count: Optional[int] = None


class ListDirResponse(BaseModel):
    """列出目录内容的响应"""
    path: str
    entries: List[MutEntryResponse]
    version: int = 0


class ReadFileResponse(BaseModel):
    """读取文件内容的响应"""
    path: str
    type: str
    content: Any = None
    content_text: Optional[str] = None
    content_hash: Optional[str] = None
    version: int = 0


class StatResponse(BaseModel):
    """文件/目录信息"""
    path: str
    type: str
    name: str
    content_hash: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    children_count: Optional[int] = None
    exists: bool = True


class TreeResponse(BaseModel):
    """完整目录树响应"""
    path: str
    entries: List[MutEntryResponse]
    version: int = 0


class TrashListResponse(BaseModel):
    """回收站内容"""
    entries: List[MutEntryResponse]


# ============================================================
# 版本历史 Schema
# ============================================================

class FileVersionInfo(BaseModel):
    """版本列表项"""
    version: int
    who: str = ""
    message: str = ""
    changes: List[dict] = []
    conflicts: List[dict] = []
    root_hash: str = ""
    scope_path: str = ""
    created_at: Optional[datetime] = None


class VersionHistoryResponse(BaseModel):
    """版本历史响应"""
    project_id: str
    path: Optional[str] = None
    current_version: int
    root_hash: str = ""
    commits: List[FileVersionInfo]
    total: int


class RollbackResponse(BaseModel):
    """回滚响应"""
    project_id: str
    new_version: int
    rolled_back_to: int


class DiffItem(BaseModel):
    """diff 中的单个变更"""
    path: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    change_type: str


class DiffResponse(BaseModel):
    """两个版本的 diff 结果"""
    project_id: str = ""
    v1: int
    v2: int
    changes: List[DiffItem]


class RollbackRequest(BaseModel):
    """rollback 请求"""
    target_version: int


# ============================================================
# Project-level Mut Commit History
# ============================================================

class MutCommitChange(BaseModel):
    """commit 中的单个文件变更"""
    path: str
    op: str  # "added" | "modified" | "deleted"


class MutCommitConflict(BaseModel):
    """commit 中的冲突记录"""
    path: str
    strategy: str
    detail: Optional[str] = None
    kept: Optional[str] = None


class MutCommitInfo(BaseModel):
    """项目级 commit 记录"""
    version: int
    root_hash: str = ""
    scope_path: str = ""
    who: str
    message: str = ""
    changes: List[MutCommitChange] = []
    conflicts: List[MutCommitConflict] = []
    created_at: Optional[datetime] = None


class MutProjectHistoryResponse(BaseModel):
    """项目级 Mut commit 历史"""
    project_id: str
    current_version: int
    root_hash: str = ""
    commits: List[MutCommitInfo]
    total: int
