"""
OpenClaw CLI 接入路由

端点设计：
  POST   /api/v1/access/openclaw/connect   — CLI 首次连接
  GET    /api/v1/access/openclaw/pull       — 拉取数据到本地
  POST   /api/v1/access/openclaw/push       — 推送变更到 PuppyOne
  DELETE /api/v1/access/openclaw/disconnect — 断开连接

认证方式：Header X-Access-Key (cli_xxxx)
"""

from typing import Optional, List, Any
from fastapi import APIRouter, Header, HTTPException

from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse

router = APIRouter(prefix="/api/v1/access/openclaw", tags=["access-openclaw"])


# ============================================================
# Schemas
# ============================================================

class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI 本地工作区路径")


class PushRequest(BaseModel):
    node_id: str
    content: Any
    base_version: int = Field(default=0, description="乐观锁基准版本")
    node_type: str = Field(default="json")


# ============================================================
# Dependency: access key → Agent
# ============================================================

def _get_service():
    from src.access.config.repository import AgentRepository
    from src.sync.repository import SyncSourceRepository, NodeSyncRepository
    from src.supabase.client import SupabaseClient
    from src.access.openclaw.service import OpenClawService

    supabase = SupabaseClient()
    return OpenClawService(
        agent_repo=AgentRepository(supabase),
        source_repo=SyncSourceRepository(supabase),
        node_sync_repo=NodeSyncRepository(supabase),
    )


def _auth(access_key: str):
    svc = _get_service()
    agent = svc.authenticate(access_key)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    return agent, svc


# ============================================================
# Endpoints
# ============================================================

@router.post("/connect", response_model=ApiResponse)
async def connect(
    request: ConnectRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """CLI 首次连接：注册 SyncSource，返回可访问的节点列表。"""
    agent, svc = _auth(x_access_key)
    source = svc.connect(agent, request.workspace_path)
    pull_data = svc.pull(agent)
    return ApiResponse.success(data={
        "source_id": source.id,
        "agent_id": agent.id,
        "project_id": agent.project_id,
        **pull_data,
    })


@router.get("/pull", response_model=ApiResponse)
async def pull(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """拉取 Agent 可访问的最新节点数据。"""
    agent, svc = _auth(x_access_key)
    data = svc.pull(agent)
    return ApiResponse.success(data=data)


@router.post("/push", response_model=ApiResponse)
async def push(
    request: PushRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """推送单个节点变更（经 CollaborationService 版本管理）。"""
    agent, svc = _auth(x_access_key)
    result = svc.push(
        agent=agent,
        node_id=request.node_id,
        content=request.content,
        base_version=request.base_version,
        node_type=request.node_type,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=403, detail=result.get("message", "Push failed"))
    return ApiResponse.success(data=result)


@router.delete("/disconnect", response_model=ApiResponse)
async def disconnect(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """断开 CLI 连接。"""
    agent, svc = _auth(x_access_key)
    ok = svc.disconnect(agent)
    if not ok:
        return ApiResponse.success(data={"message": "No active connection found"})
    return ApiResponse.success(data={"message": "Disconnected", "agent_id": agent.id})
