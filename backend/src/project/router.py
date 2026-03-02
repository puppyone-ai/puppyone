"""
Project Router

提供项目 CRUD 的 REST API 接口。
"""

from fastapi import APIRouter, Depends, Query, status
from typing import List, Optional

from src.project.service import ProjectService
from src.project.dependencies import get_project_service, get_verified_project
from src.project.models import Project
from src.project.schemas import (
    ProjectOut,
    ProjectCreate,
    ProjectUpdate,
    NodeInfo,
    ProjectMemberOut,
    AddProjectMember,
    UpdateProjectMemberRole,
)
from src.content_node.dependencies import get_content_node_service
from src.content_node.service import ContentNodeService
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse
from src.exceptions import PermissionException, ErrorCode
from src.organization.dependencies import resolve_org_id, resolve_org_ids

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
            # 计算 rows: 如果 preview_json 是 list 则取长度，否则取 dict 的 key 数量
            rows = None
            if node.preview_json is not None:
                if isinstance(node.preview_json, list):
                    rows = len(node.preview_json)
                elif isinstance(node.preview_json, dict):
                    rows = len(node.preview_json)
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
    description="获取指定组织下的所有项目列表，包含每个项目下的内容节点。",
    response_description="返回组织的所有项目列表，每个项目包含其根目录下的内容节点",
    status_code=status.HTTP_200_OK,
)
def list_projects(
    org_id: Optional[str] = Query(None, description="组织ID（不传则返回用户所有组织的项目）"),
    project_service: ProjectService = Depends(get_project_service),
    content_node_service: ContentNodeService = Depends(get_content_node_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    oids = resolve_org_ids(org_id, current_user.user_id)

    all_projects = []
    for oid in oids:
        all_projects.extend(project_service.get_by_org_id(oid))

    result = []
    for p in all_projects:
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
    resolved_org_id = resolve_org_id(payload.org_id, current_user.user_id)

    project = project_service.create(
        name=payload.name,
        description=payload.description,
        org_id=resolved_org_id,
        created_by=current_user.user_id,
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
    project_service.delete(project.id)
    return ApiResponse.success(message="项目删除成功")


# ── Project Members ──


@router.get(
    "/{project_id}/members",
    response_model=ApiResponse[List[ProjectMemberOut]],
    summary="获取项目成员列表",
)
def list_project_members(
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
):
    rows = project_service.list_project_members(project.id)
    result = []
    for row in rows:
        profile = row.get("profiles") or {}
        result.append(ProjectMemberOut(
            id=row["id"],
            user_id=row["user_id"],
            email=profile.get("email"),
            display_name=profile.get("display_name"),
            avatar_url=profile.get("avatar_url"),
            role=row["role"],
            created_at=row["created_at"],
        ))
    return ApiResponse.success(data=result)


@router.post(
    "/{project_id}/members",
    response_model=ApiResponse[None],
    summary="添加项目成员",
    status_code=status.HTTP_201_CREATED,
)
def add_project_member(
    payload: AddProjectMember,
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    role = project_service.verify_project_access(project.id, current_user.user_id)
    if role not in ("owner", "admin"):
        raise PermissionException("Only org owner or project admin can add members", code=ErrorCode.FORBIDDEN)

    if payload.role not in ("admin", "editor", "viewer"):
        raise PermissionException("Role must be admin, editor, or viewer", code=ErrorCode.FORBIDDEN)

    project_service.add_project_member(project.id, payload.user_id, payload.role)
    return ApiResponse.success(message="Member added")


@router.put(
    "/{project_id}/members/{target_user_id}/role",
    response_model=ApiResponse[None],
    summary="更新项目成员角色",
)
def update_project_member_role(
    target_user_id: str,
    payload: UpdateProjectMemberRole,
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    role = project_service.verify_project_access(project.id, current_user.user_id)
    if role not in ("owner", "admin"):
        raise PermissionException("Only org owner or project admin can change roles", code=ErrorCode.FORBIDDEN)

    project_service.update_project_member_role(project.id, target_user_id, payload.role)
    return ApiResponse.success(message="Role updated")


@router.delete(
    "/{project_id}/members/{target_user_id}",
    response_model=ApiResponse[None],
    summary="移除项目成员",
)
def remove_project_member(
    target_user_id: str,
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    role = project_service.verify_project_access(project.id, current_user.user_id)
    if role not in ("owner", "admin"):
        raise PermissionException("Only org owner or project admin can remove members", code=ErrorCode.FORBIDDEN)

    project_service.remove_project_member(project.id, target_user_id)
    return ApiResponse.success(message="Member removed")
