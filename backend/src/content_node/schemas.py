"""Content Node API Schemas"""

from typing import Optional, Any, List
from pydantic import BaseModel, Field


# === 请求 Schemas ===

class CreateFolderRequest(BaseModel):
    """创建文件夹请求"""
    name: str = Field(..., description="文件夹名称")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示根目录")


class CreateJsonNodeRequest(BaseModel):
    """创建 JSON 节点请求"""
    name: str = Field(..., description="节点名称")
    parent_id: Optional[str] = Field(None, description="父节点 ID")
    content: Any = Field(default_factory=dict, description="JSON 内容")


class UpdateNodeRequest(BaseModel):
    """更新节点请求"""
    name: Optional[str] = Field(None, description="新名称")
    content: Optional[Any] = Field(None, description="新内容（仅 JSON 类型）")


class MoveNodeRequest(BaseModel):
    """移动节点请求"""
    new_parent_id: Optional[str] = Field(None, description="新的父节点 ID，None 表示移动到根目录")


# === 响应 Schemas ===

class NodeInfo(BaseModel):
    """节点基本信息（用于列表）"""
    id: str
    name: str
    type: str
    path: str
    parent_id: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: int = 0
    created_at: str
    updated_at: str


class NodeDetail(NodeInfo):
    """节点详情（包含内容）"""
    content: Optional[Any] = None
    s3_key: Optional[str] = None
    permissions: dict = Field(default_factory=lambda: {"inherit": True})


class NodeListResponse(BaseModel):
    """节点列表响应"""
    nodes: List[NodeInfo]
    total: int


class UploadUrlResponse(BaseModel):
    """上传 URL 响应"""
    node_id: str
    upload_url: str
    s3_key: str


class DownloadUrlResponse(BaseModel):
    """下载 URL 响应"""
    download_url: str
    expires_in: int = 3600

