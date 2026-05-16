"""
Filesystem Module — HTTP Endpoints (lifecycle only).

Data sync is handled by **stock Git** against the access-point-bound
Git URL (07-version-engine-supplement.md §3 — MUT wire protocol
removed):

  git clone https://<host>/git/ap/<access_key>.git ./workspace
  git push origin main
  git pull --ff-only

The same access_key resolves through ``resolve_access_point`` for both
the Git smart-HTTP surface (``/git/ap/{access_key}.git/*``) and the
scoped FS CLI (``/api/v1/ap-fs/*``); choose whichever fits the
client. PuppyOne shadow snapshots (``POST /api/v1/local-snapshots``)
let the local daemon publish tracked-but-unpushed files for cloud-side
queries without a Git push.

This router provides access lifecycle management:

Lifecycle (JWT auth):
  POST   /api/v1/filesystem/bootstrap                Create filesystem access
  GET    /api/v1/filesystem/{sync_id}/access-status   Poll CLI access status

CLI daemon (X-Access-Key auth):
  POST   /api/v1/filesystem/connect                  CLI first connect
  POST   /api/v1/filesystem/heartbeat                CLI heartbeat
  GET    /api/v1/filesystem/status                   CLI access status
  DELETE /api/v1/filesystem/disconnect               CLI disconnect
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService

router = APIRouter(prefix="/api/v1/filesystem", tags=["filesystem"])


# ============================================================
# Schemas
# ============================================================

class ConnectRequest(BaseModel):
    workspace_path: str = Field(..., description="CLI local workspace path")


# ============================================================
# Service singletons (lazy init)
# ============================================================

_cached_svc = None
_cached_sync_repo = None


def _get_service():
    global _cached_svc, _cached_sync_repo
    if _cached_svc is not None:
        return _cached_svc, _cached_sync_repo

    from src.connectors.datasource.repository import SyncRepository
    from src.infra.supabase.client import SupabaseClient
    from src.connectors.filesystem.service import FilesystemService

    supabase = SupabaseClient()
    _cached_sync_repo = SyncRepository(supabase)
    _cached_svc = FilesystemService(supabase=supabase, sync_repo=_cached_sync_repo)
    return _cached_svc, _cached_sync_repo


# ============================================================
# Auth helpers
# ============================================================

def _auth_access_key(access_key: str):
    """Authenticate via access_key → Sync object (for CLI daemon)."""
    svc, _ = _get_service()
    sync = svc.authenticate(access_key)
    if not sync:
        raise HTTPException(status_code=401, detail="Invalid or expired access key")
    svc.touch_heartbeat(sync)
    return sync, svc


def _ensure_project_access(project_service, current_user, project_id):
    project = project_service.get_by_id_with_access_check(project_id, current_user.user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ============================================================
# Lifecycle endpoints (JWT auth — used by web frontend)
# ============================================================

@router.post("/bootstrap", response_model=ApiResponse)
def bootstrap(
    project_id: str = Query(...),
    path: str = Query(...),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create a filesystem access for a folder. Returns access_key for CLI + MUT protocol."""
    _ensure_project_access(project_service, current_user, project_id)

    svc, _ = _get_service()
    try:
        sync = svc.bootstrap(project_id=project_id, path=path)
    except ValueError as e:
        if "already exists" in str(e):
            from fastapi import HTTPException as _HTTP
            raise _HTTP(
                status_code=409,
                detail={
                    "error": "duplicate_access_point",
                    "message": str(e),
                },
            )
        raise
    return ApiResponse.success(data={
        "access_point_id": sync.id,
        "access_key": sync.access_key,
        "path": sync.path,
        "project_id": sync.project_id,
        # ``ap_base`` historically pointed at the (now removed) MUT
        # wire-protocol URL. The same access_key authorises the Git
        # smart-HTTP surface, so we now emit the Git remote URL plus an
        # ``ap_fs_base`` for the FS HTTP API. Older clients that still
        # read ``ap_base`` get the Git URL — useful for `git clone`.
        "ap_base": f"/git/ap/{sync.access_key}.git",
        "git_url": f"/git/ap/{sync.access_key}.git",
        "ap_fs_base": "/api/v1/ap-fs",
    })


@router.get("/{sync_id}/access-status", response_model=ApiResponse)
def get_access_status(
    sync_id: str,
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Poll CLI access status for a filesystem access point."""
    _, sync_repo = _get_service()
    sync = sync_repo.get_by_id(sync_id)
    if not sync or sync.provider != "filesystem":
        return ApiResponse.success(data={"connected": False})

    _ensure_project_access(project_service, current_user, sync.project_id)

    svc, _ = _get_service()
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
    """CLI first connect: update workspace_path, return access info."""
    sync, svc = _auth_access_key(x_access_key)

    svc.connect(sync, request.workspace_path)

    return ApiResponse.success(data={
        "access_point_id": sync.id,
        "project_id": sync.project_id,
        "path": sync.path,
        # ``ap_base`` historically pointed at the (now removed) MUT
        # wire-protocol URL. The same access_key authorises the Git
        # smart-HTTP surface, so we now emit the Git remote URL plus an
        # ``ap_fs_base`` for the FS HTTP API. Older clients that still
        # read ``ap_base`` get the Git URL — useful for `git clone`.
        "ap_base": f"/git/ap/{sync.access_key}.git",
        "git_url": f"/git/ap/{sync.access_key}.git",
        "ap_fs_base": "/api/v1/ap-fs",
    })


@router.post("/heartbeat", response_model=ApiResponse)
async def heartbeat(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """CLI daemon heartbeat."""
    _auth_access_key(x_access_key)
    return ApiResponse.success(data={"ok": True})


@router.get("/status", response_model=ApiResponse)
async def status(
    x_access_key: str = Header(..., alias="X-Access-Key"),
):
    """Query CLI access status."""
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
        return ApiResponse.success(data={"message": "No active access found"})
    return ApiResponse.success(data={"message": "Disconnected", "access_point_id": sync.id})
