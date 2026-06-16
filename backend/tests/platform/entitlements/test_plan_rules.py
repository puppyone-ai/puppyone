from __future__ import annotations

from src.config import settings
from src.platform.entitlements.models import EntitlementSnapshot
from src.platform.entitlements.service import EntitlementService


class _EmptyEntitlementRepository:
    def get_by_org_id(self, org_id: str):
        return None


def test_default_free_entitlements_match_pay_plan(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENTITLEMENTS_MODE", "db", raising=False)

    snapshot = EntitlementService(repository=_EmptyEntitlementRepository()).get_snapshot("org-1")
    entitlements = snapshot.entitlements

    assert snapshot.plan_id == "free"
    assert entitlements["features"]["access_surface.mcp"] is False
    assert entitlements["features"]["access_surface.sandbox"] is False
    assert entitlements["features"]["remote_workspace.create"] is False
    assert entitlements["limits"]["seats.max"] == 1
    assert entitlements["limits"]["projects.max"] == 1
    assert entitlements["limits"]["repo_scopes.max_per_project"] == 2
    assert entitlements["limits"]["files.max_per_project"] == 2000
    assert entitlements["limits"]["storage.max_bytes"] == 1024 * 1024 * 1024
    assert entitlements["limits"]["storage.max_bytes_per_project"] == 1024 * 1024 * 1024
    assert entitlements["limits"]["upload.max_single_file_bytes"] == 50 * 1024 * 1024
    assert entitlements["limits"]["upload.max_batch_bytes"] == 1024 * 1024 * 1024
    assert entitlements["allow"]["access_surface_kinds"] == [
        "git_remote",
        "cli",
        "direct",
    ]


class _PlusPartialEntitlementRepository:
    def get_by_org_id(self, org_id: str):
        return EntitlementSnapshot(
            org_id=org_id,
            plan_id="plus",
            status="active",
            source="puppypay",
            entitlements={"features": {"access_surface.mcp": True}},
        )


def test_paid_plan_defaults_are_used_for_partial_snapshots(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ENTITLEMENTS_MODE", "db", raising=False)

    snapshot = EntitlementService(repository=_PlusPartialEntitlementRepository()).get_snapshot("org-1")
    entitlements = snapshot.entitlements

    assert snapshot.plan_id == "plus"
    assert entitlements["features"]["access_surface.mcp"] is True
    assert entitlements["features"]["remote_workspace.create"] is False
    assert entitlements["limits"]["storage.max_bytes"] == 50 * 1024 * 1024 * 1024
    assert entitlements["limits"]["storage.max_bytes_per_project"] == 10 * 1024 * 1024 * 1024
    assert entitlements["limits"]["upload.max_single_file_bytes"] == 200 * 1024 * 1024
    assert entitlements["allow"]["access_surface_kinds"] == [
        "git_remote",
        "cli",
        "direct",
        "mcp",
    ]
