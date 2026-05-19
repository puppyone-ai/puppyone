"""
Project Router

Provides REST API endpoints for project CRUD operations.
"""


from fastapi import APIRouter, Depends, Query, status

from src.common_schemas import ApiResponse
from src.exceptions import ErrorCode, PermissionException
from src.version_engine.bootstrap.dependencies import (
    get_product_operation_adapter,
    get_version_admin_service,
)
from src.version_engine.adapters.product.operation_adapter import ProductOperationAdapter
from src.version_engine.read.admin import VersionAdminService
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.organization.dependencies import resolve_org_id, resolve_org_ids
from src.platform.project.dependencies import get_project_service, get_verified_project
from src.platform.project.models import Project
from src.platform.project.schemas import (
    AddProjectMember,
    NodeInfo,
    ProjectCreate,
    ProjectMemberOut,
    ProjectOut,
    ProjectUpdate,
    UpdateProjectMemberRole,
)
from src.infra.supabase.dependencies import get_supabase_client
from src.platform.project.service import ProjectService

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={
        404: {"description": "Resource not found"},
        500: {"description": "Internal server error"},
    },
)


def _convert_to_project_out(
    project: Project, entries=None, access_point_count: int = 0
) -> ProjectOut:
    """Convert Project to ProjectOut (using ProductOperationAdapter entries)"""
    node_infos = []
    if entries:
        for entry in entries:
            node_infos.append(
                NodeInfo(
                    id=entry.path,
                    name=entry.name,
                    type=entry.type,
                    rows=None,
                )
            )

    return ProjectOut(
        id=str(project.id),
        name=project.name,
        description=project.description,
        org_id=project.org_id,
        visibility=project.visibility,
        bound_git_branch=getattr(project, 'bound_git_branch', 'main'),
        nodes=node_infos,
        updated_at=project.updated_at.isoformat() if project.updated_at else None,
        access_point_count=access_point_count,
    )


def _count_user_connectors(project_ids: list[str]) -> dict[str, int]:
    """Count user-created integrations, excluding built-in connection methods."""

    if not project_ids:
        return {}
    sb = get_supabase_client()
    rows = (
        sb.table("connectors")
        .select("project_id, provider")
        .in_("project_id", project_ids)
        .not_.in_("provider", ["cli", "agent", "filesystem"])
        .execute()
    ).data or []
    counts: dict[str, int] = {}
    for row in rows:
        pid = row["project_id"]
        counts[pid] = counts.get(pid, 0) + 1
    return counts


@router.get(
    "/",
    response_model=ApiResponse[list[ProjectOut]],
    summary="List projects",
    description="Get project metadata under the specified organization.",
    response_description="Returns all projects of the organization",
    status_code=status.HTTP_200_OK,
)
async def list_projects(
    org_id: str | None = Query(None, description="Organization ID (if omitted, returns projects from all user organizations)"),
    project_service: ProjectService = Depends(get_project_service),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    current_user: CurrentUser = Depends(get_current_user),
):
    oids = resolve_org_ids(org_id, current_user.user_id)

    all_projects = []
    for oid in oids:
        all_projects.extend(project_service.get_by_org_id(oid))

    # Batch-fetch connection counts for all projects. Count only user-created
    # integrations; CLI / Agent / Git Remote are built-in entry methods.
    project_ids = [str(p.id) for p in all_projects]
    conn_counts = _count_user_connectors(project_ids)

    result = []
    for p in all_projects:
        entries = ops.list_dir(str(p.id), "")
        result.append(
            _convert_to_project_out(
                p,
                entries,
                access_point_count=conn_counts.get(str(p.id), 0),
            )
        )
    return ApiResponse.success(data=result, message="Project list retrieved successfully")


@router.get(
    "/templates/list",
    response_model=ApiResponse[list],
    summary="List available project templates",
    description="Returns metadata for all available project templates.",
    status_code=status.HTTP_200_OK,
)
def list_project_templates():
    from src.platform.project.templates import list_templates
    return ApiResponse.success(data=list_templates(), message="Templates retrieved")


