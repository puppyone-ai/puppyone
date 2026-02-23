"""
OpenClaw CLI 接入路由

端点设计：
  POST   /api/v1/access/openclaw/connect         — CLI 首次连接
  GET    /api/v1/access/openclaw/pull             — 拉取数据到本地（支持 cursor 增量）
  GET    /api/v1/access/openclaw/changes          — Long Poll：挂起直到有变更或超时
  POST   /api/v1/access/openclaw/push             — 推送 JSON/MD 变更 (API body)
  POST   /api/v1/access/openclaw/upload-url       — 获取 S3 presigned 上传 URL (大文件)
  POST   /api/v1/access/openclaw/confirm-upload   — 确认 S3 上传完成
  GET    /api/v1/access/openclaw/status           — 查询连接状态
  DELETE /api/v1/access/openclaw/disconnect       — 断开连接

认证方式：Header X-Access-Key (cli_xxxx)
"""

from typing import Optional, Any
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse

router = APIRouter(prefix="/api/v1/access/openclaw", tags=["access-openclaw"])


# ============================================================
# Schemas
# ============================================================

class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI 本地工作区路径")


class PushRequest(BaseModel):
    node_id: Optional[str] = Field(default=None, description="目标节点 ID (None = 创建新节点)")
    filename: Optional[str] = Field(default=None, description="文件名 (创建新节点时必填)")
    content: Any
    base_version: int = Field(default=0, description="乐观锁基准版本")
    node_type: str = Field(default="json")


class UploadUrlRequest(BaseModel):
    filename: str = Field(..., description="文件名 (含扩展名)")
    content_type: str = Field(default="application/octet-stream")
    size_bytes: int = Field(default=0, ge=0)
    node_id: Optional[str] = Field(default=None, description="已有节点 ID (更新时传入)")


class ConfirmUploadRequest(BaseModel):
    node_id: str = Field(...)
    size_bytes: int = Field(default=0, ge=0)
    content_hash: Optional[str] = Field(default=None)


# ============================================================
# Dependency: shared SupabaseClient → OpenClawService
# ============================================================

_cached_service = None

def _get_service():
    global _cached_service
    if _cached_service is not None:
        return _cached_service

    from src.access.config.repository import AgentRepository
    from src.sync.repository import SyncSourceRepository, NodeSyncRepository
    from src.sync.changelog import SyncChangelogRepository
    from src.supabase.client import SupabaseClient
    from src.access.openclaw.service import OpenClawService

    supabase = SupabaseClient()
    _cached_service = OpenClawService(
        supabase=supabase,
        agent_repo=AgentRepository(supabase.client),
        source_repo=SyncSourceRepository(supabase),
        node_sync_repo=NodeSyncRepository(supabase),
        changelog_repo=SyncChangelogRepository(supabase),
    )
    return _cached_service


def _auth(access_key: str):
    """Authenticate + refresh heartbeat. Any authenticated request = daemon is alive."""
    svc = _get_service()
    agent = svc.authenticate(access_key)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    svc.touch_heartbeat(agent)
    return agent, svc


# ============================================================
# Endpoints
# ============================================================

