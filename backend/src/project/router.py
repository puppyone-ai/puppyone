"""
Project Router

提供项目 CRUD 的 REST API 接口。
"""

from fastapi import APIRouter, Depends, status
from typing import List

from src.project.service import ProjectService
from src.project.dependencies import get_project_service, get_verified_project
from src.project.models import Project
from src.project.schemas import (
    ProjectOut,
    ProjectCreate,
    ProjectUpdate,
    TableInfo,
    FolderImportRequest,
    FolderImportResponse,
    TableOut,
    BinaryFileInfo,
)
from src.supabase.dependencies import get_supabase_repository
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.exceptions import NotFoundException, ErrorCode

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


def _convert_to_project_out(project: Project, tables=None) -> ProjectOut:
    """将 Project 转换为 ProjectOut"""
    table_infos = []
    if tables:
        for t in tables:
            # 计算 rows: 如果 data 是 list 则取长度，否则取 dict 的 key 数量
            rows = None
            if t.data is not None:
                if isinstance(t.data, list):
                    rows = len(t.data)
                elif isinstance(t.data, dict):
                    rows = len(t.data)
            table_infos.append(TableInfo(
                id=str(t.id),
                name=t.name or "",
                rows=rows,
            ))
    
    return ProjectOut(
        id=str(project.id),
        name=project.name,
        description=project.description,
        tables=table_infos,
    )


@router.get(
    "/",
    response_model=ApiResponse[List[ProjectOut]],
    summary="获取项目列表",
    description="获取当前用户的所有项目列表，包含每个项目下的表信息。",
    response_description="返回用户的所有项目列表，每个项目包含其下的表格列表",
    status_code=status.HTTP_200_OK,
)
def list_projects(
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 获取当前用户的所有项目
    projects = project_service.get_by_user_id(current_user.user_id)
    
    # 需要获取每个项目的表信息
    supabase_repo = get_supabase_repository()
    
    result = []
    for p in projects:
        tables = supabase_repo.get_tables(project_id=p.id)
        result.append(_convert_to_project_out(p, tables))
    return ApiResponse.success(data=result, message="项目列表获取成功")


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="获取项目详情",
    description="根据项目 ID 获取项目详情，包含表信息。如果项目不存在或用户无权限，将返回错误。",
    response_description="返回项目详细信息",
    status_code=status.HTTP_200_OK,
)
def get_project(
    project: Project = Depends(get_verified_project),
):
    # 获取项目下的表信息
    supabase_repo = get_supabase_repository()
    
    tables = supabase_repo.get_tables(project_id=project.id)
    return ApiResponse.success(data=_convert_to_project_out(project, tables), message="项目获取成功")


@router.post(
    "/",
    response_model=ApiResponse[ProjectOut],
    summary="创建项目",
    description="创建一个新项目。项目将自动关联到当前用户。",
    response_description="返回创建成功的项目信息",
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    payload: ProjectCreate,
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 创建项目，自动关联到当前用户
    project = project_service.create(
        name=payload.name,
        description=payload.description,
        user_id=current_user.user_id,
    )
    return ApiResponse.success(data=_convert_to_project_out(project, []), message="项目创建成功")


@router.put(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="更新项目",
    description="更新项目信息。所有字段都是可选的，只更新用户提供的字段，未提供的字段保持不变。如果项目不存在或用户无权限，将返回错误。",
    response_description="返回更新后的项目信息",
    status_code=status.HTTP_200_OK,
)
def update_project(
    project: Project = Depends(get_verified_project),
    payload: ProjectUpdate = ...,
    project_service: ProjectService = Depends(get_project_service),
):
    # 更新项目
    updated_project = project_service.update(
        project_id=project.id,
        name=payload.name,
        description=payload.description,
    )
    
    # 获取项目下的表信息
    supabase_repo = get_supabase_repository()
    
    tables = supabase_repo.get_tables(project_id=project.id)
    return ApiResponse.success(data=_convert_to_project_out(updated_project, tables), message="项目更新成功")


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[None],
    summary="删除项目",
    description="删除指定项目。如果项目不存在或用户无权限，将返回错误。",
    response_description="删除成功，返回空数据",
    status_code=status.HTTP_200_OK,
)
def delete_project(
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
):
    # 删除项目
    project_service.delete(project.id)
    return ApiResponse.success(message="项目删除成功")


@router.post("/{project_id}/import-folder", response_model=ApiResponse[FolderImportResponse], status_code=status.HTTP_201_CREATED)
async def import_folder_as_table(
    project_id: str,
    payload: FolderImportRequest,
    project_service: ProjectService = Depends(get_project_service),
    current_user = Depends(get_current_user),
):
    """
    导入文件夹结构作为表，支持二进制文件的 ETL 处理。
    
    如果 payload 中包含 binary_files，将自动提交 ETL 任务进行解析。
    """
    # Import ETL dependencies only if needed
    etl_service = None
    rule_repository = None
    
    if payload.binary_files:
        from src.etl.dependencies import get_etl_service
        from src.etl.rules.repository_supabase import RuleRepositorySupabase
        from src.supabase.dependencies import get_supabase_client
        
        etl_service = await get_etl_service()
        supabase_client = get_supabase_client()
        rule_repository = RuleRepositorySupabase(
            supabase_client=supabase_client,
            user_id=current_user.user_id
        )
    
    # Call service method
    result = await project_service.import_folder_as_table(
        project_id=project_id,
        table_name=payload.table_name,
        folder_structure=payload.folder_structure,
        binary_files=[bf.model_dump() for bf in payload.binary_files] if payload.binary_files else None,
        user_id=current_user.user_id if payload.binary_files else None,
        etl_service=etl_service,
        rule_repository=rule_repository,
    )

    message = "文件夹导入成功"
    if result.binary_file_count > 0:
        message += f"，{result.binary_file_count} 个二进制文件正在后台解析"

    return ApiResponse.success(
        data=FolderImportResponse(
            table_id=str(result.table_id),
            table_name=result.table_name,
            etl_task_ids=result.etl_task_ids,
            binary_file_count=result.binary_file_count
        ),
        message=message
    )

