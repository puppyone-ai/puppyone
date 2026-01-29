"""Content Node API Schemas"""

from typing import Optional, Any, List
from pydantic import BaseModel, Field


# === 请求 Schemas ===

class CreateFolderRequest(BaseModel):
    """创建文件夹请求"""
    name: str = Field(..., description="文件夹名称")
    project_id: str = Field(..., description="所属项目 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID，None 表示项目根目录")


class CreateJsonNodeRequest(BaseModel):
    """创建 JSON 节点请求"""
    name: str = Field(..., description="节点名称")
    project_id: str = Field(..., description="所属项目 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID")
    content: Any = Field(default_factory=dict, description="JSON 内容")


class CreateMarkdownNodeRequest(BaseModel):
    """创建 Markdown 节点请求"""
    name: str = Field(..., description="节点名称")
    project_id: str = Field(..., description="所属项目 ID")
    parent_id: Optional[str] = Field(None, description="父节点 ID")
    content: str = Field(default="", description="Markdown 内容")


class UpdateNodeRequest(BaseModel):
    """更新节点请求"""
    name: Optional[str] = Field(None, description="新名称")
    content: Optional[Any] = Field(None, description="新内容（仅 JSON 类型）")


class MoveNodeRequest(BaseModel):
    """移动节点请求"""
    new_parent_id: Optional[str] = Field(None, description="新的父节点 ID，None 表示移动到根目录")


# === 批量创建 Schemas ===

class BulkCreateNodeItem(BaseModel):
    """批量创建中的单个节点"""
    temp_id: str = Field(..., description="临时 ID（用于建立父子关系引用）")
    name: str = Field(..., description="节点名称")
    type: str = Field(..., description="节点类型: folder, json, markdown, pending")
    parent_temp_id: Optional[str] = Field(None, description="父节点的临时 ID，None 表示根节点")
    content: Optional[Any] = Field(None, description="内容（type=json/markdown 时）")


class BulkCreateRequest(BaseModel):
    """批量创建节点请求"""
    project_id: str = Field(..., description="所属项目 ID")
    parent_id: Optional[str] = Field(None, description="整体挂载到哪个父节点下，None 表示项目根目录")
    nodes: List[BulkCreateNodeItem] = Field(..., description="要创建的节点列表")


class BulkCreateResultItem(BaseModel):
    """批量创建的单个结果"""
    temp_id: str = Field(..., description="原始临时 ID")
    node_id: str = Field(..., description="真实节点 ID")
    name: str = Field(..., description="节点名称")
    type: str = Field(..., description="节点类型")


class BulkCreateResponse(BaseModel):
    """批量创建响应"""
    created: List[BulkCreateResultItem] = Field(..., description="创建的节点列表")
    total: int = Field(..., description="创建的总数")


# === 响应 Schemas ===

class NodeInfo(BaseModel):
    """节点基本信息（用于列表）"""
    id: str
    name: str
    type: str
    project_id: str
    id_path: str
    parent_id: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: int = 0
    # 同步相关字段
    sync_url: Optional[str] = None
    sync_id: Optional[str] = None
    last_synced_at: Optional[str] = None
    # 计算属性
    is_synced: bool = False  # 是否为同步类型
    sync_source: Optional[str] = None  # 同步来源（如 github, notion）
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

