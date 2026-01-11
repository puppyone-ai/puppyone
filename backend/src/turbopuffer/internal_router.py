"""
Turbopuffer Internal Debug Router

说明：
- 该路由仅用于开发/调试，建议通过 `src.internal.router` 的 SECRET 鉴权保护
- 该路由不属于对外（public）API 契约；返回结构尽量稳定，但不承诺长期兼容
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, status

from src.common_schemas import ApiResponse
from src.turbopuffer.config import TurbopufferConfig
from src.turbopuffer.dependencies import (
    get_turbopuffer_config,
    get_turbopuffer_search_service,
)
from src.turbopuffer.service import TurbopufferSearchService

router = APIRouter(prefix="/turbopuffer", tags=["internal"])


@router.get(
    "/config",
    response_model=ApiResponse[dict[str, Any]],
    summary="查看 Turbopuffer 配置（不暴露密钥）",
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
        message="获取 turbopuffer 配置成功",
    )


@router.get(
    "/namespaces",
    response_model=ApiResponse[dict[str, Any]],
    summary="列出 namespaces（分页）",
    status_code=status.HTTP_200_OK,
)
async def list_namespaces(
    prefix: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    page_size: int | None = Query(default=None, ge=1, le=1000),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.list_namespaces(prefix=prefix, cursor=cursor, page_size=page_size)
    # ApiResponse 泛型对 pydantic v2 的复杂嵌套容易引起 schema 展开问题，这里返回 dict 更稳
    return ApiResponse.success(data=resp.model_dump(), message="列出 namespaces 成功")


@router.get(
    "/namespaces/{namespace}/metadata",
    response_model=ApiResponse[dict[str, Any]],
    summary="获取 namespace 元信息",
    status_code=status.HTTP_200_OK,
)
async def get_metadata(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    meta = await svc.metadata(namespace)
    return ApiResponse.success(data=meta, message="获取 namespace metadata 成功")


@router.post(
    "/namespaces/{namespace}/write",
    response_model=ApiResponse[dict[str, Any]],
    summary="写入（payload 透传）",
    description="直接透传 turbopuffer write payload（危险：可能包含 deletes/delete_by_filter 等破坏性操作）",
    status_code=status.HTTP_200_OK,
)
async def write_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.write_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="write 成功")


@router.post(
    "/namespaces/{namespace}/query",
    response_model=ApiResponse[dict[str, Any]],
    summary="查询（payload 透传）",
    status_code=status.HTTP_200_OK,
)
async def query_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.query_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="query 成功")


@router.post(
    "/namespaces/{namespace}/multi_query",
    response_model=ApiResponse[dict[str, Any]],
    summary="multi_query（payload 透传）",
    status_code=status.HTTP_200_OK,
)
async def multi_query_raw(
    namespace: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.multi_query_raw(namespace, payload)
    return ApiResponse.success(data=resp.model_dump(), message="multi_query 成功")


@router.post(
    "/namespaces/{namespace}/warm_cache",
    response_model=ApiResponse[dict[str, Any]],
    summary="预热缓存（hint_cache_warm）",
    status_code=status.HTTP_200_OK,
)
async def warm_cache(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    resp = await svc.hint_cache_warm(namespace)
    return ApiResponse.success(data=resp, message="warm cache hint 成功")


@router.post(
    "/namespaces/{namespace}/recall",
    response_model=ApiResponse[dict[str, Any]],
    summary="召回测量（recall）",
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
    return ApiResponse.success(data=resp, message="recall 成功")


@router.delete(
    "/namespaces/{namespace}",
    response_model=ApiResponse[None],
    summary="删除 namespace（危险）",
    status_code=status.HTTP_200_OK,
)
async def delete_namespace(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    await svc.delete_namespace(namespace)
    return ApiResponse.success(data=None, message="删除 namespace 成功")


@router.delete(
    "/namespaces/{namespace}/delete_all",
    response_model=ApiResponse[None],
    summary="删除 namespace 内所有文档（危险）",
    status_code=status.HTTP_200_OK,
)
async def delete_all(
    namespace: str,
    svc: TurbopufferSearchService = Depends(get_turbopuffer_search_service),
):
    await svc.delete_all(namespace)
    return ApiResponse.success(data=None, message="删除所有文档成功")
