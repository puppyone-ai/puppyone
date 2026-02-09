from fastapi import APIRouter, Depends, Query, status
from typing import List, Optional
from src.table.service import TableService
from src.table.dependencies import get_table_service, get_verified_table
from src.table.models import Table
from src.table.schemas import (
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
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.exceptions import NotFoundException, ErrorCode

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
    description="获取当前用户的所有项目，每个项目包含其下的所有表格信息",
    response_description="返回用户的所有项目列表，每个项目包含其下的表格列表",
    status_code=status.HTTP_200_OK,
)
def list_tables(
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 获取用户的所有项目及其下的表格
    projects_with_tables = table_service.get_projects_with_tables_by_user_id(
        current_user.user_id
    )
    return ApiResponse.success(
        data=projects_with_tables, message="项目及表格列表获取成功"
    )


@router.get(
    "/orphan",
    response_model=ApiResponse[List[TableOut]],
    summary="获取未分类的表格",
    description="获取当前用户的所有裸 Table（不属于任何 Project）",
    response_description="返回未分类的表格列表",
    status_code=status.HTTP_200_OK,
)
def list_orphan_tables(
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    tables = table_service.get_orphan_tables_by_user_id(current_user.user_id)
    return ApiResponse.success(data=tables, message="获取成功")


@router.get(
    "/{table_id}",
    response_model=ApiResponse[TableOut],
    summary="获取单个表格详情",
    description="根据表格ID获取单个表格的详细信息。如果表格不存在，将返回错误。",
    response_description="返回表格详细信息",
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
    description="创建一个新的表格（Table）。项目ID为可选，不传则创建裸Table。如果指定项目ID，会验证项目是否存在且属于当前用户。",
    response_description="返回创建成功的表格信息",
    status_code=status.HTTP_201_CREATED,
)
def create_table(
    payload: TableCreate,
    table_service: TableService = Depends(get_table_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 如果指定了 project_id，验证项目是否属于当前用户
    if payload.project_id is not None:
        if not table_service.verify_project_access(
            payload.project_id, current_user.user_id
        ):
            raise NotFoundException(
                f"Project not found: {payload.project_id}", code=ErrorCode.NOT_FOUND
            )

    # 创建表格
    table = table_service.create(
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
    description="根据表格ID更新表格的名称、描述和数据。所有字段都是可选的，只更新用户提供的字段，未提供的字段保持不变。如果表格不存在，将返回错误。",
    response_description="返回更新后的表格信息",
    status_code=status.HTTP_200_OK,
)
def update_table(
    table: Table = Depends(get_verified_table),
    payload: TableUpdate = ...,
    table_service: TableService = Depends(get_table_service),
):
    updated_table = table_service.update(
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
    description="根据表格ID删除指定的表格。如果表格不存在，将返回错误。",
    response_description="删除成功，返回空数据",
    status_code=status.HTTP_200_OK,
)
def delete_table(
    table: Table = Depends(get_verified_table),
    table_service: TableService = Depends(get_table_service),
):
    table_service.delete(table.id)
    return ApiResponse.success(message="表格删除成功")


# Context Data 相关的接口
@router.post(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="在表格中创建数据",
    description='在指定表格的 data 字段中，通过 JSON 指针路径创建新的数据项。可以一次创建多个元素，每个元素包含 key 和 content。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如："/users"、"/users/123"\n- **根路径：使用空字符串 "" 可以在 data 的根路径下添加 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径添加 key：`mounted_json_pointer_path: ""`\n- 在 /users 路径下添加 key：`mounted_json_pointer_path: "/users"`',
    response_description="返回创建后的数据",
    status_code=status.HTTP_201_CREATED,
)
def create_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataCreate = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = table_service.create_context_data(
        table_id=table.id,
        mounted_json_pointer_path=payload.mounted_json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements],
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据创建成功")


@router.get(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="获取表格中的数据",
    description='根据表格ID和JSON指针路径，获取表格中指定路径的数据。JSON指针路径使用RFC 6901标准格式（例如："/users/123"）。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如："/users"、"/users/123"\n- **根路径：使用空字符串 "" 可以获取整个 data**\n\n**示例：**\n- 获取根路径数据：`json_pointer_path=""`\n- 获取 /users 路径数据：`json_pointer_path="/users"`',
    response_description="返回指定路径的数据",
    status_code=status.HTTP_200_OK,
)
def get_context_data(
    table: Table = Depends(get_verified_table),
    json_pointer_path: Optional[str] = Query(
        default="",
        description='JSON指针路径，使用RFC 6901标准格式。例如：/users 或 /users/123。根路径使用空字符串 "" 可以获取整个 data。如果不传此参数，默认为空字符串（根路径）',
        min_length=0,
        examples=["", "/users", "/users/123"],
    ),
    table_service: TableService = Depends(get_table_service),
):
    # 如果未传入参数或为 None，使用空字符串（根路径）
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
    description='在指定表格的 data 字段中，通过 JSON 指针路径更新已存在的数据项。只能更新已存在的 key，不能创建新的 key。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如："/users"、"/users/123"\n- **根路径：使用空字符串 "" 可以在 data 的根路径下更新 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径更新 key：`json_pointer_path: ""`\n- 在 /users 路径下更新 key：`json_pointer_path: "/users"`',
    response_description="返回更新后的数据",
    status_code=status.HTTP_200_OK,
)
def update_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataUpdate = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = table_service.update_context_data(
        table_id=table.id,
        json_pointer_path=payload.json_pointer_path,
        elements=[{"key": e.key, "content": e.content} for e in payload.elements],
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据更新成功")


@router.delete(
    "/{table_id}/data",
    response_model=ApiResponse[ContextDataGet],
    summary="删除表格中的数据",
    description='在指定表格的 data 字段中，通过 JSON 指针路径删除指定路径下的一个或多个 key。只能删除已存在的 key。\n\n**JSON指针路径说明：**\n- 使用 RFC 6901 标准格式，例如："/users"、"/users/123"\n- **根路径：使用空字符串 "" 可以在 data 的根路径下删除 key**\n- 路径必须指向一个已存在的字典类型节点\n\n**示例：**\n- 在根路径删除 key：`json_pointer_path: ""`\n- 在 /users 路径下删除 key：`json_pointer_path: "/users"`',
    response_description="返回删除后的数据",
    status_code=status.HTTP_200_OK,
)
def delete_context_data(
    table: Table = Depends(get_verified_table),
    payload: ContextDataDelete = ...,
    table_service: TableService = Depends(get_table_service),
):
    data = table_service.delete_context_data(
        table_id=table.id,
        json_pointer_path=payload.json_pointer_path,
        keys=payload.keys,
    )
    return ApiResponse.success(data=ContextDataGet(data=data), message="数据删除成功")
