import logging
import re
from datetime import UTC, datetime

from src.exceptions import AppException, ErrorCode, ForbiddenException, NotFoundException
from src.platform.organization.models import Organization, OrgInvitation, OrgMember
from src.platform.organization.repository import OrganizationRepository

logger = logging.getLogger(__name__)


class InviteEmailResult:
    """Carries the outcome of the best-effort Supabase invite email
    dispatch so the router can surface it in the response.

    The invitation row is always created regardless of email outcome —
    the URL can be copied and shared manually. This object only tells
    the caller whether the email send succeeded so the UI can adjust
    its messaging (e.g. "Invitation sent" vs "Invitation created — copy
    the link below to share").
    """

    __slots__ = ("sent", "error")

    def __init__(self, sent: bool, error: str | None = None) -> None:
        self.sent = sent
        self.error = error


class OrganizationService:

    def __init__(self, repo: OrganizationRepository):
        self._repo = repo

    # ── Organization CRUD ──

    def list_my_orgs(self, user_id: str) -> list[Organization]:
        return self._repo.list_by_user(user_id)

    def get_by_id(self, org_id: str) -> Organization:
        org = self._repo.get_by_id(org_id)
        if not org:
            raise NotFoundException(f"Organization not found: {org_id}", code=ErrorCode.NOT_FOUND)
        return org

    def create(self, name: str, slug: str | None, user_id: str) -> Organization:
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
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Cannot delete your only organization",
            )

        self._repo.delete(org_id)

    # ── Members ──

    def list_members(self, org_id: str, user_id: str) -> list[dict]:
        self._require_membership(org_id, user_id)
        return self._repo.list_members(org_id)

    def get_my_role(self, org_id: str, user_id: str) -> str | None:
        member = self._repo.get_member(org_id, user_id)
        return member.role if member else None

    def update_member_role(
        self, org_id: str, target_user_id: str, new_role: str, current_user_id: str
    ) -> OrgMember:
        self._require_owner(org_id, current_user_id)

        if target_user_id == current_user_id:
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Cannot change your own role",
            )

        if new_role == "owner":
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Cannot assign owner role. Use transfer ownership instead.",
            )

        member = self._repo.update_member_role(org_id, target_user_id, new_role)
        if not member:
            raise NotFoundException("Member not found", code=ErrorCode.NOT_FOUND)
        return member

    def remove_member(self, org_id: str, target_user_id: str, current_user_id: str) -> None:
        self._require_owner(org_id, current_user_id)

        if target_user_id == current_user_id:
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Cannot remove yourself. Transfer ownership first.",
            )

        self._repo.remove_member(org_id, target_user_id)

    def leave(self, org_id: str, user_id: str) -> None:
        member = self._repo.get_member(org_id, user_id)
        if not member:
            raise NotFoundException("You are not a member", code=ErrorCode.NOT_FOUND)
        if member.role == "owner":
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Owner cannot leave. Transfer ownership first.",
            )
        self._repo.remove_member(org_id, user_id)

    # ── Invitations ──

    def invite(self, org_id: str, email: str, role: str, inviter_id: str) -> OrgInvitation:
        """Create an invitation row.

        Email delivery is handled separately via ``send_invite_email``
        so the route can both await the (best-effort) dispatch and
        report its outcome in the response. Splitting them keeps this
        sync method usable from places that have no notion of the
        request's frontend URL (background jobs, tests).
        """
        self._require_owner(org_id, inviter_id)

        org = self.get_by_id(org_id)
        self._enforce_seat_capacity(org)

        if role not in ("member", "viewer"):
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Can only invite as member or viewer",
            )

        return self._repo.create_invitation(org_id, email, role, inviter_id)

    def send_invite_email(
        self,
        invitation: OrgInvitation,
        invite_url: str,
        org_name: str,
    ) -> InviteEmailResult:
        """Best-effort Supabase email dispatch.

        Uses ``supabase.auth.admin.invite_user_by_email`` which:
          - Sends Supabase's standard invite email when the email has
            never signed up before, with the redirect URL we pass in.
          - Returns 422 ``user_already_exists`` when the email is
            already a Supabase user — that's a normal case (inviting
            an existing user), not a failure. We swallow it and let
            the inviter share the link manually instead.

        Any other error is logged + returned; the invitation row is
        already created so the inviter can still copy/share the link.
        """
        from src.infra.supabase.client import SupabaseClient

        try:
            client = SupabaseClient().client
            # The ``data`` payload survives into user_metadata after
            # signup, so the post-signup callback could read the
            # invitation_token to auto-accept; for now we just pass
            # the redirect URL and let the invite page handle accept.
            client.auth.admin.invite_user_by_email(
                invitation.email,
                {
                    "redirect_to": invite_url,
                    "data": {
                        "invitation_token": invitation.token,
                        "org_name": org_name,
                    },
                },
            )
            return InviteEmailResult(sent=True)
        except Exception as exc:
            msg = str(exc)
            # Supabase returns ``user_already_exists`` (422) when the
            # email is already a registered user. The invitee can
            # still sign in normally and accept via the URL — the
            # invitation is intact. Not an error from the inviter's
            # perspective.
            if "user_already_exists" in msg or "User already registered" in msg:
                logger.info(
                    "[org-invite] %s already has an account; "
                    "skipping welcome email, share link manually.",
                    invitation.email,
                )
                return InviteEmailResult(sent=False, error="recipient_exists")
            logger.warning(
                "[org-invite] supabase invite_user_by_email failed for "
                "%s: %s",
                invitation.email,
                msg,
            )
            return InviteEmailResult(sent=False, error=msg[:200])

    def accept_invitation(
        self, token: str, user_id: str, user_email: str | None = None
    ) -> tuple[OrgMember, Organization]:
        """Apply an invitation: add membership and mark accepted.

        Returns the new member row AND the org so the frontend can
        confirm-and-redirect with a useful "Joined {org_name}" message
        without a second round-trip.
        """
        invitation = self._repo.get_invitation_by_token(token)
        if not invitation:
            raise NotFoundException("Invitation not found or expired", code=ErrorCode.NOT_FOUND)

        if datetime.now(UTC) > invitation.expires_at.replace(tzinfo=UTC):
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="Invitation expired",
            )

        # The invitation is bound to a specific email. Only the invited person
        # may redeem it — otherwise anyone holding the token (e.g. a forwarded
        # link) could join the org. Compare case-insensitively.
        invited_email = (invitation.email or "").strip().lower()
        caller_email = (user_email or "").strip().lower()
        if invited_email and caller_email != invited_email:
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message="This invitation was issued to a different email address",
            )

        # If the user is ALREADY a member, mark the invitation accepted
        # (so the inviter's list stops showing it) and return the
        # existing membership. This is more forgiving than the previous
        # 403 — the user clicked the invite link and arrived in the org,
        # which is the outcome they wanted.
        existing = self._repo.get_member(invitation.org_id, user_id)
        if existing:
            self._repo.accept_invitation(invitation.id)
            org = self.get_by_id(invitation.org_id)
            return existing, org

        org = self.get_by_id(invitation.org_id)
        self._enforce_seat_capacity(org)
        member = self._repo.add_member(invitation.org_id, user_id, invitation.role)
        self._repo.accept_invitation(invitation.id)
        return member, org

    def list_invitations(self, org_id: str, user_id: str) -> list[OrgInvitation]:
        self._require_owner(org_id, user_id)
        return self._repo.list_invitations(org_id)

    def revoke_invitation(self, org_id: str, invitation_id: str, user_id: str) -> None:
        """Cancel a pending invitation so its link stops working.

        Idempotent: if the invitation row has already been accepted /
        revoked / doesn't exist, we still return success — the caller's
        observable goal ("this invite is no longer pending") is met.
        """
        self._require_owner(org_id, user_id)
        self._repo.revoke_invitation(org_id, invitation_id)

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

    def _seat_limit_for_org(self, org: Organization) -> int | None:
        from src.platform.entitlements.service import EntitlementService

        entitlement_service = EntitlementService()
        limit = entitlement_service.limit_value(org.id, "seats.max")
        if limit is None:
            return None if entitlement_service.enabled else org.seat_limit
        return int(limit)

    def _enforce_seat_capacity(self, org: Organization) -> None:
        seat_limit = self._seat_limit_for_org(org)
        if seat_limit is None:
            return
        current_count = self._repo.count_members(org.id)
        if current_count >= seat_limit:
            raise AppException(
                code=ErrorCode.FORBIDDEN,
                message=f"Seat limit reached ({seat_limit}). Upgrade your plan.",
            )
