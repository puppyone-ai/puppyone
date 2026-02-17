"""
L2.5 Sync — 数据模型

同步相关的 dataclass 和 Pydantic 模型。
从 workspace/provider.py 提取出通用类型。
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from pydantic import BaseModel


@dataclass
class SyncResult:
    """同步结果"""
    synced: int = 0
    skipped: int = 0
    failed: int = 0
    total: int = 0
    elapsed_seconds: float = 0.0


@dataclass
class NodeSyncMeta:
    """单个节点的同步元数据"""
    updated_at: str = ""
    name: str = ""
    node_type: str = ""
    file_path: str = ""
    version: int = 0


class SyncProjectRequest(BaseModel):
    """同步项目请求"""
    project_id: str
    force: bool = False       # True = 忽略增量标记，全量重新同步


class SyncProjectResponse(BaseModel):
    """同步项目响应"""
    project_id: str
    synced: int
    skipped: int
    failed: int
    total: int
    elapsed_seconds: float
