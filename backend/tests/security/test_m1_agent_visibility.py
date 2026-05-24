"""M-1 — Agent visibility (private vs org).

The vulnerability: agent visibility was never enforced. Any org member
could see any agent in the org — including agents the creator marked
"private" via the config flag. After the fix, AgentRepository.verify_access
honors config.visibility, and list_agents filters out private agents
owned by other users.

These tests exercise the repository's filter logic directly with mocked
Supabase responses, so they don't need a live DB.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.connectors.agent.config.repository import AgentRepository


def _build_repo_with_rows(agent_rows: list[dict], project_org: str = "org-1"):
    """Build a repo whose Supabase client returns the given rows for
    common queries used by verify_access / get_by_project_id_with_accesses.
    """
    repo = AgentRepository.__new__(AgentRepository)
    repo._client = MagicMock()  # type: ignore[attr-defined]
    repo.TABLE = "connectors"

    # Make .table('connectors').select(...).eq(...).limit().execute()
    # return one of the given rows depending on the .eq() args.
    def fake_table(name):
        m = MagicMock()
        if name == "connectors":
            chain = MagicMock()
            chain.select.return_value = chain
            chain.eq.return_value = chain
            chain.limit.return_value = chain
            chain.order.return_value = chain
            chain.execute.return_value = MagicMock(data=agent_rows)
            return chain
        if name == "projects":
            chain = MagicMock()
            chain.select.return_value = chain
            chain.eq.return_value = chain
            chain.execute.return_value = MagicMock(
                data=[{"org_id": project_org}]
            )
            return chain
        return MagicMock()

    repo._client.table.side_effect = fake_table  # type: ignore[attr-defined]
    return repo


# ── verify_access ──────────────────────────────────────────────────────


def _verify(repo, agent_id, user_id, *, member=True):
    """Patch org membership so we isolate the visibility logic."""
    with patch(
        "src.platform.organization.repository.OrganizationRepository"
    ) as org_cls:
        org_cls.return_value.get_member.return_value = (
            {"user_id": user_id} if member else None
        )
        return repo.verify_access(agent_id, user_id)


def test_org_visible_agent_visible_to_any_org_member():
    rows = [{
        "id": "ag-1", "project_id": "p-1",
        "config": {"visibility": "org"},
        "created_by": "alice",
    }]
    repo = _build_repo_with_rows(rows)
    assert _verify(repo, "ag-1", "bob") is True


def test_private_agent_visible_to_owner():
    rows = [{
        "id": "ag-private", "project_id": "p-1",
        "config": {"visibility": "private"},
        "created_by": "alice",
    }]
    repo = _build_repo_with_rows(rows)
    assert _verify(repo, "ag-private", "alice") is True


def test_private_agent_hidden_from_other_org_member():
    """The fix's core property: private agents are hidden from other org
    members even though they ARE in the same org."""
    rows = [{
        "id": "ag-private", "project_id": "p-1",
        "config": {"visibility": "private"},
        "created_by": "alice",
    }]
    repo = _build_repo_with_rows(rows)
    assert _verify(repo, "ag-private", "bob") is False


def test_missing_visibility_defaults_to_org():
    """Backward-compat: pre-existing rows without visibility field stay
    org-visible (the field's absence ≡ 'org')."""
    rows = [{
        "id": "ag-legacy", "project_id": "p-1",
        "config": {},  # no visibility
        "created_by": "alice",
    }]
    repo = _build_repo_with_rows(rows)
    assert _verify(repo, "ag-legacy", "bob") is True


def test_non_org_member_blocked_regardless_of_visibility():
    """Layer-1 check still works: non-org members can't see anything."""
    rows = [{
        "id": "ag-1", "project_id": "p-1",
        "config": {"visibility": "org"},
        "created_by": "alice",
    }]
    repo = _build_repo_with_rows(rows)
    assert _verify(repo, "ag-1", "intruder", member=False) is False


# ── list filter ────────────────────────────────────────────────────────


def test_list_filters_private_agents_for_non_owner():
    rows = [
        {"id": "ag-org",     "project_id": "p", "config": {"visibility": "org",     "name": "OrgA"},  "created_by": "alice", "trigger": {}, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
        {"id": "ag-private", "project_id": "p", "config": {"visibility": "private", "name": "PrivA"}, "created_by": "alice", "trigger": {}, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
    ]
    repo = _build_repo_with_rows(rows)
    repo.get_tools_by_agent_id_for_mcp = MagicMock(return_value=[])
    repo._client.table("access_tools").select.return_value.in_.return_value.order.return_value.execute.return_value.data = []

    # Bob (non-owner) — only the org-visible agent should be returned.
    visible_for_bob = repo.get_by_project_id_with_accesses(
        "p", viewer_user_id="bob",
    )
    assert {a.id for a in visible_for_bob} == {"ag-org"}

    # Alice (owner) — both agents.
    visible_for_alice = repo.get_by_project_id_with_accesses(
        "p", viewer_user_id="alice",
    )
    assert {a.id for a in visible_for_alice} == {"ag-org", "ag-private"}


def test_list_with_no_viewer_returns_all():
    """When viewer_user_id=None (internal callers that already gated
    access), the filter is skipped — caller's responsibility."""
    rows = [
        {"id": "ag-private", "project_id": "p",
         "config": {"visibility": "private", "name": "P"},
         "created_by": "alice", "trigger": {},
         "created_at": "2026-01-01", "updated_at": "2026-01-01"},
    ]
    repo = _build_repo_with_rows(rows)
    repo.get_tools_by_agent_id_for_mcp = MagicMock(return_value=[])
    repo._client.table("access_tools").select.return_value.in_.return_value.order.return_value.execute.return_value.data = []

    visible = repo.get_by_project_id_with_accesses("p", viewer_user_id=None)
    assert len(visible) == 1
