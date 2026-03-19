from fastapi import APIRouter, Depends, Query, status
from typing import List, Optional
from src.content.table.service import TableService
from src.content.table.dependencies import get_table_service, get_verified_table
from src.content.table.models import Table
from src.content.table.schemas import (
    TableCreate,
    TableUpdate,
    TableOut,
    ContextDataCreate,
    ContextDataUpdate,
    ContextDataDelete,
    ContextDataGet,
    ProjectWithTables,
)
from src.common_schemas import ApiResponse
from src.platform.auth.models import CurrentUser
from src.platform.auth.dependencies import get_current_user
from src.exceptions import NotFoundException, ErrorCode
from src.platform.organization.dependencies import resolve_org_ids

router = APIRouter(
    prefix="/tables",
    tags=["tables"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


@router.get(
    "/",
    response_model=ApiResponse[List[ProjectWithTables]],
    summary="获取所有项目及其下的表格",
    status_code=status.HTTP_200_OK,
)
def list_tables(
    org_id: Optional[str] = Query(None, description="组织ID"),
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    oids = resolve_org_ids(org_id, current_user.user_id)
    all_results = []
    for oid in oids:
        all_results.extend(table_service.get_projects_with_tables_by_org_id(oid))
    return ApiResponse.success(data=all_results, message="项目及表格列表获取成功")


@router.get(
    "/orphan",
    response_model=ApiResponse[List[TableOut]],
    summary="获取未分类的表格",
    status_code=status.HTTP_200_OK,
)
def list_orphan_tables(
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tables = table_service.get_orphan_tables_by_created_by(current_user.user_id)
    return ApiResponse.success(data=tables, message="获取成功")


@router.get(
    "/{table_id}",
    response_model=ApiResponse[TableOut],
    summary="获取单个表格详情",
    status_code=status.HTTP_200_OK,
)
def get_table(
    table: Table = Depends(get_verified_table),
):
    return ApiResponse.success(data=table, message="表格获取成功")


@router.post(
    "/",
    response_model=ApiResponse[TableOut],
    summary="创建新的表格",
    status_code=status.HTTP_201_CREATED,
)
async def create_table(
    payload: TableCreate,
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    if payload.project_id is not None:
        if not table_service.verify_project_access(
            payload.project_id, current_user.user_id
        ):
            raise NotFoundException(
                f"Project not found: {payload.project_id}", code=ErrorCode.NOT_FOUND
            )

    table = await table_service.create(
        user_id=current_user.user_id,
        name=payload.name,
        description=payload.description,
        data=payload.data or {},
        project_id=payload.project_id,
    )
    return ApiResponse.success(data=table, message="表格创建成功")


@router.put(
    "/{table_id}",
    response_model=ApiResponse[TableOut],
    summary="更新表格信息",
    status_code=status.HTTP_200_OK,
)
async def update_table(
    table: Table = Depends(get_verified_table),
    payload: TableUpdate = ...,
    table_service: TableService = Depends(get_table_service),
):
    updated_table = await table_service.update(
        table_id=table.id,
        name=payload.name,
        description=payload.description,
        data=payload.data,
    )
    return ApiResponse.success(data=updated_table, message="表格更新成功")


@router.delete(
    "/{table_id}",
    response_model=ApiResponse[None],
    summary="删除表格",
    status_code=status.HTTP_200_OK,
)
async def delete_table(
    table: Table = Depends(get_verified_table),
    table_service: TableService = Depends(get_table_service),
):
    await table_service.delete(table.id)
    return ApiResponse.success(message="表格删除成功")


@router.post(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="在表格中创建数据",
    description='通过 JSON 指针路径在表格 data 中创建新数据项。路径使用 RFC 6901 格式。根路径使用空字符串 ""。',
    status_code=status.HTTP_201_CREATED,
)
async def create_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataCreate = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = await table_service.create_context_data(
        table_id=table.id,
        mounted_json_pointer_path=payload.mounted_json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements],
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据创建成功")


@router.get(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="获取表格中的数据",
    description='通过 JSON 指针路径获取数据。路径使用 RFC 6901 格式。根路径使用空字符串 ""。',
    status_code=status.HTTP_200_OK,
)
def get_context_data(
    table: Table = Depends(get_verified_table),
    json_pointer_path: Optional[str] = Query(
        default="",
        description='JSON指针路径 (RFC 6901)',
        min_length=0,
        examples=["", "/users", "/users/123"],
    ),
    table_service: TableService = Depends(get_table_service),
):
    if json_pointer_path is None:
        json_pointer_path = ""

    data = table_service.get_context_data(
        table_id=table.id, json_pointer_path=json_pointer_path
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据获取成功")


@router.put(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="更新表格中的数据",
    description='通过 JSON 指针路径更新已存在的数据项。路径使用 RFC 6901 格式。根路径使用空字符串 ""。',
    status_code=status.HTTP_200_OK,
)
async def update_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataUpdate = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = await table_service.update_context_data(
        table_id=table.id,
        json_pointer_path=payload.json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements],
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据更新成功")


@router.delete(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="删除表格中的数据",
    description='通过 JSON 指针路径删除数据。路径使用 RFC 6901 格式。根路径使用空字符串 ""。',
    status_code=status.HTTP_200_OK,
)
async def delete_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataDelete = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = await table_service.delete_context_data(
        table_id=table.id,
        json_pointer_path=payload.json_pointer_path,
        keys=payload.keys,
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据删除成功")
