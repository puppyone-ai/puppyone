"""
Context Publish API

- Management endpoints (login required): /api/v1/publishes/*
- Public read endpoint (no login required): /p/{publish_key}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse
from typing import List

from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.context_publish.dependencies import get_context_publish_service
from src.context_publish.schemas import PublishCreate, PublishOut, PublishUpdate
from src.context_publish.service import ContextPublishService


router = APIRouter(prefix="/publishes", tags=["publishes"])
public_router = APIRouter(tags=["publishes"])


def _build_public_url(request: Request, publish_key: str) -> str:
    base = (settings.PUBLIC_URL or "").strip()
    base = base.rstrip("/") if base else str(request.base_url).rstrip("/")
    return f"{base}/p/{publish_key}"


def _to_out(request: Request, p) -> PublishOut:
    return PublishOut(
        id=p.id,
        created_at=p.created_at,
        updated_at=p.updated_at,
        created_by=p.created_by,
        table_id=p.table_id,
        json_path=p.json_path,
        publish_key=p.publish_key,
        status=p.status,
        expires_at=p.expires_at,
        url=_build_public_url(request, p.publish_key),
    )


@router.post(
    "/",
    response_model=ApiResponse[PublishOut],
    summary="Create publish (public read-only link for sub-JSON)",
    status_code=status.HTTP_201_CREATED,
)
def create_publish(
    request: Request,
    payload: PublishCreate,
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    p = svc.create(
        created_by=current_user.user_id,
        table_id=payload.table_id,
        json_path=payload.json_path,
        expires_at=payload.expires_at,
    )
    return ApiResponse.success(data=_to_out(request, p), message="Publish created successfully")


@router.get(
    "/",
    response_model=ApiResponse[List[PublishOut]],
    summary="List publishes for the current user",
    status_code=status.HTTP_200_OK,
)
def list_publishes(
    request: Request,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    items = svc.list_by_created_by(current_user.user_id, skip=skip, limit=limit)
    return ApiResponse.success(
        data=[_to_out(request, p) for p in items],
        message="Publish list retrieved successfully",
    )


@router.patch(
    "/{publish_id}",
    response_model=ApiResponse[PublishOut],
    summary="Update publish (status/expires_at)",
    status_code=status.HTTP_200_OK,
)
def update_publish(
    request: Request,
    publish_id: int,
    payload: PublishUpdate,
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    p = svc.update(
        publish_id=publish_id,
        created_by=current_user.user_id,
        status=payload.status,
        expires_at=payload.expires_at,
    )
    return ApiResponse.success(data=_to_out(request, p), message="Publish updated successfully")


@router.delete(
    "/{publish_id}",
    response_model=ApiResponse[None],
    summary="Delete publish",
    status_code=status.HTTP_200_OK,
)
def delete_publish(
    publish_id: int,
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.delete(publish_id=publish_id, created_by=current_user.user_id)
    return ApiResponse.success(data=None, message="Publish deleted successfully")


@public_router.get(
    "/p/{publish_key}",
    summary="Public read of publish raw JSON (short link)",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
)
def get_public_json(
    publish_key: str,
    svc: ContextPublishService = Depends(get_context_publish_service),
):
    # Return raw JSON (do not wrap in ApiResponse)
    data = svc.get_public_json(publish_key)
    return JSONResponse(content=data)
