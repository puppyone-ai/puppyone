"""Content Node 数据模型"""

from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field


class ContentNode(BaseModel):
    """
    内容节点模型
    
    type 字段（5种）:
      - folder: 文件夹
      - json: JSON 内容（存在 preview_json）
      - markdown: Markdown 内容（存在 preview_md）
      - file: 文件（存在 s3_key）
      - sync: 外部同步（source 字段有值）
    
    preview_type 字段:
      - json: 有 preview_json 可预览
      - markdown: 有 preview_md 可预览
      - NULL: 无预览内容
    
    所有权字段：
      - project_id: 所属项目（核心字段）
      - created_by: 创建者用户 ID（仅记录，不用于权限控制）
      - sync_oauth_user_id: 同步绑定的 OAuth 用户（仅 sync 类型）
    """

    id: str = Field(..., description="节点 ID (UUID)")
    project_id: str = Field(..., description="所属项目 ID")
    created_by: Optional[str] = Field(None, description="创建者用户 ID（仅记录）")
    sync_oauth_user_id: Optional[str] = Field(None, description="同步绑定的 OAuth 用户 ID（仅 sync 类型必填）")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示根节点")
    name: str = Field(..., description="节点名称")
    
    # === 类型字段 ===
    type: str = Field(..., description="节点类型: folder | json | markdown | file | sync")
    source: Optional[str] = Field(None, description="数据来源（仅 sync 类型）: github | notion | gmail | google_calendar | ...")
    preview_type: Optional[str] = Field(None, description="可预览内容类型: json | markdown | NULL")
    
    id_path: str = Field(..., description="ID 物化路径，如 /uuid1/uuid2/uuid3")
    
    # === 内容字段 ===
    preview_json: Optional[Any] = Field(None, description="JSON 格式的预览内容（type=json 或 sync 时）")
    preview_md: Optional[str] = Field(None, description="Markdown 格式的预览内容（type=markdown 时）")
    s3_key: Optional[str] = Field(None, description="S3 对象 key（type=file 或 sync 时的二进制文件）")
    
    mime_type: Optional[str] = Field(None, description="MIME 类型")
    size_bytes: int = Field(0, description="文件大小（字节）")
    permissions: dict = Field(default_factory=lambda: {"inherit": True}, description="权限配置")
    
    # 同步相关字段（仅 type=sync 时有值）
    sync_url: Optional[str] = Field(None, description="同步来源 URL")
    sync_id: Optional[str] = Field(None, description="外部平台资源 ID")
    sync_config: Optional[dict] = Field(None, description="同步配置")
    sync_status: str = Field(
        default="idle", 
        description="同步状态: not_connected(占位符), idle(空闲), syncing(同步中), error(出错)"
    )
    last_synced_at: Optional[datetime] = Field(None, description="上次同步时间")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    model_config = ConfigDict(from_attributes=True)

    @property
    def is_synced(self) -> bool:
        """判断是否为同步类型"""
        return self.type == "sync"

    @property
    def sync_source(self) -> Optional[str]:
        """获取同步来源（如 github, notion）"""
        return self.source if self.type == "sync" else None

    @property
    def is_folder(self) -> bool:
        """判断是否为文件夹"""
        return self.type == "folder"

    @property
    def is_json(self) -> bool:
        """判断是否为 JSON 类型"""
        return self.type == "json"

    @property
    def is_markdown(self) -> bool:
        """判断是否为 Markdown 类型"""
        return self.type == "markdown"

    @property
    def is_file(self) -> bool:
        """判断是否为文件类型"""
        return self.type == "file"

    @property
    def has_preview(self) -> bool:
        """判断是否有预览内容"""
        return self.preview_type is not None

    @property
    def is_indexable(self) -> bool:
        """判断是否可索引（用于搜索）"""
        # JSON 和 Markdown 可索引
        return self.type in ("json", "markdown") or self.preview_type in ("json", "markdown")
