"""Integration API.

Integration is the top-level durable relationship resource. It writes through
the project-root Version Engine path, not Access scopes.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from src.common_schemas import ApiResponse
from src.connectors.datasource.cli_handlers import (
    _notify_folder_source,
    _sync_resp as _sync_resp_helper,
    process_pull_files,
    process_push_file,
)
from src.connectors.datasource.registry import ConnectorRegistry
from src.connectors.datasource.router import (
    AckPullRequest,
    BootstrapResponse,
    ChangelogItem,
    ChangelogResponse,
    CreateSyncResponse,
    FailedSyncRunItem,
    ProjectSyncStatusResponse,
    PullFileItem,
    PullFilesResponse,
    PullResponse,
    PushFileRequest,
    PushFileResponse,
    PushResponse,
    SyncResponse,
    SyncRunResponse,
    SyncStatusItem,
)
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.integrations.dependencies import (
    get_connector_registry,
    get_integration_engine,
    get_integration_service,
)
from src.platform.integrations.engine import IntegrationEngine
from src.platform.integrations.paths import canonical_provider
from src.platform.integrations.service import IntegrationService
from src.platform.project.dependencies import get_project_service
from src.platform.project.service import ProjectService
from src.utils.logger import log_error


router = APIRouter(prefix="/integrations", tags=["integrations"])

_PROJECT_ID_DESC = "Project ID"


class BootstrapRequest(BaseModel):
    project_id: str
    provider: str
    config: dict
    target_folder_path: Optional[str] = None
    target_path: Optional[str] = None
    credentials_ref: Optional[str] = None
    direction: str = "bidirectional"
    conflict_strategy: str = "three_way_merge"
    sync_mode: str = "manual"
    trigger: Optional[dict] = None


class CreateIntegrationRequest(BaseModel):
    project_id: str
    provider: str
    config: dict
    target_folder_path: Optional[str] = None
    target_path: Optional[str] = None
    credentials_ref: Optional[str] = None
    direction: str = "inbound"
    conflict_strategy: str = "three_way_merge"
    sync_mode: str = "manual"
    trigger: Optional[dict] = None


class UpdateIntegrationTriggerRequest(BaseModel):
    sync_mode: str
    trigger: Optional[dict] = None


def _connectable_specs(registry: ConnectorRegistry) -> list[dict]:
    modes_allowed = {"manual", "scheduled", "realtime"}
    specs: list[dict] = []
    for spec in registry.specs_to_dicts():
        modes = [
            mode for mode in (spec.get("supported_sync_modes") or [])
            if mode in modes_allowed
        ]
        if not modes:
            continue
        spec["supported_sync_modes"] = modes
        if spec.get("default_sync_mode") not in modes:
            spec["default_sync_mode"] = modes[0]
        spec["category"] = "datasource"
        specs.append(spec)
    return specs


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


def _get_connection_with_access(
    *,
    connection_id: str,
    service: IntegrationService,
    project_service: ProjectService,
    current_user: CurrentUser,
):
    connection = service.repository.get_by_id(connection_id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Integration connection #{connection_id} not found",
        )
    _ensure_project_access(project_service, current_user, connection.project_id)
    return connection


def _sync_resp(connection) -> SyncResponse:
    return SyncResponse(**_sync_resp_helper(connection))


def _target_from_request(body: CreateIntegrationRequest | BootstrapRequest) -> str | None:
    return body.target_path or body.target_folder_path


@router.get("/status", response_model=ApiResponse[ProjectSyncStatusResponse])
async def get_project_sync_status(
    project_id: str = Query(..., description=_PROJECT_ID_DESC),
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    connections = service.repository.list_by_project(project_id)
    items = [
        SyncStatusItem(
            id=c.id,
            path=c.path,
            node_name=c.path.rsplit("/", 1)[-1] if c.path else None,
            node_type=None,
            provider=c.provider,
            direction=c.direction,
            status=c.status,
            name=(c.config or {}).get("name"),
            access_key=None,
            trigger=c.trigger if c.trigger else None,
            last_synced_at=c.last_synced_at,
            error_message=c.error_message,
        )
        for c in connections
    ]
    return ApiResponse.success(
        data=ProjectSyncStatusResponse(syncs=items, uploads=[])
    )


@router.get("/connectors", response_model=ApiResponse)
def list_connectors(
    registry: ConnectorRegistry = Depends(get_connector_registry),
):
    return ApiResponse.success(data=_connectable_specs(registry))


@router.post("/connections", response_model=ApiResponse[CreateSyncResponse])
async def create_connection(
    body: CreateIntegrationRequest,
    service: IntegrationService = Depends(get_integration_service),
    engine: IntegrationEngine = Depends(get_integration_engine),
    registry: ConnectorRegistry = Depends(get_connector_registry),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, body.project_id)

    provider = canonical_provider(body.provider)
    connector = registry.get(provider)
    if not connector:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown integration provider: {body.provider}",
        )
    if body.sync_mode == "import_once":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One-time imports must use ImportJob, not Integration.",
        )
    if connector.spec().creation_mode != "direct":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connector {provider} must be created via bootstrap",
        )

    try:
        connection = await service.create_connection(
            project_id=body.project_id,
            provider=provider,
            config=body.config,
            target_path=_target_from_request(body),
            credentials_ref=body.credentials_ref,
            direction=body.direction,
            conflict_strategy=body.conflict_strategy,
            sync_mode=body.sync_mode,
            trigger=body.trigger,
            user_id=current_user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    if body.sync_mode == "scheduled" and body.trigger:
        try:
            from src.infra.scheduler.service import get_scheduler_service

            await get_scheduler_service().sync_trigger(
                connection_id=connection.id,
                provider=provider,
                trigger_config=body.trigger,
            )
        except Exception:
            pass

    execution_result = None
    try:
        execution_result = await engine.execute(connection.id)
    except Exception as exc:
        log_error(f"[IntegrationCreate] First fetch failed for {connection.id}: {exc}")

    refreshed = service.repository.get_by_id(connection.id) or connection
    return ApiResponse.success(
        data=CreateSyncResponse(
            sync=_sync_resp(refreshed),
            execution_result=execution_result,
        )
    )


@router.get("/connections", response_model=ApiResponse[list[SyncResponse]])
def list_connections(
    project_id: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    service: IntegrationService = Depends(get_integration_service),
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
        connections = service.repository.list_by_provider(project_id, provider)
    else:
        connections = service.repository.list_by_project(project_id)
    return ApiResponse.success(data=[_sync_resp(c) for c in connections])


@router.delete("/connections/{connection_id}", response_model=ApiResponse)
async def delete_connection(
    connection_id: str,
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    _notify_folder_source("stop", connection_id)
    try:
        from src.infra.scheduler.service import get_scheduler_service

        await get_scheduler_service().sync_trigger(connection_id)
    except Exception:
        pass
    service.remove_sync(connection_id)
    return ApiResponse.success(message="Integration connection deleted")


@router.patch("/connections/{connection_id}/trigger", response_model=ApiResponse)
async def update_connection_trigger(
    connection_id: str,
    body: UpdateIntegrationTriggerRequest,
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if body.sync_mode == "import_once":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One-time imports must use ImportJob, not Integration.",
        )
    connection = _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    trigger_data = dict(body.trigger or {})
    if not trigger_data.get("type"):
        trigger_data["type"] = body.sync_mode
    service.repository.update(connection_id, trigger=trigger_data)

    try:
        from src.infra.scheduler.service import get_scheduler_service

        await get_scheduler_service().sync_trigger(
            connection_id=connection_id,
            provider=connection.provider,
            trigger_config=trigger_data if body.sync_mode == "scheduled" else None,
        )
    except Exception:
        pass
    return ApiResponse.success(message=f"Integration trigger updated to {body.sync_mode}")


@router.post("/connections/{connection_id}/pause", response_model=ApiResponse)
def pause_connection(
    connection_id: str,
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    _notify_folder_source("stop", connection_id)
    service.pause_sync(connection_id)
    return ApiResponse.success(message="Integration paused")


@router.post("/connections/{connection_id}/refresh", response_model=ApiResponse[PullResponse])
async def refresh_connection(
    connection_id: str,
    service: IntegrationService = Depends(get_integration_service),
    engine: IntegrationEngine = Depends(get_integration_engine),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    connection = _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    if (connection.trigger or {}).get("type") == "import_once":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot refresh an import-once job.",
        )
    result = await engine.execute(connection_id)
    results = [result] if result else []
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/connections/{connection_id}/resume", response_model=ApiResponse)
async def resume_connection(
    connection_id: str,
    service: IntegrationService = Depends(get_integration_service),
    engine: IntegrationEngine = Depends(get_integration_engine),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    service.resume_sync(connection_id)
    _notify_folder_source("start", connection_id)
    try:
        await engine.execute(connection_id)
    except Exception:
        pass
    return ApiResponse.success(message="Integration resumed")


def _get_run_repo():
    from src.connectors.datasource.run_repository import SyncRunRepository
    from src.infra.supabase.client import SupabaseClient

    return SyncRunRepository(SupabaseClient())


@router.get("/failed-runs", response_model=ApiResponse[list[FailedSyncRunItem]])
def list_failed_runs(
    project_id: str = Query(..., description=_PROJECT_ID_DESC),
    limit: int = Query(50, ge=1, le=200),
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)
    connections = service.repository.list_by_project(project_id)
    if not connections:
        return ApiResponse.success(data=[])
    by_id = {c.id: c for c in connections}
    runs = _get_run_repo().list_failed_for_access_points(list(by_id), limit=limit)
    items = []
    for run in runs:
        connection = by_id.get(run.access_point_id)
        items.append(FailedSyncRunItem(
            id=run.id,
            access_point_id=run.access_point_id,
            access_point_name=(connection.config or {}).get("name") if connection else None,
            access_point_path=connection.path if connection else None,
            provider=connection.provider if connection else "",
            direction=connection.direction if connection else "",
            started_at=run.started_at,
            finished_at=run.finished_at,
            duration_ms=run.duration_ms,
            error=run.error,
            result_summary=run.result_summary,
            trigger_type=run.trigger_type,
        ))
    return ApiResponse.success(data=items)


@router.get("/connections/{connection_id}/runs", response_model=ApiResponse[list[SyncRunResponse]])
def list_connection_runs(
    connection_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _get_connection_with_access(
        connection_id=connection_id,
        service=service,
        project_service=project_service,
        current_user=current_user,
    )
    runs = _get_run_repo().list_by_sync(connection_id, limit=limit, offset=offset)
    return ApiResponse.success(data=[
        SyncRunResponse(
            id=r.id,
            access_point_id=r.access_point_id,
            status=r.status,
            started_at=r.started_at,
            finished_at=r.finished_at,
            duration_ms=r.duration_ms,
            exit_code=r.exit_code,
            error=r.error,
            trigger_type=r.trigger_type,
            result_summary=r.result_summary,
        )
        for r in runs
    ])


@router.get("/runs/{run_id}", response_model=ApiResponse[SyncRunResponse])
def get_connection_run(
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    run = _get_run_repo().get_by_id(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return ApiResponse.success(data=SyncRunResponse(
        id=run.id,
        access_point_id=run.access_point_id,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        duration_ms=run.duration_ms,
        exit_code=run.exit_code,
        stdout=run.stdout,
        error=run.error,
        trigger_type=run.trigger_type,
        result_summary=run.result_summary,
    ))


@router.post("/bootstrap", response_model=ApiResponse[BootstrapResponse])
async def bootstrap(
    body: BootstrapRequest,
    service: IntegrationService = Depends(get_integration_service),
    engine: IntegrationEngine = Depends(get_integration_engine),
    registry: ConnectorRegistry = Depends(get_connector_registry),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, body.project_id)
    provider = canonical_provider(body.provider)
    connector = registry.get(provider)
    if not connector:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown integration provider: {body.provider}",
        )
    if connector.spec().creation_mode != "bootstrap":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Connector {provider} must be created via POST /integrations/connections",
        )

    connections = await service.bootstrap(
        project_id=body.project_id,
        provider=provider,
        config=body.config,
        target_folder_path=_target_from_request(body),
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
            for connection in connections:
                await scheduler.sync_trigger(
                    connection_id=connection.id,
                    provider=provider,
                    trigger_config=body.trigger,
                )
        except Exception:
            pass

    for connection in connections:
        try:
            await engine.execute(connection.id)
        except Exception as exc:
            log_error(f"[IntegrationBootstrap] First fetch failed for {connection.id}: {exc}")

    return ApiResponse.success(data=BootstrapResponse(syncs_created=len(connections)))


@router.post("/connections/{connection_id}/push-file", response_model=ApiResponse[PushFileResponse])
async def push_file(
    connection_id: str,
    body: PushFileRequest,
    service: IntegrationService = Depends(get_integration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    parent = service.repository.get_by_id(connection_id)
    if not parent:
        return ApiResponse.error(code=1004, message=f"Integration #{connection_id} not found")

    from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container

    result = await process_push_file(
        build_worker_version_engine_container().write_commands(),
        project_id=parent.project_id,
        body=body,
        user_id=current_user.user_id,
        sync_svc=service,
        parent_sync=parent,
    )
    return ApiResponse.success(data=PushFileResponse(**result))


@router.get("/connections/{connection_id}/pull-files", response_model=ApiResponse[PullFilesResponse])
def pull_files(
    connection_id: str,
    service: IntegrationService = Depends(get_integration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    parent = service.repository.get_by_id(connection_id)
    if not parent:
        return ApiResponse.error(code=1004, message=f"Integration #{connection_id} not found")

    from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container

    files = process_pull_files(
        build_worker_version_engine_container().product_operations(),
        project_id=parent.project_id,
        body=None,
        sync_svc=service,
        parent_sync=parent,
    )
    return ApiResponse.success(data=PullFilesResponse(
        files=[PullFileItem(**item) for item in files],
        total=len(files),
    ))


@router.post("/connections/{connection_id}/ack-pull", response_model=ApiResponse)
def ack_pull(
    connection_id: str,
    body: AckPullRequest,
    service: IntegrationService = Depends(get_integration_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    return ApiResponse.success(message=f"Acknowledged {len(body.items)} files")


@router.post("/pull", response_model=ApiResponse[PullResponse])
async def trigger_pull(
    connection_id: Optional[str] = Query(None, description="Connection ID. Omit to pull all."),
    sync_id: Optional[str] = Query(None, description="Legacy sync ID alias."),
    provider: Optional[str] = Query(None),
    engine: IntegrationEngine = Depends(get_integration_engine),
    current_user: CurrentUser = Depends(get_current_user),
):
    target_id = connection_id or sync_id
    if target_id:
        result = await engine.execute(target_id)
        results = [result] if result else []
    else:
        results = await engine.execute_all(provider)
    return ApiResponse.success(data=PullResponse(synced=len(results), results=results))


@router.post("/push/{path:path}", response_model=ApiResponse[PushResponse])
async def trigger_push(
    path: str,
    project_id: str = Query(..., description=_PROJECT_ID_DESC),
    engine: IntegrationEngine = Depends(get_integration_engine),
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.version_engine.bootstrap.dependencies import build_worker_version_engine_container
    from src.version_engine.read.tree_reader import detect_type
    import json as _json

    ops = build_worker_version_engine_container().product_operations()
    try:
        content = ops.read_file(project_id, path)
    except FileNotFoundError:
        return ApiResponse.error(code=1004, message=f"File not found: {path}")

    node_type = detect_type(path)
    if node_type == "json":
        try:
            parsed_content: Any = _json.loads(content.decode("utf-8"))
        except ValueError:
            parsed_content = content.decode("utf-8", errors="replace")
    else:
        parsed_content = content.decode("utf-8", errors="replace")

    result = await engine.push_execute(
        path=path,
        commit_id=ops.get_head_commit_id(project_id),
        content=parsed_content,
        node_type=node_type,
    )
    return ApiResponse.success(data=PushResponse(
        pushed=1 if result else 0,
        results=[result] if result else [],
    ))


@router.get("/changelog", response_model=ApiResponse[ChangelogResponse])
def get_integration_changelog(
    project_id: str = Query(..., description=_PROJECT_ID_DESC),
    cursor: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    service: IntegrationService = Depends(get_integration_service),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_project_access(project_service, current_user, project_id)

    from src.connectors.datasource.changelog import SyncChangelogRepository
    from src.infra.supabase.client import SupabaseClient

    entries = SyncChangelogRepository(SupabaseClient()).list_since(
        project_id,
        cursor=cursor,
        limit=limit + 1,
    )
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
