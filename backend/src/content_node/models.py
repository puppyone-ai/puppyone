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
    type: str = Field(..., description="节点类型: folder, json, markdown, image, pdf, video, file")
    id_path: str = Field(..., description="ID 物化路径，如 /uuid1/uuid2/uuid3")
    content: Optional[Any] = Field(None, description="JSON 内容（type=json 时）")
    s3_key: Optional[str] = Field(None, description="S3 对象 key（非 JSON 时）")
    mime_type: Optional[str] = Field(None, description="MIME 类型")
    size_bytes: int = Field(0, description="文件大小（字节）")
    permissions: dict = Field(default_factory=lambda: {"inherit": True}, description="权限配置")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")

    class Config:
        from_attributes = True

