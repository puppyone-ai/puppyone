"""A4: pending-conflict persistence must record the SELECTED policy.

record_pending_conflict used to hardcode policy="manual_review" in all
three persisted places (audit, version_transactions, mut_conflicts),
discarding agent_review / agent_auto_resolve. That defeated PUP-5's
"Pending review" split (driven by policy) and the ledger's resolver_kind
derivation (agent_* must route to the agent resolver). These lock in that
the real policy now flows through.
"""
from __future__ import annotations

import pytest

from src.version_engine.write_engine.conflict_queue import record_pending_conflict


class _FakeRepo:
    def __init__(self):
        self.audit_policy = None

    def record_audit(self, _event, _actor, detail):
        self.audit_policy = detail.get("policy")


class _FakeLedger:
    def __init__(self):
        self.txn_policy = None
        self.pending_policy = None

    def insert_version_transaction(self, **kw):
        self.txn_policy = kw.get("policy")
        return 7

    def record_pending_conflict(self, **kw):
        self.pending_policy = kw.get("policy")


async def _run(policy=None):
    repo, ledger = _FakeRepo(), _FakeLedger()
    kwargs = dict(
        ledger=ledger, repo=repo, project_id="p", scope_path="",
        current_head_commit_id="c1", current_scope_hash="h1", client_commit_id="x1",
        base_commit_id="b1", proposed_tree_id="t1", source_channel="git", actor="git:a",
        message="m", audit_detail={}, base_files={}, current_files={}, incoming_files={},
        manual_conflicts=[], policy_reason="reason",
    )
    if policy is not None:
        kwargs["policy"] = policy
    await record_pending_conflict(**kwargs)
    return repo, ledger


@pytest.mark.asyncio
async def test_selected_agent_review_policy_is_persisted_everywhere():
    repo, ledger = await _run(policy="agent_review")
    assert repo.audit_policy == "agent_review"
    assert ledger.txn_policy == "agent_review"
    assert ledger.pending_policy == "agent_review"


@pytest.mark.asyncio
async def test_agent_auto_resolve_policy_is_persisted():
    repo, ledger = await _run(policy="agent_auto_resolve")
    assert repo.audit_policy == "agent_auto_resolve"
    assert ledger.txn_policy == "agent_auto_resolve"
    assert ledger.pending_policy == "agent_auto_resolve"


@pytest.mark.asyncio
async def test_default_policy_is_manual_review():
    repo, ledger = await _run()  # omitted → backward-compatible default
    assert repo.audit_policy == "manual_review"
    assert ledger.txn_policy == "manual_review"
    assert ledger.pending_policy == "manual_review"
