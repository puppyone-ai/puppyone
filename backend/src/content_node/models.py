"""Content Node 数据模型"""

from datetime import datetime
from typing import Optional, Any, ClassVar, Set
from pydantic import BaseModel, ConfigDict, Field


class ContentNode(BaseModel):
    """
    内容节点模型
    
    type 字段（可扩展，不限制值）:
      原生类型:
        - folder: 文件夹
        - json: JSON 内容
        - markdown: Markdown 内容
        - file: 文件
      同步类型（从外部平台导入）:
        - github: GitHub
        - notion: Notion
        - gmail: Gmail
        - google_calendar: Google Calendar
        - google_sheets: Google Sheets
        - google_drive: Google Drive
        - airtable: Airtable
        - linear: Linear
        - ... (可无限扩展)
    
    type 直接决定前端如何渲染和展示编辑器。
    具体的导入类型（如 issue/project/repo）存储在 sync_config.import_type 中。
    
    存储位置（由字段是否有值决定，可同时存在多个）:
      - preview_json IS NOT NULL → 有 JSON 数据
      - preview_md IS NOT NULL → 有 Markdown 数据
      - s3_key IS NOT NULL → 有 S3 文件
    
    所有权字段：
      - project_id: 所属项目（核心字段）
      - created_by: 创建者用户 ID（仅记录）
      - sync_oauth_user_id: 同步绑定的 OAuth 用户（非原生类型必填）
    """
    
    # 原生类型列表（用于判断是否为同步类型）
    NATIVE_TYPES: ClassVar[Set[str]] = {'folder', 'json', 'markdown', 'file'}

    id: str = Field(..., description="节点 ID (UUID)")
    project_id: str = Field(..., description="所属项目 ID")
    created_by: Optional[str] = Field(None, description="创建者用户 ID（仅记录）")
    sync_oauth_user_id: Optional[str] = Field(None, description="同步绑定的 OAuth 用户 ID（非原生类型必填）")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示根节点")
    name: str = Field(..., description="节点名称")
    
    # === 类型字段 ===
    type: str = Field(..., description="节点类型: folder | json | markdown | file | github_repo | notion_page | ...")
    
    id_path: str = Field(..., description="ID 物化路径，如 /uuid1/uuid2/uuid3")
    
    # === 内容字段 ===
    preview_json: Optional[Any] = Field(None, description="JSON 格式的预览内容（type=json 或 sync 时）")
    preview_md: Optional[str] = Field(None, description="Markdown 格式的预览内容（type=markdown 时）")
    s3_key: Optional[str] = Field(None, description="S3 对象 key（type=file 或 sync 时的二进制文件）")
    
    mime_type: Optional[str] = Field(None, description="MIME 类型")
    size_bytes: int = Field(0, description="文件大小（字节）")
    permissions: dict = Field(default_factory=lambda: {"inherit": True}, description="权限配置")
    
    # === 版本管理字段 ===
    current_version: int = Field(0, description="当前版本号（乐观锁）")
    content_hash: Optional[str] = Field(None, description="当前内容 SHA-256 哈希")
    
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
        """判断是否为同步类型（非原生类型都是同步类型）"""
        return self.type not in self.NATIVE_TYPES

    @property
    def sync_source(self) -> Optional[str]:
        """获取同步来源（简化后 type 本身就是来源）"""
        if not self.is_synced:
            return None
        # 简化后的架构：type 直接就是来源（github, notion, google_calendar 等）
        return self.type

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
        """判断是否有预览内容（检查 preview_json 或 preview_md 是否有值）"""
        return self.preview_json is not None or self.preview_md is not None

    @property
    def is_indexable(self) -> bool:
        """判断是否可索引（用于搜索）"""
        # JSON 和 Markdown 可索引（检查字段是否有值）
        return self.type in ("json", "markdown") or self.preview_json is not None or self.preview_md is not None
