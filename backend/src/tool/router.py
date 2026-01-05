"""
Tool 管理 API

对 public.tool 提供 CRUD。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from typing import List

from src.auth.dependencies import get_current_user
from src.auth.models import CurrentUser
from src.common_schemas import ApiResponse
from src.tool.dependencies import get_tool_service
from src.tool.schemas import ToolCreate, ToolOut, ToolUpdate
from src.tool.service import ToolService


router = APIRouter(prefix="/tools", tags=["tools"])


@router.get(
    "/",
    response_model=ApiResponse[List[ToolOut]],
    summary="获取当前用户的 Tool 列表",
    status_code=status.HTTP_200_OK,
)
def list_tools(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=1000),
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tools = tool_service.list_user_tools(current_user.user_id, skip=skip, limit=limit)
    return ApiResponse.success(data=tools, message="获取 Tool 列表成功")


@router.get(
    "/by-table/{table_id}",
    response_model=ApiResponse[List[ToolOut]],
    summary="获取某个 table_id 下的 Tool 列表",
    status_code=status.HTTP_200_OK,
)
def list_tools_by_table_id(
    table_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=1000),
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tools = tool_service.list_user_tools_by_table_id(
        current_user.user_id,
        table_id=table_id,
        skip=skip,
        limit=limit,
    )
    return ApiResponse.success(data=tools, message="获取 Tool 列表成功")


@router.post(
    "/",
    response_model=ApiResponse[ToolOut],
    summary="创建 Tool",
    status_code=status.HTTP_201_CREATED,
)
def create_tool(
    payload: ToolCreate,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tool = tool_service.create(
        user_id=current_user.user_id,
        table_id=payload.table_id,
        json_path=payload.json_path,
        type=payload.type,
        name=payload.name,
        alias=payload.alias,
        description=payload.description,
        input_schema=payload.input_schema,
        output_schema=payload.output_schema,
        metadata=payload.metadata,
    )
    return ApiResponse.success(data=tool, message="创建 Tool 成功")


@router.get(
    "/{tool_id}",
    response_model=ApiResponse[ToolOut],
    summary="获取 Tool",
    status_code=status.HTTP_200_OK,
)
def get_tool(
    tool_id: int,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tool = tool_service.get_by_id_with_access_check(tool_id, current_user.user_id)
    return ApiResponse.success(data=tool, message="获取 Tool 成功")


@router.put(
    "/{tool_id}",
    response_model=ApiResponse[ToolOut],
    summary="更新 Tool",
    status_code=status.HTTP_200_OK,
)
def update_tool(
    tool_id: int,
    payload: ToolUpdate,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 只更新「请求体里实际传入」的字段，没传入的不影响
    patch = payload.model_dump(exclude_unset=True)
    tool = tool_service.update(
        tool_id=tool_id, user_id=current_user.user_id, patch=patch
    )
    return ApiResponse.success(data=tool, message="更新 Tool 成功")


@router.delete(
    "/{tool_id}",
    response_model=ApiResponse[None],
    summary="删除 Tool",
    status_code=status.HTTP_200_OK,
)
def delete_tool(
    tool_id: int,
    tool_service: ToolService = Depends(get_tool_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tool_service.delete(tool_id, current_user.user_id)
    return ApiResponse.success(data=None, message="删除 Tool 成功")
