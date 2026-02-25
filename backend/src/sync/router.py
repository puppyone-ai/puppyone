"""
Sync — API Routes (Unified Sync Architecture)

Sync management:
  GET    /sync/syncs                        List syncs for a project
  DELETE /sync/syncs/{id}                   Delete a sync
  POST   /sync/syncs/{id}/pause             Pause
  POST   /sync/syncs/{id}/resume            Resume

CLI-driven sync:
  POST   /sync/syncs/{id}/push-file         Push a local file to PuppyOne
  GET    /sync/syncs/{id}/pull-files         Get files that need pulling
  POST   /sync/syncs/{id}/ack-pull          Acknowledge pulled files

Server-side sync:
  POST   /sync/pull                          Trigger server-side PULL
  POST   /sync/push/{node_id}               Trigger server-side PUSH
"""

from typing import Optional, Any
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.sync.service import SyncService
from src.sync.dependencies import get_sync_service
from src.common_schemas import ApiResponse


router = APIRouter(prefix="/sync", tags=["sync"])


# ============================================================
# Request / Response models
# ============================================================

class SyncResponse(BaseModel):
    id: str
    project_id: str
    node_id: str
    direction: str
    provider: str
    config: dict
    status: str
    last_sync_version: int
    error_message: Optional[str] = None


class SyncStatusItem(BaseModel):
    id: str
    node_id: str
    node_name: Optional[str] = None
    node_type: Optional[str] = None
    provider: str
    direction: str
    status: str
    access_key: Optional[str] = None
    last_synced_at: Optional[str] = None
    error_message: Optional[str] = None


class UploadStatusItem(BaseModel):
    id: str
    node_id: Optional[str] = None
    type: str
    task_type: Optional[str] = None
    status: str
    progress: int = 0
    message: Optional[str] = None
    created_at: Optional[str] = None


class ProjectSyncStatusResponse(BaseModel):
    syncs: list[SyncStatusItem]
    uploads: list[UploadStatusItem]


class BootstrapRequest(BaseModel):
    project_id: str
    provider: str
    config: dict
    target_folder_node_id: Optional[str] = None
    credentials_ref: Optional[str] = None
    direction: str = "bidirectional"
    conflict_strategy: str = "three_way_merge"


class BootstrapResponse(BaseModel):
    syncs_created: int


class PullResponse(BaseModel):
    synced: int
    results: list[dict]


class PushResponse(BaseModel):
    pushed: int
    results: list[dict]


# --- CLI sync models ---

class PushFileRequest(BaseModel):
    external_resource_id: str
    content_json: Optional[Any] = None
    content_md: Optional[str] = None
    content_hash: str
    name: Optional[str] = None


class PushFileResponse(BaseModel):
    node_id: str
    external_resource_id: str
    action: str
    version: int


class PullFileItem(BaseModel):
    node_id: str
    external_resource_id: str
    content_json: Optional[Any] = None
    content_md: Optional[str] = None
    node_type: str
    current_version: int


class PullFilesResponse(BaseModel):
    files: list[PullFileItem]
    total: int


class AckPullItem(BaseModel):
    node_id: str
    version: int
    remote_hash: str


class AckPullRequest(BaseModel):
    items: list[AckPullItem]


# ============================================================
# Project-level sync status (for frontend global panel)
# ============================================================

