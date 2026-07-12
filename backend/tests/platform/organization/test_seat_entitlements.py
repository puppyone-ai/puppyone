from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.exceptions import AppException
from src.platform.entitlements import service as entitlement_module
from src.platform.organization.models import Organization, OrgInvitation, OrgMember
from src.platform.organization.service import OrganizationService


NOW = datetime(2026, 6, 15, tzinfo=UTC)


class _FakeEntitlementService:
    enabled = True

    def limit_value(self, org_id: str, limit_key: str):
        assert org_id == "org-1"
        assert limit_key == "seats.max"
        return 1


class _FakeOrganizationRepository:
    def __init__(self) -> None:
        self.invitation = OrgInvitation(
            id="inv-1",
            org_id="org-1",
            email="new@example.com",
            role="member",
            token="token-1",
            status="pending",
            invited_by="owner-1",
            expires_at=datetime.now(UTC) + timedelta(days=1),
            created_at=NOW,
        )

    def get_by_id(self, org_id: str) -> Organization | None:
        if org_id != "org-1":
            return None
        return Organization(
            id="org-1",
            name="Org",
            slug="org",
            created_by="owner-1",
            created_at=NOW,
            updated_at=NOW,
            seat_limit=99,
        )

    def get_member(self, org_id: str, user_id: str) -> OrgMember | None:
        if org_id == "org-1" and user_id == "owner-1":
            return OrgMember(
                id="member-owner",
                org_id="org-1",
                user_id="owner-1",
                role="owner",
                joined_at=NOW,
            )
        return None

    def count_members(self, org_id: str) -> int:
        assert org_id == "org-1"
        return 1

    def create_invitation(self, *args, **kwargs):
        raise AssertionError("seat limit should be enforced before invitation creation")

    def get_invitation_by_token(self, token: str) -> OrgInvitation | None:
        return self.invitation if token == "token-1" else None

    def add_member(self, *args, **kwargs):
        raise AssertionError("seat limit should be enforced before adding a member")


@pytest.fixture(autouse=True)
def _patch_entitlements(monkeypatch):
    monkeypatch.setattr(entitlement_module, "EntitlementService", _FakeEntitlementService)


def test_invite_uses_entitlement_seat_limit() -> None:
    service = OrganizationService(_FakeOrganizationRepository())

    with pytest.raises(AppException, match="Seat limit reached \\(1\\)"):
        service.invite("org-1", "new@example.com", "member", "owner-1")


def test_accept_invitation_enforces_seat_limit() -> None:
    service = OrganizationService(_FakeOrganizationRepository())

    with pytest.raises(AppException, match="Seat limit reached \\(1\\)"):
        service.accept_invitation(
            "token-1", "new-user-1", user_email="new@example.com"
        )