@router.post("/connect", response_model=ApiResponse)
async def connect(
    request: ConnectRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """CLI 首次连接：注册 SyncSource，返回 folder_id + 可访问文件列表（无 node_id）。"""
    agent, svc = _auth(x_access_key)
    source = svc.connect(agent, request.workspace_path)

    folder_id = svc._get_home_folder_id(agent)
    if not folder_id:
        raise HTTPException(
            status_code=400,
            detail="Agent has no writable folder configured",
        )

    from src.sync.folder_sync import FolderSyncService
    from src.supabase.client import SupabaseClient
    folder_svc = FolderSyncService(SupabaseClient())
    pull_data = folder_svc.pull(
        project_id=agent.project_id,
        folder_id=folder_id,
        cursor=0,
        source_id=source.id,
    )

    return ApiResponse.success(data={
        "source_id": source.id,
        "agent_id": agent.id,
        "project_id": agent.project_id,
        "folder_id": folder_id,
        **pull_data,
    })


@router.get("/pull", response_model=ApiResponse, deprecated=True)
async def pull(
    x_access_key: str = Header(..., alias="X-Access-Key"),
    cursor: int = Query(0, ge=0, description="Last known cursor; 0 for full sync"),
):
    """
    DEPRECATED: Use GET /api/v1/sync/{folder_id}/pull instead.
    This endpoint exposes node_id; the new endpoint uses filename-only identity.
    """
    agent, svc = _auth(x_access_key)
    data = svc.pull(agent, cursor=cursor)
    return ApiResponse.success(data=data)


@router.get("/changes", response_model=ApiResponse, deprecated=True)
async def long_poll_changes(
    x_access_key: str = Header(..., alias="X-Access-Key"),
    cursor: int = Query(..., ge=0, description="Last known cursor"),
    timeout: int = Query(30, ge=1, le=120, description="Max seconds to wait"),
):
    """
    DEPRECATED: Use GET /api/v1/sync/{folder_id}/changes instead.
    """
    from src.sync.notifier import ChangeNotifier

    agent, svc = _auth(x_access_key)
    notifier = ChangeNotifier.get_instance()

    changed = await notifier.wait_for_changes(agent.project_id, timeout=float(timeout))

    if changed:
        data = svc.pull(agent, cursor=cursor)
        return ApiResponse.success(data={**data, "has_changes": True})

    return ApiResponse.success(data={
        "has_changes": False,
        "cursor": cursor,
        "nodes": [],
        "is_full_sync": False,
        "has_more": False,
    })


@router.post("/push", response_model=ApiResponse, deprecated=True)
async def push(
    request: PushRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """
    DEPRECATED: Use POST /api/v1/sync/{folder_id}/push instead.
    The new endpoint uses filename-only identity (no node_id).
    """
    agent, svc = _auth(x_access_key)
    result = svc.push(
        agent=agent,
        node_id=request.node_id,
        content=request.content,
        base_version=request.base_version,
        node_type=request.node_type,
        filename=request.filename,
    )
    if not result.get("ok"):
        error = result.get("error", "")
        if error == "version_conflict":
            raise HTTPException(status_code=409, detail=result.get("message", "Version conflict"))
        raise HTTPException(status_code=403, detail=result.get("message", "Push failed"))
    return ApiResponse.success(data=result)


@router.post("/upload-url", response_model=ApiResponse, deprecated=True)
async def request_upload_url(
    request: UploadUrlRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """
    DEPRECATED: Use POST /api/v1/sync/{folder_id}/upload-url instead.
    """
    agent, svc = _auth(x_access_key)
    result = svc.request_upload_url(
        agent=agent,
        filename=request.filename,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
        node_id=request.node_id,
    )
    if not result.get("ok"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail=result.get("message", "Upload URL failed"))
    return ApiResponse.success(data=result)


@router.post("/confirm-upload", response_model=ApiResponse, deprecated=True)
async def confirm_upload(
    request: ConfirmUploadRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """
    DEPRECATED: Use POST /api/v1/sync/{folder_id}/confirm-upload instead.
    """
    agent, svc = _auth(x_access_key)
    result = svc.confirm_upload(
        agent=agent,
        node_id=request.node_id,
        size_bytes=request.size_bytes,
        content_hash=request.content_hash,
    )
    if not result.get("ok"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result.get("message", "Confirm failed"))
    return ApiResponse.success(data=result)


@router.get("/status", response_model=ApiResponse)
async def status(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """查询 CLI 连接状态（前端轮询用）。"""
    agent, svc = _auth(x_access_key)
    data = svc.status(agent)
    return ApiResponse.success(data=data)


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