@router.get("/status", response_model=ApiResponse[ProjectSyncStatusResponse])
async def get_project_sync_status(
    project_id: str = Query(..., description="Project ID"),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Aggregated sync + upload status for a project.
    Used by the frontend header sync panel.
    """
    from src.content_node.repository import ContentNodeRepository
    from src.sync.task.repository import ImportTaskRepository
    from src.supabase.client import SupabaseClient

    syncs = sync_svc.sync_repo.list_by_project(project_id)

    node_ids = [s.node_id for s in syncs if s.node_id]
    node_info: dict[str, dict] = {}
    if node_ids:
        node_repo = ContentNodeRepository(SupabaseClient())
        try:
            resp = (
                node_repo.client.table("content_nodes")
                .select("id, name, type")
                .in_("id", node_ids)
                .execute()
            )
            node_info = {r["id"]: r for r in (resp.data or [])}
        except Exception:
            pass

    sync_items = [
        SyncStatusItem(
            id=s.id,
            node_id=s.node_id,
            node_name=node_info.get(s.node_id, {}).get("name"),
            node_type=node_info.get(s.node_id, {}).get("type"),
            provider=s.provider,
            direction=s.direction,
            status=s.status,
            access_key=s.access_key if s.provider == "openclaw" else None,
            last_synced_at=s.last_synced_at,
            error_message=s.error_message,
        )
        for s in syncs
    ]

    upload_items: list[UploadStatusItem] = []
    try:
        task_repo = ImportTaskRepository()
        tasks = await task_repo.get_by_user(
            user_id=current_user.user_id,
            project_id=project_id,
            limit=20,
        )
        upload_items = [
            UploadStatusItem(
                id=t.id or "",
                node_id=t.node_id,
                type="import",
                task_type=t.task_type.value if t.task_type else None,
                status=t.status.value,
                progress=t.progress,
                message=t.message,
                created_at=t.created_at.isoformat() if t.created_at else None,
            )
            for t in tasks
            if not t.status.is_terminal()
        ]
    except Exception:
        pass

    return ApiResponse.success(
        data=ProjectSyncStatusResponse(syncs=sync_items, uploads=upload_items)
    )


# ============================================================
# Sync management
# ============================================================

@router.get("/syncs", response_model=ApiResponse[list[SyncResponse]])
def list_syncs(
    project_id: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if project_id and provider:
        syncs = sync_svc.sync_repo.list_by_provider(project_id, provider)
    elif project_id:
        syncs = sync_svc.sync_repo.list_by_project(project_id)
    else:
        syncs = sync_svc.sync_repo.list_active(provider)
    return ApiResponse.success(data=[_sync_resp(s) for s in syncs])


@router.delete("/syncs/{sync_id}", response_model=ApiResponse)
def delete_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _notify_folder_source("stop", sync_id)
    sync_svc.remove_sync(sync_id)
    return ApiResponse.success(message="Sync deleted")


@router.post("/syncs/{sync_id}/pause", response_model=ApiResponse)
def pause_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _notify_folder_source("stop", sync_id)
    sync_svc.pause_sync(sync_id)
    return ApiResponse.success(message="Sync paused")


@router.post("/syncs/{sync_id}/resume", response_model=ApiResponse)
def resume_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    sync_svc.resume_sync(sync_id)
    _notify_folder_source("start", sync_id)
    return ApiResponse.success(message="Sync resumed")


@router.post("/syncs/openclaw/bootstrap", response_model=ApiResponse)
def bootstrap_openclaw(
    project_id: str = Query(...),
    node_id: str = Query(...),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create an OpenClaw sync endpoint for a folder. Returns sync with access_key."""
    from src.sync.connectors.openclaw.lifecycle import OpenClawService
    from src.supabase.client import SupabaseClient
    svc = OpenClawService(
        supabase=SupabaseClient(),
        sync_repo=sync_svc.sync_repo,
    )
    sync = svc.bootstrap(project_id=project_id, node_id=node_id)
    return ApiResponse.success(data={
        "sync_id": sync.id,
        "access_key": sync.access_key,
        "node_id": sync.node_id,
        "project_id": sync.project_id,
    })


@router.get("/syncs/{sync_id}/openclaw-status", response_model=ApiResponse)
def get_openclaw_status_by_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """OpenClaw CLI connection status for a sync endpoint (frontend polling)."""
    sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not sync or sync.provider != "openclaw":
        return ApiResponse.success(data={"connected": False})

    from src.sync.connectors.openclaw.lifecycle import OpenClawService
    from src.supabase.client import SupabaseClient
    svc = OpenClawService(
        supabase=SupabaseClient(),
        sync_repo=sync_svc.sync_repo,
    )
    data = svc.status(sync)
    return ApiResponse.success(data=data)


@router.post("/bootstrap", response_model=ApiResponse[BootstrapResponse])
async def bootstrap(
    body: BootstrapRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    syncs = await sync_svc.bootstrap(
        project_id=body.project_id,
        provider=body.provider,
        config=body.config,
        target_folder_node_id=body.target_folder_node_id,
        credentials_ref=body.credentials_ref,
        direction=body.direction,
        conflict_strategy=body.conflict_strategy,
    )
    return ApiResponse.success(data=BootstrapResponse(syncs_created=len(syncs)))


# ============================================================
# CLI-driven sync: push-file, pull-files, ack-pull
# ============================================================

@router.post(
    "/syncs/{sync_id}/push-file",
    response_model=ApiResponse[PushFileResponse],
)
async def push_file(
    sync_id: str,
    body: PushFileRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    CLI pushes a local file to PuppyOne.
    Creates a new node if no sync binding exists, updates if it does.
    """
    import os
    from src.content_node.repository import ContentNodeRepository
    from src.content_node.service import ContentNodeService
    from src.s3.service import S3Service
    from src.supabase.client import SupabaseClient

    parent_sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not parent_sync:
        return ApiResponse.error(code=1004, message=f"Sync #{sync_id} not found")

    supabase = SupabaseClient()
    node_repo = ContentNodeRepository(supabase)
    node_svc = ContentNodeService(repo=node_repo, s3_service=S3Service())

    is_json = body.content_json is not None
    existing = sync_svc.sync_repo.find_by_config_key(
        parent_sync.provider, "external_resource_id", body.external_resource_id,
    )

    if existing:
        if existing.remote_hash == body.content_hash:
            return ApiResponse.success(data=PushFileResponse(
                node_id=existing.node_id,
                external_resource_id=body.external_resource_id,
                action="skipped",
                version=existing.last_sync_version,
            ))

        updated = node_svc.update_node(
            node_id=existing.node_id,
            project_id=parent_sync.project_id,
            preview_json=body.content_json if is_json else None,
            preview_md=body.content_md if not is_json else None,
            operator_type="sync",
            operator_id=f"cli:{body.external_resource_id}",
        )
        version = updated.current_version or 0
        sync_svc.sync_repo.update_sync_point(
            sync_id=existing.id,
            last_sync_version=version,
            remote_hash=body.content_hash,
        )
        return ApiResponse.success(data=PushFileResponse(
            node_id=existing.node_id,
            external_resource_id=body.external_resource_id,
            action="updated",
            version=version,
        ))

    file_name = body.name or os.path.splitext(
        os.path.basename(body.external_resource_id)
    )[0]
    target_folder_id = parent_sync.config.get("target_folder_id")

    if is_json:
        new_node = node_svc.create_json_node(
            project_id=parent_sync.project_id,
            name=file_name,
            content=body.content_json,
            parent_id=target_folder_id,
            created_by=current_user.user_id,
        )
    else:
        new_node = await node_svc.create_markdown_node(
            project_id=parent_sync.project_id,
            name=file_name,
            content=body.content_md or "",
            parent_id=target_folder_id,
            created_by=current_user.user_id,
        )

    version = new_node.current_version or 0
    return ApiResponse.success(data=PushFileResponse(
        node_id=new_node.id,
        external_resource_id=body.external_resource_id,
        action="created",
        version=version,
    ))


@router.get(
    "/syncs/{sync_id}/pull-files",
    response_model=ApiResponse[PullFilesResponse],
)
def pull_files(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns files that have changed on the server since last sync.
    CLI writes them to local filesystem, then calls ack-pull.
    """
    from src.content_node.repository import ContentNodeRepository
    from src.supabase.client import SupabaseClient

    parent_sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not parent_sync:
        return ApiResponse.error(code=1004, message=f"Sync #{sync_id} not found")

    node_repo = ContentNodeRepository(SupabaseClient())
    files: list[PullFileItem] = []

    syncs = sync_svc.sync_repo.list_by_provider(
        parent_sync.project_id, parent_sync.provider,
    )

    for s in syncs:
        if not s.node_id:
            continue
        node = node_repo.get_by_id(s.node_id)
        if not node:
            continue

        node_version = node.current_version or 0
        if node_version <= s.last_sync_version:
            continue

        ext_resource_id = s.config.get("external_resource_id", "")
        is_json = node.preview_json is not None
        files.append(PullFileItem(
            node_id=node.id,
            external_resource_id=ext_resource_id,
            content_json=node.preview_json if is_json else None,
            content_md=node.preview_md if not is_json else None,
            node_type="json" if is_json else "markdown",
            current_version=node_version,
        ))

    return ApiResponse.success(data=PullFilesResponse(files=files, total=len(files)))


@router.post("/syncs/{sync_id}/ack-pull", response_model=ApiResponse)
def ack_pull(
    sync_id: str,
    body: AckPullRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Legacy endpoint. Per-file sync tracking has been removed in favor of
    cursor-based sync (Dropbox SFJ model). This is now a no-op kept for
    backward compatibility.
    """
    return ApiResponse.success(message=f"Acknowledged {len(body.items)} files")


# ============================================================
# Server-side PULL / PUSH
# ============================================================

@router.post("/pull", response_model=ApiResponse[PullResponse])
async def trigger_pull(
    sync_id: Optional[str] = Query(None, description="Sync ID. Omit to pull all."),
    provider: Optional[str] = Query(None),
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if sync_id:
        result = await sync_svc.pull_sync(sync_id)
        results = [result] if result else []
    else:
        results = await sync_svc.pull_all(provider)
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/push/{node_id}", response_model=ApiResponse[PushResponse])
async def trigger_push(
    node_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.content_node.repository import ContentNodeRepository
    from src.supabase.client import SupabaseClient

    node = ContentNodeRepository(SupabaseClient()).get_by_id(node_id)
    if not node:
        return ApiResponse.error(code=1004, message=f"Node not found: {node_id}")

    content = node.preview_json if node.preview_json is not None else node.preview_md
    node_type = "json" if node.preview_json is not None else "markdown"

    results = await sync_svc.push_node(
        node_id=node_id,
        version=node.current_version or 0,
        content=content,
        node_type=node_type,
    )
    return ApiResponse.success(data=PushResponse(pushed=len(results), results=results))


# ============================================================
# Helpers
# ============================================================

def _notify_folder_source(action: str, sync_id: str) -> None:
    try:
        from src.sync.connectors.openclaw.watcher import FolderSourceService
        svc = FolderSourceService.get_instance()
        if not svc:
            return
        if action == "start":
            svc.start_for_sync(sync_id)
        elif action == "stop":
            svc.stop_for_sync(sync_id)
    except Exception:
        pass


def _sync_resp(s) -> SyncResponse:
    return SyncResponse(
        id=s.id,
        project_id=s.project_id,
        node_id=s.node_id,
        direction=s.direction,
        provider=s.provider,
        config=s.config,
        status=s.status,
        last_sync_version=s.last_sync_version,
        error_message=s.error_message,
    )
