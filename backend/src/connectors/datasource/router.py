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
  POST   /sync/push/{path}                  Trigger server-side PUSH
"""

from typing import Optional, Any
import os
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.connectors.datasource.service import SyncService
from src.connectors.datasource.engine import SyncEngine
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.dependencies import get_sync_service, get_sync_engine, get_connector_registry
from src.common_schemas import ApiResponse
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService


router = APIRouter(prefix="/sync", tags=["sync"])


# ============================================================
# Request / Response models
# ============================================================

class SyncResponse(BaseModel):
    id: str
    project_id: str
    path: Optional[str] = None
    direction: str
    provider: str
    config: dict
    status: str
    last_sync_version: int
    error_message: Optional[str] = None


class SyncStatusItem(BaseModel):
    id: str
    path: Optional[str] = None
    node_name: Optional[str] = None
    node_type: Optional[str] = None
    provider: str
    direction: str
    status: str
    name: Optional[str] = None
    access_key: Optional[str] = None
    trigger: Optional[dict] = None
    last_synced_at: Optional[str] = None
    error_message: Optional[str] = None


class UploadStatusItem(BaseModel):
    id: str
    path: Optional[str] = None
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
    target_folder_path: Optional[str] = None
    credentials_ref: Optional[str] = None
    direction: str = "bidirectional"
    conflict_strategy: str = "three_way_merge"
    sync_mode: str = "import_once"
    trigger: Optional[dict] = None


class BootstrapResponse(BaseModel):
    syncs_created: int


class CreateSyncRequest(BaseModel):
    project_id: str
    provider: str
    config: dict
    target_folder_path: str
    credentials_ref: Optional[str] = None
    direction: str = "inbound"
    conflict_strategy: str = "three_way_merge"
    sync_mode: str = "import_once"
    trigger: Optional[dict] = None


class CreateSyncResponse(BaseModel):
    sync: SyncResponse
    execution_result: Optional[dict] = None


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
    path: str
    external_resource_id: str
    action: str
    version: int


class PullFileItem(BaseModel):
    path: str
    external_resource_id: str
    content_json: Optional[Any] = None
    content_md: Optional[str] = None
    node_type: str
    current_version: int


class PullFilesResponse(BaseModel):
    files: list[PullFileItem]
    total: int


class AckPullItem(BaseModel):
    path: str
    version: int
    remote_hash: str


class AckPullRequest(BaseModel):
    items: list[AckPullItem]


# ============================================================
# Auth helpers
# ============================================================

def _ensure_project_access(
    project_service: ProjectService,
    current_user: CurrentUser,
    project_id: str,
) -> None:
    if not project_service.verify_project_access(project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )


def _get_sync_with_access(
    *,
    sync_id: str,
    sync_svc: SyncService,
    project_service: ProjectService,
    current_user: CurrentUser,
):
    sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not sync:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sync #{sync_id} not found",
        )

    _ensure_project_access(project_service, current_user, sync.project_id)
    return sync


# ============================================================
# Project-level sync status (for frontend global panel)
# ============================================================

@router.get("/status", response_model=ApiResponse[ProjectSyncStatusResponse])
async def get_project_sync_status(
    project_id: str = Query(..., description="Project ID"),
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Aggregated sync status for a project.
    Used by the frontend header sync panel.
    """
    from src.infra.supabase.client import SupabaseClient

    _ensure_project_access(project_service, current_user, project_id)

    syncs = sync_svc.sync_repo.list_by_project(project_id)

    sync_items = [
        SyncStatusItem(
            id=s.id,
            path=s.path,
            node_name=s.path.rsplit("/", 1)[-1] if s.path else None,
            node_type=None,
            provider=s.provider,
            direction=s.direction,
            status=s.status,
            name=(s.config or {}).get("name"),
            access_key=s.access_key if s.provider in ("filesystem", "mcp", "sandbox") else None,
            trigger=s.trigger if s.trigger else None,
            last_synced_at=s.last_synced_at,
            error_message=s.error_message,
        )
        for s in syncs
    ]

    return ApiResponse.success(
        data=ProjectSyncStatusResponse(syncs=sync_items, uploads=[])
    )


# ============================================================
# Connector registry (for frontend dynamic rendering)
# ============================================================

