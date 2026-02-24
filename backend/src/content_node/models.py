"""Content Node 数据模型

Unified Sync Architecture: content_nodes 只负责文件系统语义。
同步相关信息存储在独立的 syncs 表中。
"""

from datetime import datetime
from typing import Optional, Any
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
    """

    id: str = Field(..., description="节点 ID (UUID)")
    project_id: str = Field(..., description="所属项目 ID")
    created_by: Optional[str] = Field(None, description="创建者用户 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示根节点")
    name: str = Field(..., description="节点名称")
    type: str = Field(..., description="节点类型: folder | json | markdown | file")
    id_path: str = Field(..., description="ID 物化路径，如 /uuid1/uuid2/uuid3")
    
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
