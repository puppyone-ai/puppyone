"""DB Connector API Schemas"""

from typing import Any, Optional, List
from pydantic import BaseModel, Field


# === Request ===

class CreateConnectionRequest(BaseModel):
    """创建连接请求"""
    name: str = Field(..., description="连接名称", examples=["My Supabase"])
    provider: str = Field("supabase", description="数据库类型", examples=["supabase"])
    project_url: str = Field(..., description="Supabase Project URL", examples=["https://abcdefg.supabase.co"])
    service_role_key: str = Field(..., description="Supabase Service Role Key")

    def to_config(self) -> dict:
        return {
            "project_url": self.project_url,
            "service_role_key": self.service_role_key,
        }


class SaveTableRequest(BaseModel):
    """保存整张表到项目"""
    name: str = Field(..., description="保存名称", examples=["users"])
    table: str = Field(..., description="表名")
    limit: int = Field(1000, ge=1, le=10000, description="最大行数")


# === Response ===

class ConnectionResponse(BaseModel):
    id: str
    name: str
    provider: str
    project_id: str
    is_active: bool
    last_used_at: Optional[str] = None
    created_at: str


class ConnectionCreatedResponse(BaseModel):
    connection: ConnectionResponse
    database_info: dict


class TableInfoResponse(BaseModel):
    name: str
    type: str
    columns: List[dict] = Field(default_factory=list)


class TablePreviewResponse(BaseModel):
    """表数据预览"""
    columns: List[str]
    rows: List[dict[str, Any]]
    row_count: int
    execution_time_ms: float


class SaveResultResponse(BaseModel):
    content_node_id: str
    row_count: int
