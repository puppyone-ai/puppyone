"""
Backward-compatibility re-export.

New canonical location: src.sync.providers.openclaw.router
New endpoint prefix: /api/v1/sync/openclaw/

This file keeps the old /api/v1/access/openclaw/ prefix working for
existing CLI versions during the migration period.
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse

router = APIRouter(prefix="/api/v1/access/openclaw", tags=["access-openclaw-compat"])


class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI 本地工作区路径")


def _get_service():
    from src.sync.providers.openclaw.router import _get_service as _real
    return _real()


def _auth(access_key: str):
    svc = _get_service()
    agent = svc.authenticate(access_key)
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    svc.touch_heartbeat(agent)
    return agent, svc


@router.post("/connect", response_model=ApiResponse, deprecated=True)
async def connect(
    request: ConnectRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """DEPRECATED: Use POST /api/v1/sync/openclaw/connect instead."""
    agent, svc = _auth(x_access_key)
    source = svc.connect(agent, request.workspace_path)

    folder_id = svc.get_home_folder_id(agent)
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


@router.get("/status", response_model=ApiResponse, deprecated=True)
async def status(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """DEPRECATED: Use GET /api/v1/sync/openclaw/status instead."""
    agent, svc = _auth(x_access_key)
    data = svc.status(agent)
    return ApiResponse.success(data=data)


@router.delete("/disconnect", response_model=ApiResponse, deprecated=True)
async def disconnect(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """DEPRECATED: Use DELETE /api/v1/sync/openclaw/disconnect instead."""
    agent, svc = _auth(x_access_key)
    ok = svc.disconnect(agent)
    if not ok:
        return ApiResponse.success(data={"message": "No active connection found"})
    return ApiResponse.success(data={"message": "Disconnected", "agent_id": agent.id})