@router.get(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="Get project details",
    description="Get project details by project ID, including root directory entries.",
    response_description="Returns detailed project information",
    status_code=status.HTTP_200_OK,
)
def get_project(
    project: Project = Depends(get_verified_project),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    current_user: CurrentUser = Depends(get_current_user),
):
    entries = ops.list_dir(str(project.id), "")
    conn_count = _count_user_connectors([str(project.id)]).get(str(project.id), 0)
    return ApiResponse.success(
        data=_convert_to_project_out(project, entries, access_point_count=conn_count),
        message="Project retrieved successfully",
    )


@router.post(
    "/",
    response_model=ApiResponse[ProjectOut],
    summary="Create project",
    description="Create a new project. The project is automatically associated with the current user. When seed=true, default content is written.",
    response_description="Returns the created project information",
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    payload: ProjectCreate,
    project_service: ProjectService = Depends(get_project_service),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    version_admin: VersionAdminService = Depends(get_version_admin_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    resolved_org_id = resolve_org_id(payload.org_id, current_user.user_id)

    project = project_service.create(
        name=payload.name,
        description=payload.description,
        org_id=resolved_org_id,
        created_by=current_user.user_id,
    )

    await version_admin.init_tree(str(project.id))

    # Ensure the canonical root scope exists before returning. The DB trigger
    # synchronously creates built-in cli / agent / filesystem connector rows.
    from src.repo.scope_service import ScopeService
    ScopeService().ensure_root_scope(str(project.id))

    entries = []
    if payload.template:
        from src.platform.project.templates import seed_template_content
        await seed_template_content(
            project_id=str(project.id),
            template_id=payload.template,
            created_by=current_user.user_id,
        )
        entries = ops.list_dir(str(project.id), "")
    elif payload.seed:
        from src.platform.project.seed_content import seed_default_content
        await seed_default_content(
            project_id=str(project.id),
            created_by=current_user.user_id,
        )
        entries = ops.list_dir(str(project.id), "")

    return ApiResponse.success(
        data=_convert_to_project_out(
            project,
            entries,
            access_point_count=_count_user_connectors([str(project.id)]).get(str(project.id), 0),
        ),
        message="Project created successfully",
    )


@router.put(
    "/{project_id}",
    response_model=ApiResponse[ProjectOut],
    summary="Update project",
    description="Update project information.",
    response_description="Returns the updated project information",
    status_code=status.HTTP_200_OK,
)
def update_project(
    project: Project = Depends(get_verified_project),
    payload: ProjectUpdate = ...,
    project_service: ProjectService = Depends(get_project_service),
    ops: ProductOperationAdapter = Depends(get_product_operation_adapter),
    current_user: CurrentUser = Depends(get_current_user),
):
    updated_project = project_service.update(
        project_id=project.id,
        name=payload.name,
        description=payload.description,
        bound_git_branch=payload.bound_git_branch,
    )

    entries = ops.list_dir(str(project.id), "")
    return ApiResponse.success(
        data=_convert_to_project_out(updated_project, entries), message="Project updated successfully"
    )


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[None],
    summary="Delete project",
    description="Delete the specified project.",
    response_description="Deletion successful, returns empty data",
    status_code=status.HTTP_200_OK,
)
def delete_project(
    project: Project = Depends(get_verified_project),
    project_service: ProjectService = Depends(get_project_service),
):
    project_service.delete(project.id)
    return ApiResponse.success(message="Project deleted successfully")


@router.post(
    "/{project_id}/seed",
    response_model=ApiResponse[dict],
    summary="Write default seed content",
    description="Write Getting Started + Guides default content for an existing project.",
    status_code=status.HTTP_201_CREATED,
)
async def seed_project(
    project: Project = Depends(get_verified_project),
    current_user: CurrentUser = Depends(get_current_user),
):
    from src.platform.project.seed_content import seed_default_content
    result = await seed_default_content(
        project_id=str(project.id),
        created_by=current_user.user_id,
    )
    return ApiResponse.success(data=result, message="Seed content created")


# ── Project Members ──


@router.get(
    "/{project_id}/members",
    response_model=ApiResponse[list[ProjectMemberOut]],
    summary="List project members",
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
    summary="Add project member",
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
    summary="Update project member role",
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
    summary="Remove project member",
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
