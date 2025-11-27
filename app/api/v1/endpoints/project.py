"""
项目管理 API
负责项目的创建、查询、更新和删除，以及表的管理
"""
from fastapi import APIRouter, Depends, status
from typing import List
from app.schemas.response import ApiResponse
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectOut, TableCreate, TableUpdate, TableOut, FolderImportRequest
from app.service.project_service import ProjectService
from app.core.dependencies import get_project_service

router = APIRouter(prefix="/projects", tags=["项目管理"])

@router.get("/", response_model=ApiResponse[List[ProjectOut]])
async def list_projects(
    project_service: ProjectService = Depends(get_project_service)
):
    """
    获取所有项目列表
    """
    projects = project_service.get_all()
    return ApiResponse.success(
        data=[ProjectOut(**project.model_dump()) for project in projects],
        message="获取项目列表成功"
    )

@router.get("/{project_id}", response_model=ApiResponse[ProjectOut])
async def get_project(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    根据ID获取项目详情
    """
    project = project_service.get_by_id(project_id)
    if not project:
        return ApiResponse.error(message=f"项目不存在: {project_id}", code=404)
    return ApiResponse.success(
        data=ProjectOut(**project.model_dump()),
        message="获取项目成功"
    )

@router.post("/", response_model=ApiResponse[ProjectOut], status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    创建新项目
    """
    project = project_service.create(payload.name, payload.description)
    return ApiResponse.success(
        data=ProjectOut(**project.model_dump()),
        message="项目创建成功"
    )

@router.put("/{project_id}", response_model=ApiResponse[ProjectOut])
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    更新项目信息
    """
    project = project_service.update(project_id, payload.name, payload.description)
    return ApiResponse.success(
        data=ProjectOut(**project.model_dump()),
        message="项目更新成功"
    )

@router.delete("/{project_id}", response_model=ApiResponse[None])
async def delete_project(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    删除项目
    """
    project_service.delete(project_id)
    return ApiResponse.success(message="项目删除成功")

# 表管理接口
@router.post("/{project_id}/tables", response_model=ApiResponse[TableOut], status_code=status.HTTP_201_CREATED)
async def create_table(
    project_id: str,
    payload: TableCreate,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    在项目中创建新表
    """
    table_info = project_service.create_table(project_id, payload.name, payload.data)
    table_data = project_service.get_table_data(project_id, table_info.id)
    return ApiResponse.success(
        data=TableOut(
            id=table_info.id,
            name=table_info.name,
            rows=table_info.rows or 0,
            data=table_data
        ),
        message="表创建成功"
    )

@router.put("/{project_id}/tables/{table_id}", response_model=ApiResponse[TableOut])
async def update_table(
    project_id: str,
    table_id: str,
    payload: TableUpdate,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    更新表信息（重命名）
    """
    table_info = project_service.update_table(project_id, table_id, payload.name)
    table_data = project_service.get_table_data(project_id, table_id)
    return ApiResponse.success(
        data=TableOut(
            id=table_info.id,
            name=table_info.name,
            rows=table_info.rows or 0,
            data=table_data
        ),
        message="表更新成功"
    )

@router.delete("/{project_id}/tables/{table_id}", response_model=ApiResponse[None])
async def delete_table(
    project_id: str,
    table_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    删除表
    """
    project_service.delete_table(project_id, table_id)
    return ApiResponse.success(message="表删除成功")

@router.get("/{project_id}/tables/{table_id}", response_model=ApiResponse[TableOut])
async def get_table(
    project_id: str,
    table_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    获取表数据和详情
    """
    table_data = project_service.get_table_data(project_id, table_id)
    project = project_service.get_by_id(project_id)
    if not project:
        return ApiResponse.error(message=f"项目不存在: {project_id}", code=404)
    
    table_info = next((t for t in project.tables if t.id == table_id), None)
    if not table_info:
        return ApiResponse.error(message=f"表不存在: {table_id}", code=404)
    
    return ApiResponse.success(
        data=TableOut(
            id=table_info.id,
            name=table_info.name,
            rows=len(table_data),
            data=table_data
        ),
        message="获取表数据成功"
    )

@router.put("/{project_id}/tables/{table_id}/data", response_model=ApiResponse[TableOut])
async def update_table_data(
    project_id: str,
    table_id: str,
    data: List[dict],
    project_service: ProjectService = Depends(get_project_service)
):
    """
    更新表数据
    """
    project_service.update_table_data(project_id, table_id, data)
    table_data = project_service.get_table_data(project_id, table_id)
    project = project_service.get_by_id(project_id)
    table_info = next((t for t in project.tables if t.id == table_id), None)
    
    return ApiResponse.success(
        data=TableOut(
            id=table_info.id if table_info else table_id,
            name=table_info.name if table_info else table_id,
            rows=len(table_data),
            data=table_data
        ),
        message="表数据更新成功"
    )

@router.post("/{project_id}/import-folder", response_model=ApiResponse[TableOut], status_code=status.HTTP_201_CREATED)
async def import_folder_as_table(
    project_id: str,
    payload: FolderImportRequest,
    project_service: ProjectService = Depends(get_project_service)
):
    """
    导入文件夹结构作为表
    """
    table_info = project_service.import_folder_as_table(
        project_id,
        payload.table_name,
        payload.folder_structure
    )
    
    # 读取表数据（可能是JSON对象而不是数组）
    # 将文件夹结构包装成数组格式以符合TableOut的要求
    table_data = [payload.folder_structure]
    
    return ApiResponse.success(
        data=TableOut(
            id=table_info.id,
            name=table_info.name,
            rows=table_info.rows or 0,
            data=table_data
        ),
        message="文件夹导入成功"
    )