@router.get("/connectors", response_model=ApiResponse)
def list_connectors(
    registry: ConnectorRegistry = Depends(get_connector_registry),
):
    """
    List all registered connectors with their specs.
    Frontend uses this to dynamically render connector options
    instead of hardcoding SYNC_OPTIONS / SYNC_PROVIDER_SPECS.
    """
    return ApiResponse.success(data=registry.specs_to_dicts())


# ============================================================
# Sync management
# ============================================================

@router.post("/syncs", response_model=ApiResponse[CreateSyncResponse])
async def create_sync(
    body: CreateSyncRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    engine: SyncEngine = Depends(get_sync_engine),
    registry: ConnectorRegistry = Depends(get_connector_registry),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, body.project_id)

    connector = registry.get(body.provider)
    if not connector:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown connector provider: {body.provider}",
        )

    spec = connector.spec()
    if spec.creation_mode != "direct":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connector {body.provider} must be created via bootstrap",
        )

    sync = await sync_svc.create_sync(
        project_id=body.project_id,
        provider=body.provider,
        config=body.config,
        target_folder_path=body.target_folder_path,
        credentials_ref=body.credentials_ref,
        direction=body.direction,
        conflict_strategy=body.conflict_strategy,
        sync_mode=body.sync_mode,
        trigger=body.trigger,
        user_id=current_user.user_id,
    )

    if body.sync_mode == "scheduled" and body.trigger:
        try:
            from src.infra.scheduler.service import get_scheduler_service
            scheduler = get_scheduler_service()
            await scheduler.add_sync_job(
                sync_id=sync.id,
                trigger_config=body.trigger,
                provider=body.provider,
            )
        except Exception:
            pass

    execution_result = None
    try:
        execution_result = await engine.execute(sync.id)
    except Exception as e:
        from src.utils.logger import log_error
        log_error(f"[CreateSync] First fetch failed for sync {sync.id}: {e}")

    refreshed_sync = sync_svc.sync_repo.get_by_id(sync.id) or sync
    return ApiResponse.success(
        data=CreateSyncResponse(
            sync=_sync_resp(refreshed_sync),
            execution_result=execution_result,
        )
    )


@router.get("/syncs", response_model=ApiResponse[list[SyncResponse]])
def list_syncs(
    project_id: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if not project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id is required",
        )

    _ensure_project_access(project_service, current_user, project_id)

    if provider:
        syncs = sync_svc.sync_repo.list_by_provider(project_id, provider)
    else:
        syncs = sync_svc.sync_repo.list_by_project(project_id)
    return ApiResponse.success(data=[_sync_resp(s) for s in syncs])


@router.delete("/syncs/{sync_id}", response_model=ApiResponse)
def delete_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )
    _notify_folder_source("stop", sync_id)

    try:
        from src.infra.scheduler.service import get_scheduler_service
        get_scheduler_service().remove_sync_job(sync_id)
    except Exception:
        pass

    sync_svc.remove_sync(sync_id)
    return ApiResponse.success(message="Sync deleted")


class UpdateSyncTriggerRequest(BaseModel):
    sync_mode: str
    trigger: Optional[dict] = None


@router.patch("/syncs/{sync_id}/trigger", response_model=ApiResponse)
async def update_sync_trigger(
    sync_id: str,
    body: UpdateSyncTriggerRequest,
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Update sync trigger mode (import_once, manual, scheduled)."""
    _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )

    trigger_data = body.trigger or {}
    if not trigger_data.get("type"):
        trigger_data["type"] = body.sync_mode

    sync_svc.sync_repo.update(sync_id, trigger=trigger_data)

    # Manage scheduler job
    try:
        from src.infra.scheduler.service import get_scheduler_service
        scheduler = get_scheduler_service()

        if body.sync_mode == "scheduled" and body.trigger:
            sync = sync_svc.sync_repo.get_by_id(sync_id)
            await scheduler.add_sync_job(
                sync_id=sync_id,
                trigger_config=body.trigger,
                provider=sync.provider if sync else "",
            )
        else:
            scheduler.remove_sync_job(sync_id)
    except Exception:
        pass

    return ApiResponse.success(message=f"Sync trigger updated to {body.sync_mode}")


@router.post("/syncs/{sync_id}/pause", response_model=ApiResponse)
def pause_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )
    _notify_folder_source("stop", sync_id)
    sync_svc.pause_sync(sync_id)
    return ApiResponse.success(message="Sync paused")


@router.post("/syncs/{sync_id}/refresh", response_model=ApiResponse[PullResponse])
async def refresh_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    engine: SyncEngine = Depends(get_sync_engine),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Manually trigger a refresh (re-pull) for a sync binding.
    Uses SyncEngine — all writes go through CollaborationService.
    """
    sync = _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )

    trigger_type = (sync.trigger or {}).get("type", "import_once")
    if trigger_type == "import_once":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot refresh an import-once sync. Change sync mode first.",
        )

    result = await engine.execute(sync_id)
    results = [result] if result else []
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/syncs/{sync_id}/resume", response_model=ApiResponse)
def resume_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )
    sync_svc.resume_sync(sync_id)
    _notify_folder_source("start", sync_id)
    return ApiResponse.success(message="Sync resumed")


