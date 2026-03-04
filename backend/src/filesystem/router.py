"""
Filesystem Module — HTTP Endpoints

Consolidated router for all filesystem/OpenClaw operations:

Lifecycle (JWT auth):
  POST   /api/v1/filesystem/bootstrap                Create filesystem sync for a folder
  GET    /api/v1/filesystem/{sync_id}/connection-status  Poll CLI connection status

CLI daemon (X-Access-Key auth):
  POST   /api/v1/filesystem/connect                  CLI first connect
  GET    /api/v1/filesystem/status                   CLI connection status
  DELETE /api/v1/filesystem/disconnect               CLI disconnect

Data sync (X-Access-Key auth):
  GET    /api/v1/filesystem/{folder_id}/pull          Pull files
  GET    /api/v1/filesystem/{folder_id}/changes       Long-poll for changes
  POST   /api/v1/filesystem/{folder_id}/push          Push a file
  DELETE /api/v1/filesystem/{folder_id}/file/{name}   Delete a file
  POST   /api/v1/filesystem/{folder_id}/upload-url    Get S3 presigned upload URL
  POST   /api/v1/filesystem/{folder_id}/confirm-upload Confirm S3 upload
"""

from typing import Optional, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.project.dependencies import get_project_service
from src.project.service import ProjectService

router = APIRouter(prefix="/api/v1/filesystem", tags=["filesystem"])


# ============================================================
# Schemas
# ============================================================

class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI local workspace path")


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
# Service singletons (lazy init)
# ============================================================

_cached_lifecycle_svc = None
_cached_folder_svc = None
_cached_sync_repo = None


def _get_lifecycle_service():
    global _cached_lifecycle_svc
    if _cached_lifecycle_svc is not None:
        return _cached_lifecycle_svc

    from src.sync.repository import SyncRepository
    from src.supabase.client import SupabaseClient
    from src.filesystem.lifecycle import OpenClawService

    supabase = SupabaseClient()
    _cached_lifecycle_svc = OpenClawService(
        supabase=supabase,
        sync_repo=SyncRepository(supabase),
    )
    return _cached_lifecycle_svc


def _get_folder_services():
    global _cached_folder_svc, _cached_sync_repo
    if _cached_folder_svc is not None:
        return _cached_folder_svc, _cached_sync_repo

    from src.supabase.client import SupabaseClient
    from src.sync.repository import SyncRepository
    from src.filesystem.service import FolderSyncService

    supabase = SupabaseClient()
    _cached_folder_svc = FolderSyncService(supabase)
    _cached_sync_repo = SyncRepository(supabase)
    return _cached_folder_svc, _cached_sync_repo


# ============================================================
# Auth helpers
# ============================================================

def _auth_access_key(access_key: str):
    """Authenticate via syncs.access_key → Sync object (for CLI daemon)."""
    svc = _get_lifecycle_service()
    sync = svc.authenticate(access_key)
    if not sync:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    svc.touch_heartbeat(sync)
    return sync, svc


def _auth_folder(access_key: str, folder_id: str):
    """Authenticate via syncs.access_key, verify folder access."""
    svc, sync_repo = _get_folder_services()
    sync = sync_repo.get_by_access_key(access_key)
    if not sync or sync.provider != "filesystem":
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    if sync.node_id != folder_id:
        raise HTTPException(status_code=403, detail="No access to this folder")
    sync_repo.touch_heartbeat(sync.id)
    return sync, svc


def _ensure_project_access(project_service: ProjectService, current_user: CurrentUser, project_id: str):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ============================================================
# Lifecycle endpoints (JWT auth — used by web frontend)
# ============================================================

