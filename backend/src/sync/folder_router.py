"""
Folder-level sync router — /api/v1/sync/{folder_id}/

Generic file sync protocol used by CLI daemon, sandbox containers, etc.
All endpoints use filename as identity — no node_id exposed.

Auth: X-Access-Key header.
"""

from typing import Optional, Any
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.common_schemas import ApiResponse

router = APIRouter(prefix="/api/v1/sync", tags=["folder-sync"])


# ============================================================
# Schemas
# ============================================================

class PushRequest(BaseModel):
    filename: str = Field(..., description="File name (e.g. 'notes.md')")
    content: Any
    base_version: int = Field(default=0)
    node_type: str = Field(default="json")


class UploadUrlRequest(BaseModel):
    filename: str = Field(..., description="File name with extension")
    content_type: str = Field(default="application/octet-stream")
    size_bytes: int = Field(default=0, ge=0)


class ConfirmUploadRequest(BaseModel):
    filename: str = Field(..., description="File name with extension")
    size_bytes: int = Field(default=0, ge=0)
    content_hash: Optional[str] = Field(default=None)


# ============================================================
# Service singletons
# ============================================================

_cached_svc = None
_cached_deps = None


def _get_services():
    global _cached_svc, _cached_deps
    if _cached_svc is not None:
        return _cached_svc, _cached_deps

    from src.supabase.client import SupabaseClient
    from src.access.config.repository import AgentRepository
    from src.sync.repository import SyncSourceRepository
    from src.sync.folder_sync import FolderSyncService

    supabase = SupabaseClient()
    _cached_svc = FolderSyncService(supabase)
    _cached_deps = {
        "agent_repo": AgentRepository(supabase.client),
        "source_repo": SyncSourceRepository(supabase),
    }
    return _cached_svc, _cached_deps


def _auth(access_key: str, folder_id: str):
    """Authenticate access key, verify folder access, refresh heartbeat."""
    svc, deps = _get_services()

    agent = deps["agent_repo"].get_by_mcp_api_key(access_key)
    if not agent or agent.type != "devbox":
        raise HTTPException(status_code=401, detail="Invalid or expired access key")

    bash_list = deps["agent_repo"].get_bash_by_agent_id(agent.id)
    folder_ids = {b.node_id for b in bash_list}
    if folder_id not in folder_ids:
        raise HTTPException(
            status_code=403, detail="No access to this folder",
        )

    source = deps["source_repo"].find_active_by_config_key(
        "openclaw", "agent_id", agent.id,
    )
    if source:
        deps["source_repo"].touch_heartbeat(source.id)

    return agent, source, svc


# ============================================================
# Endpoints
# ============================================================

@router.get("/{folder_id}/pull", response_model=ApiResponse)
async def pull(
    folder_id: str,
    x_access_key: str = Header(..., alias="X-Access-Key"),
    cursor: int = Query(0, ge=0),
):
    """
    Pull files from cloud folder.

    cursor=0 → full sync (all files + current cursor)
    cursor>0 → incremental (only changes since cursor)
    """
    agent, source, svc = _auth(x_access_key, folder_id)
    data = svc.pull(
        project_id=agent.project_id,
        folder_id=folder_id,
        cursor=cursor,
        source_id=source.id if source else None,
    )
    return ApiResponse.success(data=data)


@router.get("/{folder_id}/changes", response_model=ApiResponse)
async def long_poll_changes(
    folder_id: str,
    x_access_key: str = Header(..., alias="X-Access-Key"),
    cursor: int = Query(..., ge=0),
    timeout: int = Query(30, ge=1, le=120),
):
    """Long Poll: block until changes or timeout."""
    from src.sync.notifier import ChangeNotifier

    agent, source, svc = _auth(x_access_key, folder_id)
    notifier = ChangeNotifier.get_instance()

    changed = await notifier.wait_for_changes(
        agent.project_id, timeout=float(timeout),
    )

    if changed:
        data = svc.pull(
            project_id=agent.project_id,
            folder_id=folder_id,
            cursor=cursor,
            source_id=source.id if source else None,
        )
        return ApiResponse.success(data={**data, "has_changes": True})

    return ApiResponse.success(data={
        "has_changes": False,
        "cursor": cursor,
        "files": [],
        "is_full_sync": False,
        "has_more": False,
    })


@router.post("/{folder_id}/push", response_model=ApiResponse)
async def push(
    folder_id: str,
    request: PushRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """
    Push a file. Backend auto-detects create vs update by name lookup.
    No node_id needed — just send filename + content.
    """
    agent, source, svc = _auth(x_access_key, folder_id)
    result = svc.push(
        project_id=agent.project_id,
        folder_id=folder_id,
        filename=request.filename,
        content=request.content,
        base_version=request.base_version,
        node_type=request.node_type,
        operator_id=agent.id,
        operator_name=agent.name,
        source_id=source.id if source else None,
    )
    if not result.get("ok"):
        error = result.get("error", "")
        if error == "version_conflict":
            raise HTTPException(
                status_code=409,
                detail=result.get("message", "Version conflict"),
            )
        raise HTTPException(
            status_code=403,
            detail=result.get("message", "Push failed"),
        )
    return ApiResponse.success(data=result)


@router.delete("/{folder_id}/file/{filename:path}", response_model=ApiResponse)
async def delete_file(
    folder_id: str,
    filename: str,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """Delete a file by name."""
    agent, source, svc = _auth(x_access_key, folder_id)
    result = svc.delete_file(
        project_id=agent.project_id,
        folder_id=folder_id,
        filename=filename,
        source_id=source.id if source else None,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=404,
            detail=result.get("message", "Delete failed"),
        )
    return ApiResponse.success(data=result)


@router.post("/{folder_id}/upload-url", response_model=ApiResponse)
async def request_upload_url(
    folder_id: str,
    request: UploadUrlRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """Get S3 presigned upload URL for large files."""
    agent, source, svc = _auth(x_access_key, folder_id)
    result = svc.request_upload_url(
        project_id=agent.project_id,
        folder_id=folder_id,
        filename=request.filename,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
        operator_id=agent.id,
        source_id=source.id if source else None,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=403,
            detail=result.get("message", "Upload URL failed"),
        )
    return ApiResponse.success(data=result)


@router.post("/{folder_id}/confirm-upload", response_model=ApiResponse)
async def confirm_upload(
    folder_id: str,
    request: ConfirmUploadRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """Confirm S3 upload complete — creates version record + changelog entry."""
    agent, source, svc = _auth(x_access_key, folder_id)
    result = svc.confirm_upload(
        project_id=agent.project_id,
        folder_id=folder_id,
        filename=request.filename,
        size_bytes=request.size_bytes,
        operator_id=agent.id,
        operator_name=agent.name,
        content_hash=request.content_hash,
        source_id=source.id if source else None,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "Confirm failed"),
        )
    return ApiResponse.success(data=result)
