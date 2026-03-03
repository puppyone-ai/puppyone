"""
OpenClaw CLI 连接生命周期路由

端点设计：
  POST   /api/v1/sync/openclaw/connect         — CLI 首次连接
  GET    /api/v1/sync/openclaw/status           — 查询连接状态
  DELETE /api/v1/sync/openclaw/disconnect       — 断开连接

认证方式：Header X-Access-Key (cli_xxxx) → syncs.access_key

数据同步端点在 /api/v1/sync/{folder_id}/ (folder_router.py)
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse

router = APIRouter(prefix="/api/v1/sync/openclaw", tags=["sync-openclaw"])


# ============================================================
# Schemas
# ============================================================

class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI 本地工作区路径")


# ============================================================
# Dependency
# ============================================================

_cached_service = None

def _get_service():
    global _cached_service
    if _cached_service is not None:
        return _cached_service

    from src.sync.repository import SyncRepository
    from src.supabase.client import SupabaseClient
    from src.sync.connectors.filesystem.lifecycle import OpenClawService

    supabase = SupabaseClient()
    _cached_service = OpenClawService(
        supabase=supabase,
        sync_repo=SyncRepository(supabase),
    )
    return _cached_service


def _auth(access_key: str):
    """Authenticate via syncs.access_key → Sync object."""
    svc = _get_service()
    sync = svc.authenticate(access_key)
    if not sync:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    svc.touch_heartbeat(sync)
    return sync, svc


# ============================================================
# Endpoints
# ============================================================

@router.post("/connect", response_model=ApiResponse)
async def connect(
    request: ConnectRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """CLI 首次连接：更新 workspace_path，返回 folder_id + 文件列表。"""
    sync, svc = _auth(x_access_key)
    svc.connect(sync, request.workspace_path)

    folder_id = sync.node_id
    if not folder_id:
        raise HTTPException(
            status_code=400,
            detail="Sync endpoint has no folder bound",
        )

    from src.sync.folder_sync import FolderSyncService
    from src.supabase.client import SupabaseClient
    folder_svc = FolderSyncService(SupabaseClient())
    pull_data = folder_svc.pull(
        project_id=sync.project_id,
        folder_id=folder_id,
        cursor=0,
        source_id=sync.id,
    )

    return ApiResponse.success(data={
        "sync_id": sync.id,
        "project_id": sync.project_id,
        "folder_id": folder_id,
        **pull_data,
    })


@router.get("/status", response_model=ApiResponse)
async def status(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """查询 CLI 连接状态（前端轮询用）。"""
    sync, svc = _auth(x_access_key)
    data = svc.status(sync)
    return ApiResponse.success(data=data)


@router.delete("/disconnect", response_model=ApiResponse)
async def disconnect(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """断开 CLI 连接。"""
    sync, svc = _auth(x_access_key)
    ok = svc.disconnect(sync)
    if not ok:
        return ApiResponse.success(data={"message": "No active connection found"})
    return ApiResponse.success(data={"message": "Disconnected", "sync_id": sync.id})
