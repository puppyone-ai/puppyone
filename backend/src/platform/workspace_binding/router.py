from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from src.common_schemas import ApiResponse
from src.platform.auth.dependencies import get_current_user
from src.platform.auth.models import CurrentUser
from src.platform.authorization.dependencies import AuthorizedProject, require_project_action
from src.platform.authorization.models import ProjectAction
from src.platform.workspace_binding.dependencies import get_workspace_binding_service
from src.platform.workspace_binding.models import WorkspaceBinding
from src.platform.workspace_binding.schemas import (
    LegacyRemoteCandidateOut,
    LegacyRemoteResolveRequest,
    WorkspaceBindingCreate,
    WorkspaceBindingOut,
    WorkspaceBindingCredentialOut,
)
from src.platform.workspace_binding.service import WorkspaceBindingService


router = APIRouter(tags=["workspace-bindings"])


def _out(
    binding: WorkspaceBinding,
    *,
    credential: str | None = None,
    usable: bool = True,
    reason: str | None = None,
) -> WorkspaceBindingOut:
    return WorkspaceBindingOut(
        id=binding.id,
        org_id=binding.org_id,
        project_id=binding.project_id,
        scope_id=binding.scope_id,
        scope_path=binding.scope_path,
        workspace_instance_id=binding.workspace_instance_id,
        bound_user_id=binding.bound_user_id,
        cloud_origin=binding.cloud_origin,
        binding_kind=binding.binding_kind,
        mode=binding.mode,
        status=binding.status.value,
        usable=usable,
        unusable_reason=reason,
        created_at=binding.created_at.isoformat(),
        updated_at=binding.updated_at.isoformat(),
        last_seen_at=binding.last_seen_at.isoformat(),
        revoked_at=binding.revoked_at.isoformat() if binding.revoked_at else None,
        credential=credential,
    )


@router.post(
    "/projects/{project_id}/workspace-bindings",
    response_model=ApiResponse[WorkspaceBindingOut],
    status_code=status.HTTP_201_CREATED,
)
def create_workspace_binding(
    payload: WorkspaceBindingCreate,
    authorized: AuthorizedProject = Depends(
        require_project_action(ProjectAction.BIND_READONLY)
    ),
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    binding, credential, usable, reason = service.create(
        authorized.project.id, current_user.user_id, payload
    )
    return ApiResponse.success(
        data=_out(
            binding, credential=credential, usable=usable, reason=reason
        ),
        message="Workspace binding created",
    )


@router.get(
    "/projects/{project_id}/workspace-bindings",
    response_model=ApiResponse[list[WorkspaceBindingOut]],
)
def list_workspace_bindings(
    project_id: str,
    all_users: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    bindings = service.list_for_project(
        project_id, current_user.user_id, all_users=all_users
    )
    return ApiResponse.success(data=[_out(binding) for binding in bindings])


@router.get(
    "/workspace-bindings/{binding_id}",
    response_model=ApiResponse[WorkspaceBindingOut],
)
def get_workspace_binding(
    binding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    binding, usable, reason = service.get(binding_id, current_user.user_id)
    return ApiResponse.success(data=_out(binding, usable=usable, reason=reason))


@router.post(
    "/workspace-bindings/{binding_id}/heartbeat",
    response_model=ApiResponse[WorkspaceBindingOut],
)
def heartbeat_workspace_binding(
    binding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    binding, usable, reason = service.heartbeat(binding_id, current_user.user_id)
    return ApiResponse.success(data=_out(binding, usable=usable, reason=reason))


@router.delete(
    "/workspace-bindings/{binding_id}",
    response_model=ApiResponse[None],
)
def revoke_workspace_binding(
    binding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    service.revoke(binding_id, current_user.user_id)
    return ApiResponse.success(message="Workspace binding revoked")


@router.delete(
    "/projects/{project_id}/workspace-bindings/{binding_id}",
    response_model=ApiResponse[None],
)
def revoke_workspace_binding_as_admin(
    project_id: str,
    binding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    service.revoke_as_admin(binding_id, project_id, current_user.user_id)
    return ApiResponse.success(message="Workspace binding revoked")


@router.post(
    "/workspace-bindings/{binding_id}/credential/rotate",
    response_model=ApiResponse[WorkspaceBindingCredentialOut],
)
def rotate_workspace_binding_credential(
    binding_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    credential = service.rotate_credential(binding_id, current_user.user_id)
    return ApiResponse.success(
        data=WorkspaceBindingCredentialOut(
            binding_id=binding_id, credential=credential
        )
    )


@router.post(
    "/desktop/project-bindings/resolve-legacy-remote",
    response_model=ApiResponse[LegacyRemoteCandidateOut],
)
def resolve_legacy_remote(
    payload: LegacyRemoteResolveRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: WorkspaceBindingService = Depends(get_workspace_binding_service),
):
    project_id, scope_id, kind = service.resolve_legacy_remote(
        payload.remote_url, current_user.user_id
    )
    return ApiResponse.success(
        data=LegacyRemoteCandidateOut(
            project_id=project_id,
            scope_id=scope_id,
            binding_kind=kind,
            requires_confirmation=True,
        )
    )