# ============================================================
# Sync run history
# ============================================================

class SyncRunResponse(BaseModel):
    id: str
    sync_id: str
    status: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    error: Optional[str] = None
    trigger_type: Optional[str] = None
    result_summary: Optional[str] = None


def _get_run_repo():
    from src.connectors.datasource.run_repository import SyncRunRepository
    from src.infra.supabase.client import SupabaseClient
    return SyncRunRepository(SupabaseClient())


@router.get("/syncs/{sync_id}/runs", response_model=ApiResponse[list[SyncRunResponse]])
def list_sync_runs(
    sync_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """List execution history for a sync connection."""
    _get_sync_with_access(
        sync_id=sync_id,
        sync_svc=sync_svc,
        project_service=project_service,
        current_user=current_user,
    )
    run_repo = _get_run_repo()
    runs = run_repo.list_by_sync(sync_id, limit=limit, offset=offset)
    return ApiResponse.success(data=[
        SyncRunResponse(
            id=r.id, sync_id=r.sync_id, status=r.status,
            started_at=r.started_at, finished_at=r.finished_at,
            duration_ms=r.duration_ms, exit_code=r.exit_code,
            error=r.error, trigger_type=r.trigger_type,
            result_summary=r.result_summary,
        )
        for r in runs
    ])


@router.get("/runs/{run_id}", response_model=ApiResponse[SyncRunResponse])
def get_sync_run(
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get details of a single sync run (including stdout)."""
    run_repo = _get_run_repo()
    run = run_repo.get_by_id(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return ApiResponse.success(data=SyncRunResponse(
        id=run.id, sync_id=run.sync_id, status=run.status,
        started_at=run.started_at, finished_at=run.finished_at,
        duration_ms=run.duration_ms, exit_code=run.exit_code,
        stdout=run.stdout, error=run.error,
        trigger_type=run.trigger_type, result_summary=run.result_summary,
    ))


@router.post("/syncs/openclaw/bootstrap", response_model=ApiResponse, deprecated=True)
def bootstrap_openclaw(
    project_id: str = Query(...),
    path: str = Query(...),
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """DEPRECATED: Use POST /api/v1/filesystem/bootstrap instead."""
    _ensure_project_access(project_service, current_user, project_id)

    from src.connectors.filesystem.lifecycle import OpenClawService
    from src.infra.supabase.client import SupabaseClient
    svc = OpenClawService(
        supabase=SupabaseClient(),
        sync_repo=sync_svc.sync_repo,
    )
    sync = svc.bootstrap(project_id=project_id, path=path)
    return ApiResponse.success(data={
        "sync_id": sync.id,
        "access_key": sync.access_key,
        "path": sync.path,
        "project_id": sync.project_id,
    })


@router.get("/syncs/{sync_id}/openclaw-status", response_model=ApiResponse, deprecated=True)
def get_openclaw_status_by_sync(
    sync_id: str,
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """DEPRECATED: Use GET /api/v1/filesystem/{sync_id}/connection-status instead."""
    sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not sync or sync.provider != "filesystem":
        return ApiResponse.success(data={"connected": False})

    _ensure_project_access(project_service, current_user, sync.project_id)

    from src.connectors.filesystem.lifecycle import OpenClawService
    from src.infra.supabase.client import SupabaseClient
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
    engine: SyncEngine = Depends(get_sync_engine),
    registry: ConnectorRegistry = Depends(get_connector_registry),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, body.project_id)

    connector = registry.get(body.provider)
    if not connector:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown connector provider: {body.provider}",
        )
    if connector.spec().creation_mode != "bootstrap":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connector {body.provider} must be created via POST /sync/syncs",
        )

    syncs = await sync_svc.bootstrap(
        project_id=body.project_id,
        provider=body.provider,
        config=body.config,
        target_folder_path=body.target_folder_path,
        credentials_ref=body.credentials_ref,
        direction=body.direction,
        conflict_strategy=body.conflict_strategy,
        sync_mode=body.sync_mode,
        trigger=body.trigger,
        user_id=current_user.user_id,
    )

    if body.sync_mode == "scheduled" and body.trigger:
        try:
            from src.infra.scheduler.service import get_scheduler_service
            scheduler = get_scheduler_service()
            for s in syncs:
                await scheduler.add_sync_job(
                    sync_id=s.id,
                    trigger_config=body.trigger,
                    provider=body.provider,
                )
        except Exception:
            pass

    for s in syncs:
        try:
            await engine.execute(s.id)
        except Exception as e:
            from src.utils.logger import log_error
            log_error(f"[Bootstrap] First fetch failed for sync {s.id}: {e}")

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

    parent_sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not parent_sync:
        return ApiResponse.error(code=1004, message=f"Sync #{sync_id} not found")

    is_json = body.content_json is not None
    existing = sync_svc.sync_repo.find_by_config_key(
        parent_sync.provider, "external_resource_id", body.external_resource_id,
    )

    if existing:
        if existing.remote_hash == body.content_hash:
            return ApiResponse.success(data=PushFileResponse(
                path=existing.path,
                external_resource_id=body.external_resource_id,
                action="skipped",
                version=existing.last_sync_version,
            ))

        from src.mut_engine.dependencies import create_mut_ops
        import json as _json

        ops = create_mut_ops()
        content_bytes = (_json.dumps(body.content_json, ensure_ascii=False, indent=2) if is_json else (body.content_md or "")).encode("utf-8")
        write_result = await ops.write_file(
            parent_sync.project_id, existing.path, content_bytes,
            who=f"sync:cli:{body.external_resource_id}",
            message=f"push update {body.external_resource_id}",
        )
        version = write_result.version
        sync_svc.sync_repo.update_sync_point(
            sync_id=existing.id,
            last_sync_version=version,
            remote_hash=body.content_hash,
        )
        return ApiResponse.success(data=PushFileResponse(
            path=existing.path,
            external_resource_id=body.external_resource_id,
            action="updated",
            version=version,
        ))

    file_name = body.name or os.path.splitext(
        os.path.basename(body.external_resource_id)
    )[0]
    target_folder_path = parent_sync.config.get("target_folder_id", "")

    from src.mut_engine.dependencies import create_mut_ops as _create_mut_ops
    import json as _json

    ops = _create_mut_ops()
    ext = ".json" if is_json else ".md"
    file_path = f"{target_folder_path}/{file_name}{ext}" if target_folder_path else f"{file_name}{ext}"
    content_bytes = (_json.dumps(body.content_json, ensure_ascii=False, indent=2) if is_json else (body.content_md or "")).encode("utf-8")

    write_result = await ops.write_file(
        parent_sync.project_id, file_path, content_bytes,
        who=f"sync:cli:{body.external_resource_id}",
        message=f"push create {body.external_resource_id}",
    )

    version = write_result.version
    return ApiResponse.success(data=PushFileResponse(
        path=file_path,
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
    from src.infra.supabase.client import SupabaseClient

    parent_sync = sync_svc.sync_repo.get_by_id(sync_id)
    if not parent_sync:
        return ApiResponse.error(code=1004, message=f"Sync #{sync_id} not found")

    files: list[PullFileItem] = []

    syncs = sync_svc.sync_repo.list_by_provider(
        parent_sync.project_id, parent_sync.provider,
    )

    from src.mut_engine.dependencies import create_mut_ops
    ops = create_mut_ops()
    current_version = ops.get_version(parent_sync.project_id)

    for s in syncs:
        if not s.path:
            continue

        if current_version <= s.last_sync_version:
            continue

        ext_resource_id = s.config.get("external_resource_id", "")
        path = s.path

        try:
            content = ops.read_file(parent_sync.project_id, path)
        except FileNotFoundError:
            continue

        from src.mut_engine.tree_reader import detect_type
        node_type = detect_type(path)
        is_json = node_type == "json"

        import json as _json
        if is_json:
            try:
                json_content = _json.loads(content.decode("utf-8"))
                text_content = None
            except (ValueError, UnicodeDecodeError):
                json_content = None
                text_content = content.decode("utf-8", errors="replace")
        else:
            json_content = None
            text_content = content.decode("utf-8", errors="replace")

        files.append(PullFileItem(
            path=path,
            external_resource_id=ext_resource_id,
            content_json=json_content if is_json else None,
            content_md=text_content if not is_json else None,
            node_type="json" if is_json else "markdown",
            current_version=current_version,
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
    engine: SyncEngine = Depends(get_sync_engine),
    current_user: CurrentUser = Depends(get_current_user),
):
    if sync_id:
        result = await engine.execute(sync_id)
        results = [result] if result else []
    else:
        results = await engine.execute_all(provider)
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/push/{path:path}", response_model=ApiResponse[PushResponse])
async def trigger_push(
    path: str,
    project_id: str = Query(..., description="项目 ID"),
    engine: SyncEngine = Depends(get_sync_engine),
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.mut_engine.dependencies import create_mut_ops

    ops = create_mut_ops()
    try:
        content = ops.read_file(project_id, path)
    except FileNotFoundError:
        return ApiResponse.error(code=1004, message=f"File not found: {path}")

    from src.mut_engine.tree_reader import detect_type
    import json as _json

    node_type = detect_type(path)
    if node_type == "json":
        try:
            parsed_content = _json.loads(content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            parsed_content = content.decode("utf-8", errors="replace")
    else:
        parsed_content = content.decode("utf-8", errors="replace")

    version = ops.get_version(project_id)
    result = await engine.push_execute(
        path=path,
        version=version,
        content=parsed_content,
        node_type=node_type,
    )

    return ApiResponse.success(data=PushResponse(
        pushed=1 if result else 0,
        results=[result] if result else [],
    ))


# ============================================================
# Sync Changelog (frontend query)
# ============================================================

class ChangelogItem(BaseModel):
    id: int
    project_id: str
    path: str
    action: str
    node_type: Optional[str] = None
    version: int = 0
    hash: Optional[str] = None
    size_bytes: int = 0
    folder_id: Optional[str] = None
    filename: Optional[str] = None
    created_at: Optional[str] = None


class ChangelogResponse(BaseModel):
    entries: list[ChangelogItem]
    cursor: int
    has_more: bool


@router.get("/changelog", response_model=ApiResponse[ChangelogResponse])
def get_sync_changelog(
    project_id: str = Query(..., description="Project ID"),
    cursor: int = Query(0, ge=0, description="Cursor for pagination"),
    limit: int = Query(100, ge=1, le=500),
    sync_svc: SyncService = Depends(get_sync_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    """查询项目的同步变更日志（sync_changelog），供前端展示同步事件。"""
    _ensure_project_access(project_service, current_user, project_id)

    from src.connectors.filesystem.changelog import SyncChangelogRepository
    from src.infra.supabase.client import SupabaseClient

    changelog_repo = SyncChangelogRepository(SupabaseClient())
    entries = changelog_repo.list_since(project_id, cursor=cursor, limit=limit + 1)

    has_more = len(entries) > limit
    if has_more:
        entries = entries[:limit]

    new_cursor = entries[-1].id if entries else cursor

    items = [
        ChangelogItem(
            id=e.id,
            project_id=e.project_id,
            path=e.path,
            action=e.action,
            node_type=e.node_type,
            version=e.version,
            hash=e.hash,
            size_bytes=e.size_bytes,
            folder_id=e.folder_id,
            filename=e.filename,
            created_at=e.created_at,
        )
        for e in entries
    ]

    return ApiResponse.success(data=ChangelogResponse(
        entries=items,
        cursor=new_cursor,
        has_more=has_more,
    ))


# ============================================================
# Helpers
# ============================================================

def _notify_folder_source(action: str, sync_id: str) -> None:
    """Filesystem sync is now client-side — no server notification needed."""
    pass


def _sync_resp(s) -> SyncResponse:
    return SyncResponse(
        id=s.id,
        project_id=s.project_id,
        path=s.path,
        direction=s.direction,
        provider=s.provider,
        config=s.config,
        status=s.status,
        last_sync_version=s.last_sync_version,
        error_message=s.error_message,
    )
