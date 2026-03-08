from fastapi import APIRouter, Depends, status
from typing import List

from src.organization.service import OrganizationService
from src.organization.dependencies import get_org_service
from src.organization.schemas import (
    CreateOrganization,
    UpdateOrganization,
    InviteMember,
    UpdateMemberRole,
    OrganizationOut,
    OrgMemberOut,
    OrgInvitationOut,
)
from src.auth.models import CurrentUser
from src.auth.dependencies import get_current_user
from src.common_schemas import ApiResponse

router = APIRouter(
    prefix="/organizations",
    tags=["organizations"],
)


def _org_to_out(org) -> OrganizationOut:
    return OrganizationOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        avatar_url=org.avatar_url,
        plan=org.plan,
        seat_limit=org.seat_limit,
        created_at=org.created_at.isoformat(),
    )


@router.get("/", response_model=ApiResponse[List[OrganizationOut]])
def list_organizations(
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    orgs = org_service.list_my_orgs(current_user.user_id)
    return ApiResponse.success(data=[_org_to_out(org) for org in orgs])


@router.post("/", response_model=ApiResponse[OrganizationOut], status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: CreateOrganization,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org = org_service.create(
        name=payload.name, slug=payload.slug, user_id=current_user.user_id
    )
    return ApiResponse.success(data=_org_to_out(org))


@router.get("/{org_id}", response_model=ApiResponse[OrganizationOut])
def get_organization(
    org_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.get_my_role(org_id, current_user.user_id)
    org = org_service.get_by_id(org_id)
    return ApiResponse.success(data=_org_to_out(org))


@router.put("/{org_id}", response_model=ApiResponse[OrganizationOut])
def update_organization(
    org_id: str,
    payload: UpdateOrganization,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    update_data = payload.model_dump(exclude_none=True)
    org = org_service.update(org_id, current_user.user_id, **update_data)
    return ApiResponse.success(data=_org_to_out(org))


@router.delete("/{org_id}", response_model=ApiResponse[None])
def delete_organization(
    org_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.delete(org_id, current_user.user_id)
    return ApiResponse.success(message="Organization deleted")


# ── Members ──


@router.get("/{org_id}/members", response_model=ApiResponse[List[OrgMemberOut]])
def list_members(
    org_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    rows = org_service.list_members(org_id, current_user.user_id)
    result = []
    for row in rows:
        profile = row.get("profiles") or {}
        result.append(
            OrgMemberOut(
                id=row["id"],
                user_id=row["user_id"],
                email=profile.get("email"),
                display_name=profile.get("display_name"),
                avatar_url=profile.get("avatar_url"),
                role=row["role"],
                joined_at=row["joined_at"],
            )
        )
    return ApiResponse.success(data=result)


@router.put("/{org_id}/members/{target_user_id}/role", response_model=ApiResponse[None])
def update_member_role(
    org_id: str,
    target_user_id: str,
    payload: UpdateMemberRole,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.update_member_role(org_id, target_user_id, payload.role, current_user.user_id)
    return ApiResponse.success(message="Role updated")


@router.delete("/{org_id}/members/{target_user_id}", response_model=ApiResponse[None])
def remove_member(
    org_id: str,
    target_user_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.remove_member(org_id, target_user_id, current_user.user_id)
    return ApiResponse.success(message="Member removed")


@router.post("/{org_id}/leave", response_model=ApiResponse[None])
def leave_organization(
    org_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.leave(org_id, current_user.user_id)
    return ApiResponse.success(message="Left organization")


# ── Invitations ──


@router.post("/{org_id}/invite", response_model=ApiResponse[OrgInvitationOut])
def invite_member(
    org_id: str,
    payload: InviteMember,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    invitation = org_service.invite(
        org_id, payload.email, payload.role, current_user.user_id
    )
    return ApiResponse.success(
        data=OrgInvitationOut(
            id=invitation.id, email=invitation.email, role=invitation.role,
            status=invitation.status, expires_at=invitation.expires_at.isoformat(),
            created_at=invitation.created_at.isoformat(),
        )
    )


@router.get("/{org_id}/invitations", response_model=ApiResponse[List[OrgInvitationOut]])
def list_invitations(
    org_id: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    invitations = org_service.list_invitations(org_id, current_user.user_id)
    result = [
        OrgInvitationOut(
            id=inv.id, email=inv.email, role=inv.role,
            status=inv.status, expires_at=inv.expires_at.isoformat(),
            created_at=inv.created_at.isoformat(),
        )
        for inv in invitations
    ]
    return ApiResponse.success(data=result)


@router.post("/invitations/{token}/accept", response_model=ApiResponse[None])
def accept_invitation(
    token: str,
    org_service: OrganizationService = Depends(get_org_service),
    current_user: CurrentUser = Depends(get_current_user),
):
    org_service.accept_invitation(token, current_user.user_id)
    return ApiResponse.success(message="Invitation accepted")
