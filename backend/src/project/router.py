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
    NodeInfo,
)
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={
        404: {"description": "资源未找到"},
        500: {"description": "服务器内部错误"},
    },
)


def _convert_to_project_out(project: Project, nodes=None) -> ProjectOut:
    """将 Project 转换为 ProjectOut（使用 content_nodes）"""
    node_infos = []
    if nodes:
        for node in nodes:
            # 计算 rows: 如果 json_content 是 list 则取长度，否则取 dict 的 key 数量
            rows = None
            if node.json_content is not None:
                if isinstance(node.json_content, list):
                    rows = len(node.json_content)
                elif isinstance(node.json_content, dict):
                    rows = len(node.json_content)
            node_infos.append(
                NodeInfo(
                    id=node.id,
                    name=node.name,
                    type=node.type,
                    rows=rows,
                )
            )

    return ProjectOut(
        id=str(project.id),
        name=project.name,
        description=project.description,
        nodes=node_infos,
    )


@router.get(
    "/",
    response_model=ApiResponse[List[ProjectOut]],
    summary="获取项目列表",
    description="获取当前用户的所有项目列表，包含每个项目下的内容节点。",
    response_description="返回用户的所有项目列表，每个项目包含其根目录下的内容节点",
    status_code=status.HTTP_200_OK,
)
def list_projects(
    project_service: ProjectService = Depends(get_project_service),
    content_node_service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 获取当前用户的所有项目
    projects = project_service.get_by_user_id(current_user.user_id)

    # 从 content_nodes 获取每个项目的根目录内容
    result = []
    for p in projects:
        nodes = content_node_service.list_root_nodes(str(p.id))
        result.append(_convert_to_project_out(p, nodes))
    return ApiResponse.success(data=result, message="项目列表获取成功")


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="获取项目详情",
    description="根据项目 ID 获取项目详情，包含内容节点。如果项目不存在或用户无权限，将返回错误。",
    response_description="返回项目详细信息",
    status_code=status.HTTP_200_OK,
)
def get_project(
    project: Project = Depends(get_verified_project),
    content_node_service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 从 content_nodes 获取项目下的根目录内容
    nodes = content_node_service.list_root_nodes(str(project.id))
    return ApiResponse.success(
        data=_convert_to_project_out(project, nodes), message="项目获取成功"
    )


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
    return ApiResponse.success(
        data=_convert_to_project_out(project, []), message="项目创建成功"
    )


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
    content_node_service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    # 更新项目
    updated_project = project_service.update(
        project_id=project.id,
        name=payload.name,
        description=payload.description,
    )

    # 从 content_nodes 获取项目下的根目录内容
    nodes = content_node_service.list_root_nodes(str(project.id))
    return ApiResponse.success(
        data=_convert_to_project_out(updated_project, nodes), message="项目更新成功"
    )


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
