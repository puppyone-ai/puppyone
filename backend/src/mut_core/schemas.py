"""
Mut Core — 数据模型

PuppyOne 平台层使用的数据类型。
"""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional, Any


class WriteResult(BaseModel):
    """MutWriteService 写操作的返回结果"""
    node_id: str
    version: int
    content_hash: str
    root_hash: str
    path: str
    op: str  # "added" | "modified"
    conflicts: list[dict] = []


class DeleteResult(BaseModel):
    node_id: str
    version: int
    root_hash: str
    path: str


class MoveResult(BaseModel):
    node_id: str
    version: int
    root_hash: str
    old_path: str
    new_path: str
