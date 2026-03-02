import re
from typing import List, Optional
from datetime import datetime, timezone

from src.organization.models import Organization, OrgMember, OrgInvitation
from src.organization.repository import OrganizationRepository
from src.exceptions import NotFoundException, ForbiddenException, AppException, ErrorCode


class OrganizationService:

    def __init__(self, repo: OrganizationRepository):
        self._repo = repo

    # ── Organization CRUD ──

    def list_my_orgs(self, user_id: str) -> List[Organization]:
        return self._repo.list_by_user(user_id)

    def get_by_id(self, org_id: str) -> Organization:
        org = self._repo.get_by_id(org_id)
        if not org:
            raise NotFoundException(f"Organization not found: {org_id}", code=ErrorCode.NOT_FOUND)
        return org

    def create(self, name: str, slug: Optional[str], user_id: str) -> Organization:
        if not slug:
            slug = re.sub(r"[^a-z0-9-]", "-", name.lower()).strip("-")
            slug = re.sub(r"-+", "-", slug)

        existing = self._repo.get_by_slug(slug)
        if existing:
            slug = f"{slug}-{user_id[:8]}"

        org = self._repo.create(name=name, slug=slug, created_by=user_id)
        self._repo.add_member(org.id, user_id, role="owner")
        return org

    def update(self, org_id: str, user_id: str, **kwargs) -> Organization:
        self._require_owner(org_id, user_id)
        return self._repo.update(org_id, **kwargs)

    def delete(self, org_id: str, user_id: str) -> None:
        self._require_owner(org_id, user_id)

        user_orgs = self._repo.list_by_user(user_id)
        if len(user_orgs) <= 1:
            raise AppException("Cannot delete your only organization", code=ErrorCode.FORBIDDEN)

        self._repo.delete(org_id)

    # ── Members ──

    def list_members(self, org_id: str, user_id: str) -> List[dict]:
        self._require_membership(org_id, user_id)
        return self._repo.list_members(org_id)

    def get_my_role(self, org_id: str, user_id: str) -> Optional[str]:
        member = self._repo.get_member(org_id, user_id)
        return member.role if member else None

    def update_member_role(
        self, org_id: str, target_user_id: str, new_role: str, current_user_id: str
    ) -> OrgMember:
        self._require_owner(org_id, current_user_id)

        if target_user_id == current_user_id:
            raise AppException("Cannot change your own role", code=ErrorCode.FORBIDDEN)

        if new_role == "owner":
            raise AppException(
                "Cannot assign owner role. Use transfer ownership instead.",
                code=ErrorCode.FORBIDDEN,
            )

        member = self._repo.update_member_role(org_id, target_user_id, new_role)
        if not member:
            raise NotFoundException("Member not found", code=ErrorCode.NOT_FOUND)
        return member

    def remove_member(self, org_id: str, target_user_id: str, current_user_id: str) -> None:
        self._require_owner(org_id, current_user_id)

        if target_user_id == current_user_id:
            raise AppException("Cannot remove yourself. Transfer ownership first.", code=ErrorCode.FORBIDDEN)

        self._repo.remove_member(org_id, target_user_id)

    def leave(self, org_id: str, user_id: str) -> None:
        member = self._repo.get_member(org_id, user_id)
        if not member:
            raise NotFoundException("You are not a member", code=ErrorCode.NOT_FOUND)
        if member.role == "owner":
            raise AppException("Owner cannot leave. Transfer ownership first.", code=ErrorCode.FORBIDDEN)
        self._repo.remove_member(org_id, user_id)

    # ── Invitations ──

    def invite(self, org_id: str, email: str, role: str, inviter_id: str) -> OrgInvitation:
        self._require_owner(org_id, inviter_id)

        org = self.get_by_id(org_id)
        current_count = self._repo.count_members(org_id)
        if current_count >= org.seat_limit:
            raise AppException(
                f"Seat limit reached ({org.seat_limit}). Upgrade your plan.",
                code=ErrorCode.FORBIDDEN,
            )

        if role not in ("member", "viewer"):
            raise AppException("Can only invite as member or viewer", code=ErrorCode.FORBIDDEN)

        return self._repo.create_invitation(org_id, email, role, inviter_id)

    def accept_invitation(self, token: str, user_id: str) -> OrgMember:
        invitation = self._repo.get_invitation_by_token(token)
        if not invitation:
            raise NotFoundException("Invitation not found or expired", code=ErrorCode.NOT_FOUND)

        if datetime.now(timezone.utc) > invitation.expires_at.replace(tzinfo=timezone.utc):
            raise AppException("Invitation expired", code=ErrorCode.FORBIDDEN)

        existing = self._repo.get_member(invitation.org_id, user_id)
        if existing:
            raise AppException("You are already a member", code=ErrorCode.FORBIDDEN)

        member = self._repo.add_member(invitation.org_id, user_id, invitation.role)
        self._repo.accept_invitation(invitation.id)
        return member

    def list_invitations(self, org_id: str, user_id: str) -> List[OrgInvitation]:
        self._require_owner(org_id, user_id)
        return self._repo.list_invitations(org_id)

    # ── Helpers ──

    def _require_owner(self, org_id: str, user_id: str) -> OrgMember:
        member = self._repo.get_member(org_id, user_id)
        if not member or member.role != "owner":
            raise ForbiddenException("Only owner can perform this action")
        return member

    def _require_membership(self, org_id: str, user_id: str) -> OrgMember:
        member = self._repo.get_member(org_id, user_id)
        if not member:
            raise ForbiddenException("Not a member of this organization")
        return member
