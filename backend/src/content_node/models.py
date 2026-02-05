"""Content Node 数据模型"""

from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field


class ContentNode(BaseModel):
    """内容节点模型"""

    id: str = Field(..., description="节点 ID (UUID)")
    user_id: str = Field(..., description="所属用户 ID")
    project_id: str = Field(..., description="所属项目 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示根节点")
    name: str = Field(..., description="节点名称")
    
    # === 新的类型系统 ===
    storage_type: str = Field(..., description="存储类型: folder | json | file | sync")
    source: Optional[str] = Field(None, description="数据来源（仅 sync 类型）: github | notion | gmail | ...")
    resource_type: Optional[str] = Field(None, description="资源类型（仅 sync 类型）: repo | page | database | ...")
    
    # === 旧字段（兼容期保留）===
    type: str = Field(..., description="[废弃] 旧类型字段，迁移期间保留")
    
    id_path: str = Field(..., description="ID 物化路径，如 /uuid1/uuid2/uuid3")
    content: Optional[Any] = Field(None, description="JSON 内容（storage_type=json 时）")
    s3_key: Optional[str] = Field(None, description="S3 对象 key（storage_type=file/sync 时）")
    mime_type: Optional[str] = Field(None, description="MIME 类型")
    size_bytes: int = Field(0, description="文件大小（字节）")
    permissions: dict = Field(default_factory=lambda: {"inherit": True}, description="权限配置")
    
    # 同步相关字段
    sync_url: Optional[str] = Field(None, description="同步来源 URL（仅 sync 类型有值）")
    sync_id: Optional[str] = Field(None, description="外部平台资源 ID（仅 sync 类型有值）")
    sync_config: Optional[dict] = Field(None, description="同步配置（如 mode, interval, account, query 等）")
    sync_status: str = Field(
        default="idle", 
        description="同步状态: not_connected(占位符), idle(空闲), syncing(同步中), error(出错)"
    )
    last_synced_at: Optional[datetime] = Field(None, description="上次同步时间")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    class Config:
        from_attributes = True

    @property
    def is_synced(self) -> bool:
        """判断是否为同步类型"""
        return self.storage_type == "sync"

    @property
    def sync_source(self) -> Optional[str]:
        """获取同步来源（如 github, notion）"""
        return self.source

    @property
    def sync_resource(self) -> Optional[str]:
        """获取资源类型（如 repo, page）"""
        return self.resource_type

    @property
    def is_folder(self) -> bool:
        """判断是否为文件夹"""
        return self.storage_type == "folder"

    @property
    def is_json(self) -> bool:
        """判断是否为 JSON 类型"""
        return self.storage_type == "json"

    @property
    def is_file(self) -> bool:
        """判断是否为文件类型"""
        return self.storage_type == "file"

    @property
    def is_indexable(self) -> bool:
        """判断是否可索引（用于搜索）"""
        # JSON 和 Markdown 文件可索引
        if self.storage_type == "json":
            return True
        if self.storage_type == "file" and self.mime_type == "text/markdown":
            return True
        # 同步的 Markdown 也可索引
        if self.storage_type == "sync" and self.mime_type == "text/markdown":
            return True
        return False