@router.post("/bootstrap", response_model=ApiResponse)
def bootstrap(
    project_id: str = Query(...),
    node_id: str = Query(...),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create a filesystem sync endpoint for a folder. Returns sync with access_key."""
    _ensure_project_access(project_service, current_user, project_id)

    svc = _get_lifecycle_service()
    sync = svc.bootstrap(project_id=project_id, node_id=node_id)
    return ApiResponse.success(data={
        "sync_id": sync.id,
        "access_key": sync.access_key,
        "node_id": sync.node_id,
        "project_id": sync.project_id,
    })


@router.get("/{sync_id}/connection-status", response_model=ApiResponse)
def get_connection_status(
    sync_id: str,
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Poll CLI connection status for a filesystem sync endpoint."""
    _, sync_repo = _get_folder_services()
    sync = sync_repo.get_by_id(sync_id)
    if not sync or sync.provider != "filesystem":
        return ApiResponse.success(data={"connected": False})

    _ensure_project_access(project_service, current_user, sync.project_id)

    svc = _get_lifecycle_service()
    data = svc.status(sync)
    return ApiResponse.success(data=data)


# ============================================================
# CLI daemon endpoints (X-Access-Key auth)
# ============================================================

@router.post("/connect", response_model=ApiResponse)
async def connect(
    request: ConnectRequest,
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """CLI first connect: update workspace_path, return folder_id + file list."""
    sync, svc = _auth_access_key(x_access_key)
    svc.connect(sync, request.workspace_path)

    folder_id = sync.node_id
    if not folder_id:
        raise HTTPException(
            status_code=400,
            detail="Sync endpoint has no folder bound",
        )

    from src.filesystem.service import FolderSyncService
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
    """Query CLI connection status."""
    sync, svc = _auth_access_key(x_access_key)
    data = svc.status(sync)
    return ApiResponse.success(data=data)


@router.delete("/disconnect", response_model=ApiResponse)
async def disconnect(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """Disconnect CLI."""
    sync, svc = _auth_access_key(x_access_key)
    ok = svc.disconnect(sync)
    if not ok:
        return ApiResponse.success(data={"message": "No active connection found"})
    return ApiResponse.success(data={"message": "Disconnected", "sync_id": sync.id})


# ============================================================
# Data sync endpoints (X-Access-Key auth)
# ============================================================

@router.get("/{folder_id}/pull", response_model=ApiResponse)
async def pull(
    folder_id: str,
    x_access_key: str = Header(..., alias="X-Access-Key"),
    cursor: int = Query(0, ge=0),
):
    """Pull files from cloud folder.
    cursor=0 → full sync; cursor>0 → incremental."""
    sync, svc = _auth_folder(x_access_key, folder_id)
    data = svc.pull(
        project_id=sync.project_id,
        folder_id=folder_id,
        cursor=cursor,
        source_id=sync.id,
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

    sync, svc = _auth_folder(x_access_key, folder_id)
    notifier = ChangeNotifier.get_instance()

    changed = await notifier.wait_for_changes(
        sync.project_id, timeout=float(timeout),
    )

    if changed:
        data = svc.pull(
            project_id=sync.project_id,
            folder_id=folder_id,
            cursor=cursor,
            source_id=sync.id,
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
    """Push a file. Backend auto-detects create vs update by name lookup."""
    sync, svc = _auth_folder(x_access_key, folder_id)
    result = svc.push(
        project_id=sync.project_id,
        folder_id=folder_id,
        filename=request.filename,
        content=request.content,
        base_version=request.base_version,
        node_type=request.node_type,
        operator_id=f"sync:{sync.id}",
        operator_name="OpenClaw CLI",
        source_id=sync.id,
    )
    if not result.get("ok"):
        error = result.get("error", "")
        if error == "invalid_path":
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Invalid path"),
            )
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
    sync, svc = _auth_folder(x_access_key, folder_id)
    result = svc.delete_file(
        project_id=sync.project_id,
        folder_id=folder_id,
        filename=filename,
        source_id=sync.id,
    )
    if not result.get("ok"):
        if result.get("error") == "invalid_path":
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Invalid path"),
            )
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
    sync, svc = _auth_folder(x_access_key, folder_id)
    result = svc.request_upload_url(
        project_id=sync.project_id,
        folder_id=folder_id,
        filename=request.filename,
        content_type=request.content_type,
        size_bytes=request.size_bytes,
        operator_id=f"sync:{sync.id}",
        source_id=sync.id,
    )
    if not result.get("ok"):
        if result.get("error") == "invalid_path":
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Invalid path"),
            )
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
    sync, svc = _auth_folder(x_access_key, folder_id)
    result = svc.confirm_upload(
        project_id=sync.project_id,
        folder_id=folder_id,
        filename=request.filename,
        size_bytes=request.size_bytes,
        operator_id=f"sync:{sync.id}",
        operator_name="OpenClaw CLI",
        content_hash=request.content_hash,
        source_id=sync.id,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=result.get("message", "Confirm failed"),
        )
    return ApiResponse.success(data=result)
