"""Content Node 数据模型

Unified Sync Architecture: content_nodes 只负责文件系统语义。
同步相关信息存储在独立的 syncs 表中。

Tree Structure: id_path 是层级关系的唯一 Source of Truth。
parent_id 作为冗余字段维护（用于 UNIQUE 约束和向后兼容）。
"""

from datetime import datetime
from typing import Optional, Any, List
from pydantic import BaseModel, ConfigDict, Field


class ContentNode(BaseModel):
    """
    内容节点模型（纯文件系统语义）
    
    type 字段（仅 4 种原生类型）:
      - folder: 文件夹
      - json: JSON 内容
      - markdown: Markdown 内容
      - file: 文件
    
    存储位置（由字段是否有值决定，可同时存在多个）:
      - preview_json IS NOT NULL → 有 JSON 数据
      - preview_md IS NOT NULL → 有 Markdown 数据
      - s3_key IS NOT NULL → 有 S3 文件
    
    层级结构:
      - id_path: 唯一 Source of Truth（如 /uuid1/uuid2/uuid3）
      - depth: 由 id_path 自动计算的 generated column
      - parent_id: 冗余字段，由 move_node_atomic 原子维护
    """

    id: str = Field(..., description="节点 ID (UUID)")
    project_id: str = Field(..., description="所属项目 ID")
    created_by: Optional[str] = Field(None, description="创建者用户 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID（冗余，由 id_path 派生）")
    name: str = Field(..., description="节点名称")
    type: str = Field(..., description="节点类型: folder | json | markdown | file")
    id_path: str = Field(..., description="ID 物化路径（Source of Truth），如 /uuid1/uuid2/uuid3")
    depth: int = Field(1, description="树深度（generated column，从 id_path 自动计算）")
    
    preview_json: Optional[Any] = Field(None, description="JSON 内容")
    preview_md: Optional[str] = Field(None, description="Markdown 内容")
    s3_key: Optional[str] = Field(None, description="S3 对象 key")
    
    mime_type: Optional[str] = Field(None, description="MIME 类型")
    size_bytes: int = Field(0, description="文件大小（字节）")
    permissions: dict = Field(default_factory=lambda: {"inherit": True}, description="权限配置")
    
    current_version: int = Field(0, description="当前版本号（乐观锁）")
    content_hash: Optional[str] = Field(None, description="当前内容 SHA-256 哈希")
    
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    model_config = ConfigDict(from_attributes=True)

    # === id_path 工具属性 ===

    @property
    def ancestor_ids(self) -> List[str]:
        """从 id_path 解析出所有祖先 ID（从根到自身）。"""
        return [s for s in self.id_path.strip("/").split("/") if s]

    @property
    def parent_id_from_path(self) -> Optional[str]:
        """从 id_path 推导出父节点 ID（Source of Truth）。"""
        ids = self.ancestor_ids
        return ids[-2] if len(ids) >= 2 else None

    # === 类型判断 ===

    @property
    def is_folder(self) -> bool:
        return self.type == "folder"

    @property
    def is_json(self) -> bool:
        return self.type == "json"

    @property
    def is_markdown(self) -> bool:
        return self.type == "markdown"

    @property
    def is_file(self) -> bool:
        return self.type == "file"

    @property
    def has_preview(self) -> bool:
        return self.preview_json is not None or self.preview_md is not None

    @property
    def is_indexable(self) -> bool:
        return self.type in ("json", "markdown") or self.preview_json is not None or self.preview_md is not None
