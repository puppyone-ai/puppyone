"""
L2 Collaboration — 数据模型

包含：
1. 协同层核心类型（WorkingCopy, CommitResult, MergeResult）
2. 版本管理数据模型（FileVersion, FolderSnapshot）
3. API 响应 Schema

迁移自 content_node/version_schemas.py + 新增 L2 类型
"""

from pydantic import BaseModel, Field
from typing import Optional, Any, List, Dict
from datetime import datetime


# ============================================================
# L2 协同层核心类型（新增）
# ============================================================

class WorkingCopy(BaseModel):
    """checkout 返回的工作副本"""
    node_id: str
    node_type: str                          # json / markdown / file
    content: Optional[str] = None           # 序列化后的内容（JSON string 或 MD text）
    content_json: Optional[Any] = None      # JSON 原始对象（便于直接操作）
    base_version: int                       # checkout 时的版本号（commit 时作为乐观锁 base）
    content_hash: Optional[str] = None


class CommitResult(BaseModel):
    """commit 返回的结果"""
    node_id: str
    status: str                             # "clean" | "merged" | "lww"
    version: int                            # 写入后的新版本号
    final_content: Optional[Any] = None     # 最终写入的内容
    strategy: Optional[str] = None          # "direct" | "json_key" | "line_diff3" | "lww"
    conflict_details: Optional[str] = None


class MergeResult(BaseModel):
    """三方合并的内部结果"""
    node_id: str
    status: str                             # "clean" | "merged" | "lww"
    merged_content: Optional[Any] = None
    strategy_used: Optional[str] = None     # "direct" / "json_key" / "line_diff3" / "lww"
    conflict_details: Optional[str] = None


# ============================================================
# 版本管理数据模型（迁移自 content_node/version_schemas.py）
# ============================================================

class FileVersion(BaseModel):
    """文件版本（对应 file_versions 表）"""
    id: int
    node_id: str
    version: int

    content_json: Optional[Any] = None
    content_text: Optional[str] = None
    s3_key: Optional[str] = None

    content_hash: str
    size_bytes: int = 0

    snapshot_id: Optional[int] = None

    operator_type: str
    operator_id: Optional[str] = None
    session_id: Optional[str] = None

    operation: str
    merge_strategy: Optional[str] = None
    summary: Optional[str] = None

    created_at: Optional[datetime] = None


class FolderSnapshot(BaseModel):
    """文件夹快照（对应 folder_snapshots 表）"""
    id: int
    folder_node_id: str

    file_versions_map: Dict[str, int]
    changed_files: Optional[List[str]] = None
    files_count: int = 0
    changed_count: int = 0

    operator_type: str
    operator_id: Optional[str] = None
    session_id: Optional[str] = None

    operation: str
    summary: Optional[str] = None
    base_snapshot_id: Optional[int] = None

    created_at: Optional[datetime] = None


# ============================================================
# API 响应 Schema
# ============================================================

class FileVersionInfo(BaseModel):
    """版本列表项（不含完整内容）"""
    id: int
    version: int
    content_hash: str
    size_bytes: int = 0
    snapshot_id: Optional[int] = None
    operator_type: str
    operator_id: Optional[str] = None
    operation: str
    merge_strategy: Optional[str] = None
    summary: Optional[str] = None
    created_at: Optional[datetime] = None


class FileVersionDetail(FileVersionInfo):
    """版本详情（含完整内容）"""
    node_id: str
    content_json: Optional[Any] = None
    content_text: Optional[str] = None
    s3_key: Optional[str] = None
    s3_download_url: Optional[str] = None


class VersionHistoryResponse(BaseModel):
    """文件版本历史响应"""
    node_id: str
    node_name: str
    current_version: int
    versions: List[FileVersionInfo]
    total: int


class FolderSnapshotInfo(BaseModel):
    """快照列表项"""
    id: int
    file_versions_map: Dict[str, int]
    changed_files: Optional[List[str]] = None
    files_count: int = 0
    changed_count: int = 0
    operator_type: str
    operator_id: Optional[str] = None
    operation: str
    summary: Optional[str] = None
    base_snapshot_id: Optional[int] = None
    created_at: Optional[datetime] = None


class FolderSnapshotHistoryResponse(BaseModel):
    """文件夹快照历史响应"""
    folder_node_id: str
    folder_name: str
    snapshots: List[FolderSnapshotInfo]
    total: int


class RollbackResponse(BaseModel):
    """单文件回滚响应"""
    node_id: str
    new_version: int
    rolled_back_to: int


class FolderRollbackResponse(BaseModel):
    """文件夹回滚响应"""
    folder_node_id: str
    new_snapshot_id: int
    rolled_back_to_snapshot: int
    files_restored: int


class DiffItem(BaseModel):
    """JSON diff 中的单个变更"""
    path: str
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    change_type: str


class DiffResponse(BaseModel):
    """两个版本的 diff 结果"""
    node_id: str
    v1: int
    v2: int
    changes: List[DiffItem]


# ============================================================
# API 请求 Schema（新增）
# ============================================================

class CheckoutRequest(BaseModel):
    """checkout 请求"""
    node_ids: List[str]
    agent_id: Optional[str] = None


class CommitRequest(BaseModel):
    """commit 请求"""
    node_id: str
    content: Any                            # JSON object 或 string
    base_version: int
    node_type: str = "json"                 # json / markdown
    agent_id: Optional[str] = None
    operator: Optional[str] = None


class RollbackRequest(BaseModel):
    """rollback 请求"""
    node_id: str
    target_version: int
