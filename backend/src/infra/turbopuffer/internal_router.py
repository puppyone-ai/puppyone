"""
Turbopuffer Internal Debug Router

Notes:
- This router is for development/debug only; should be protected via `src.internal.router` SECRET auth
- This router is not part of the public API contract; return structure aims to be stable but no long-term compatibility guarantee
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, status

from src.common_schemas import ApiResponse
from src.infra.turbopuffer.config import TurbopufferConfig
from src.infra.turbopuffer.dependencies import (
    get_turbopuffer_config,
    get_turbopuffer_search_service,
)
from src.infra.turbopuffer.service import TurbopufferSearchService

router = APIRouter(prefix="/turbopuffer", tags=["internal"])


@router.get(
    "/config",
    response_model=ApiResponse[dict[str, Any]],
    summary="View Turbopuffer config (without exposing secrets)",
    status_code=status.HTTP_200_OK,
)
def get_config(
    cfg: TurbopufferConfig = Depends(get_turbopuffer_config),
):
    return ApiResponse.success(
        data={
            "configured": cfg.configured,
            "region": cfg.region,
            "timeout_seconds": cfg.timeout_seconds,
        },
        message="Successfully retrieved turbopuffer config",
    )


@router.get(
    "/namespaces",
    response_model=ApiResponse[dict[str, Any]],
    summary="List namespaces (paginated)",
    status_code=status.HTTP_200_OK,
)
async def list_namespaces(
    prefix: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    page_size: int | None = Query(default=None, ge=1, le=1000),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.list_namespaces(prefix=prefix, cursor=cursor, page_size=page_size)
    # ApiResponse generic with pydantic v2 complex nesting can cause schema expansion issues; returning dict is more stable
    return ApiResponse.success(data=resp.model_dump(), message="Successfully listed namespaces")


@router.get(
    "/namespaces/{namespace}/metadata",
    response_model=ApiResponse[dict[str, Any]],
    summary="Get namespace metadata",
    status_code=status.HTTP_200_OK,
)
async def get_metadata(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    meta = await svc.metadata(namespace)
    return ApiResponse.success(data=meta, message="Successfully retrieved namespace metadata")


@router.post(
    "/namespaces/{namespace}/write",
    response_model=ApiResponse[dict[str, Any]],
    summary="Write (pass-through payload)",
    description="Directly pass through turbopuffer write payload (dangerous: may contain deletes/delete_by_filter and other destructive operations)",
    status_code=status.HTTP_200_OK,
)
async def write_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.write_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="Write successful")


@router.post(
    "/namespaces/{namespace}/query",
    response_model=ApiResponse[dict[str, Any]],
    summary="Query (pass-through payload)",
    status_code=status.HTTP_200_OK,
)
async def query_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.query_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="Query successful")


@router.post(
    "/namespaces/{namespace}/multi_query",
    response_model=ApiResponse[dict[str, Any]],
    summary="multi_query (pass-through payload)",
    status_code=status.HTTP_200_OK,
)
async def multi_query_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.multi_query_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="multi_query successful")


@router.post(
    "/namespaces/{namespace}/warm_cache",
    response_model=ApiResponse[dict[str, Any]],
    summary="Warm cache (hint_cache_warm)",
    status_code=status.HTTP_200_OK,
)
async def warm_cache(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.hint_cache_warm(namespace)
    return ApiResponse.success(data=resp, message="Warm cache hint successful")


@router.post(
    "/namespaces/{namespace}/recall",
    response_model=ApiResponse[dict[str, Any]],
    summary="Recall measurement",
    status_code=status.HTTP_200_OK,
)
async def recall(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.recall(
        namespace,
        num=payload.get("num"),
        top_k=payload.get("top_k"),
        filters=payload.get("filters"),
        queries=payload.get("queries"),
    )
    return ApiResponse.success(data=resp, message="Recall successful")


@router.delete(
    "/namespaces/{namespace}",
    response_model=ApiResponse[None],
    summary="Delete namespace (dangerous)",
    status_code=status.HTTP_200_OK,
)
async def delete_namespace(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    await svc.delete_namespace(namespace)
    return ApiResponse.success(data=None, message="Successfully deleted namespace")


@router.delete(
    "/namespaces/{namespace}/delete_all",
    response_model=ApiResponse[None],
    summary="Delete all documents in namespace (dangerous)",
    status_code=status.HTTP_200_OK,
)
async def delete_all(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    await svc.delete_all(namespace)
    return ApiResponse.success(data=None, message="Successfully deleted all documents")
