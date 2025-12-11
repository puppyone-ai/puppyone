"""
Project Router

提供项目 CRUD 的 REST API 接口。
"""

from fastapi import APIRouter, Depends, status
from typing import List

from src.supabase.repository import SupabaseRepository
from src.supabase.schemas import ProjectCreate as SupabaseProjectCreate, ProjectUpdate as SupabaseProjectUpdate
from src.project.dependencies import get_supabase_repository
from src.project.schemas import ProjectOut, ProjectCreate, ProjectUpdate, TableInfo
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


def _convert_to_project_out(project_response, tables=None) -> ProjectOut:
    """将 ProjectResponse 转换为 ProjectOut"""
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
        id=str(project_response.id),
        name=project_response.name,
        description=project_response.description,
        tables=table_infos,
    )


@router.get(
    "/",
    response_model=ApiResponse[List[ProjectOut]],
    summary="获取项目列表",
    description="获取所有项目列表，包含每个项目下的表信息。",
    status_code=status.HTTP_200_OK,
)
def list_projects(
    repo: SupabaseRepository = Depends(get_supabase_repository),
):
    projects = repo.get_projects()
    result = []
    for p in projects:
        tables = repo.get_tables(project_id=p.id)
        result.append(_convert_to_project_out(p, tables))
    return ApiResponse.success(data=result, message="项目列表获取成功")


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="获取项目详情",
    description="根据项目 ID 获取项目详情，包含表信息。",
    status_code=status.HTTP_200_OK,
)
def get_project(
    project_id: int,
    repo: SupabaseRepository = Depends(get_supabase_repository),
):
    project = repo.get_project(project_id)
    if not project:
        raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
    
    tables = repo.get_tables(project_id=project_id)
    return ApiResponse.success(data=_convert_to_project_out(project, tables), message="项目获取成功")


@router.post(
    "/",
    response_model=ApiResponse[ProjectOut],
    summary="创建项目",
    description="创建一个新项目。",
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    payload: ProjectCreate,
    repo: SupabaseRepository = Depends(get_supabase_repository),
):
    project_data = SupabaseProjectCreate(
        name=payload.name,
        description=payload.description,
    )
    project = repo.create_project(project_data)
    return ApiResponse.success(data=_convert_to_project_out(project, []), message="项目创建成功")


@router.put(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="更新项目",
    description="更新项目信息。",
    status_code=status.HTTP_200_OK,
)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    repo: SupabaseRepository = Depends(get_supabase_repository),
):
    # 检查项目是否存在
    existing = repo.get_project(project_id)
    if not existing:
        raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
    
    update_data = SupabaseProjectUpdate(
        name=payload.name,
        description=payload.description,
    )
    project = repo.update_project(project_id, update_data)
    tables = repo.get_tables(project_id=project_id)
    return ApiResponse.success(data=_convert_to_project_out(project, tables), message="项目更新成功")


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[None],
    summary="删除项目",
    description="删除指定项目。",
    status_code=status.HTTP_200_OK,
)
def delete_project(
    project_id: int,
    repo: SupabaseRepository = Depends(get_supabase_repository),
):
    # 检查项目是否存在
    existing = repo.get_project(project_id)
    if not existing:
        raise NotFoundException(f"Project not found: {project_id}", code=ErrorCode.NOT_FOUND)
    
    repo.delete_project(project_id)
    return ApiResponse.success(message="项目删除成功")

