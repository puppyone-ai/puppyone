"""
Context Publish API

- 管理端点（需登录）：/api/v1/publishes/*
- 公共读取端点（无需登录）：/p/{publish_key}
"""

from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse
from typing import List

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.config import settings
from src.context_publish.dependencies import get_context_publish_service
from src.context_publish.schemas import PublishCreate, PublishOut, PublishUpdate
from src.context_publish.service import ContextPublishService


router = APIRouter(prefix="/publishes", tags=["publishes"])
public_router = APIRouter(tags=["publishes"])


def _build_public_url(request: Request, publish_key: str) -> str:
    base = (settings.PUBLIC_URL or "").strip()
    if base:
        base = base.rstrip("/")
    else:
        base = str(request.base_url).rstrip("/")
    return f"{base}/p/{publish_key}"


def _to_out(request: Request, p) -> PublishOut:
    return PublishOut(
        id=p.id,
        created_at=p.created_at,
        updated_at=p.updated_at,
        user_id=p.user_id,
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
    summary="创建 publish（子 JSON 公开只读链接）",
    status_code=status.HTTP_201_CREATED,
)
def create_publish(
    request: Request,
    payload: PublishCreate,
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    p = svc.create(
        user_id=current_user.user_id,
        table_id=payload.table_id,
        json_path=payload.json_path,
        expires_at=payload.expires_at,
    )
    return ApiResponse.success(data=_to_out(request, p), message="创建 Publish 成功")


@router.get(
    "/",
    response_model=ApiResponse[List[PublishOut]],
    summary="列出当前用户的 publish",
    status_code=status.HTTP_200_OK,
)
def list_publishes(
    request: Request,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    items = svc.list_user_publishes(current_user.user_id, skip=skip, limit=limit)
    return ApiResponse.success(
        data=[_to_out(request, p) for p in items],
        message="获取 Publish 列表成功",
    )


@router.patch(
    "/{publish_id}",
    response_model=ApiResponse[PublishOut],
    summary="更新 publish（status/expires_at）",
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
        user_id=current_user.user_id,
        status=payload.status,
        expires_at=payload.expires_at,
    )
    return ApiResponse.success(data=_to_out(request, p), message="更新 Publish 成功")


@router.delete(
    "/{publish_id}",
    response_model=ApiResponse[None],
    summary="删除 publish",
    status_code=status.HTTP_200_OK,
)
def delete_publish(
    publish_id: int,
    svc: ContextPublishService = Depends(get_context_publish_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    svc.delete(publish_id=publish_id, user_id=current_user.user_id)
    return ApiResponse.success(data=None, message="删除 Publish 成功")


@public_router.get(
    "/p/{publish_key}",
    summary="公开读取 publish 的 raw JSON（短链接）",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
)
def get_public_json(
    publish_key: str,
    svc: ContextPublishService = Depends(get_context_publish_service),
):
    # 返回 raw JSON（不要包 ApiResponse）
    data = svc.get_public_json(publish_key)
    return JSONResponse(content=data)


