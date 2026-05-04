"""HTTP API for connectors CRUD + run orchestration.

Mounted at /api/v1/projects/{project_id}/connectors.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.common_schemas import ApiResponse
from src.exceptions import AppException
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.project.dependencies import get_verified_project
from src.platform.project.models import Project
from src.repo.connector_service import ConnectorService
from src.repo.models import Connector
from src.repo.schemas import (
    ConnectorIn, ConnectorPatch, ConnectorOut,
)


router = APIRouter(
    prefix="/projects/{project_id}/connectors",
    tags=["connectors"],
)


def get_connector_service() -> ConnectorService:
    return ConnectorService()


def _to_out(c: Connector) -> ConnectorOut:
    return ConnectorOut(
        id=c.id,
        project_id=c.project_id,
        scope_id=c.scope_id,
        provider=c.provider,
        name=c.name,
        direction=c.direction,                    # type: ignore[arg-type]
        config=c.config,
        oauth_connection_id=c.oauth_connection_id,
        trigger=c.trigger,
        status=c.status,
        last_run_at=c.last_run_at,
        last_run_id=c.last_run_id,
        error_message=c.error_message,
        created_by=c.created_by,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get(
    "",
    response_model=ApiResponse[list[ConnectorOut]],
    summary="List connectors (optionally filtered)",
)
def list_connectors(
    scope_id: Optional[str] = Query(None),
    provider: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    items = service.list(
        str(project.id), scope_id=scope_id, provider=provider, direction=direction,
    )
    return ApiResponse.success(data=[_to_out(c) for c in items], message="Connectors listed")


@router.post(
    "",
    response_model=ApiResponse[ConnectorOut],
    status_code=status.HTTP_201_CREATED,
    summary="Create a third-party connector",
)
def create_connector(
    payload: ConnectorIn,
    project: Project = Depends(get_verified_project),
    current_user: CurrentUser = Depends(get_current_user),
    service: ConnectorService = Depends(get_connector_service),
):
    try:
        c = service.create(
            project_id=str(project.id),
            scope_id=payload.scope_id,
            provider=payload.provider,
            direction=payload.direction,
            name=payload.name,
            config=payload.config,
            oauth_connection_id=payload.oauth_connection_id,
            trigger=(payload.trigger.model_dump() if payload.trigger else None),
            created_by=current_user.user_id,
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return ApiResponse.success(data=_to_out(c), message="Connector created")


@router.patch(
    "/{connector_id}",
    response_model=ApiResponse[ConnectorOut],
    summary="Update connector fields",
)
def update_connector(
    connector_id: str,
    payload: ConnectorPatch,
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    existing = service.get(connector_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Connector not found")
    patch = payload.model_dump(exclude_unset=True)
    if "trigger" in patch and patch["trigger"] is not None:
        # Pydantic gave us a TriggerSpec dict-like; pass through.
        patch["trigger"] = dict(patch["trigger"])
    try:
        updated = service.update(connector_id, patch)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    if updated is None:
        raise HTTPException(status_code=404, detail="Connector not found after update")
    return ApiResponse.success(data=_to_out(updated), message="Connector updated")


@router.post(
    "/{connector_id}/run",
    response_model=ApiResponse[dict],
    summary="Trigger a connector run now",
)
async def run_connector(
    connector_id: str,
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    existing = service.get(connector_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Connector not found")
    try:
        run_id = await service.run_now(connector_id)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return ApiResponse.success(data={"run_id": run_id}, message="Run triggered")


@router.post(
    "/{connector_id}/pause",
    response_model=ApiResponse[None],
    summary="Pause a connector",
)
def pause_connector(
    connector_id: str,
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    existing = service.get(connector_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Connector not found")
    service.pause(connector_id)
    return ApiResponse.success(message="Connector paused")


@router.post(
    "/{connector_id}/resume",
    response_model=ApiResponse[None],
    summary="Resume a connector",
)
def resume_connector(
    connector_id: str,
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    existing = service.get(connector_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Connector not found")
    service.resume(connector_id)
    return ApiResponse.success(message="Connector resumed")


@router.delete(
    "/{connector_id}",
    response_model=ApiResponse[None],
    summary="Delete a non-builtin connector",
)
def delete_connector(
    connector_id: str,
    project: Project = Depends(get_verified_project),
    service: ConnectorService = Depends(get_connector_service),
):
    existing = service.get(connector_id)
    if existing is None or existing.project_id != str(project.id):
        raise HTTPException(status_code=404, detail="Connector not found")
    try:
        service.delete(connector_id)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    return ApiResponse.success(message="Connector deleted")
