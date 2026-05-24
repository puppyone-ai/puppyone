"""Regression: agent_review / agent_auto_resolve policies queue the
right shape of pending rows and route to the agent dispatcher.

The agent merge feature was a P0 gap from the V2 audit: the policy
names existed in the ``ConflictPolicyName`` Literal but no engine
code dispatched them. This suite locks in:

  - ``_resolve_modify_path`` queues a pending row for ``agent_review``
    (same shape as ``manual_review`` but ``policy=agent_review``).
  - ``_resolve_modify_delete`` / ``_resolve_delete_modify`` follow.
  - ``_resolver_kind_for`` returns ``"agent"`` for agent policies
    regardless of source channel.
  - The agent runner protocol works: a function-based runner can pick
    accept / reject / defer; an unregistered dispatcher logs and
    leaves the row pending.
"""

from __future__ import annotations

import pytest

from src.version_engine.derived.agent_resolver import (
    AgentDecision,
    AgentResolverDispatcher,
    NoopAgentRunner,
    runner_from_callable,
)
from src.version_engine.domain.conflicts import ConflictPolicyDecision
from src.version_engine.infrastructure.supabase.transaction_ledger import (
    _resolver_kind_for,
)
from src.version_engine.write_engine.conflict_policy import (
    QUEUE_POLICIES,
    merge_file_sets_for_policy,
)


def _agent_policy() -> ConflictPolicyDecision:
    return ConflictPolicyDecision(
        policy="agent_review",
        reason="test:agent_review",
    )


def _auto_policy() -> ConflictPolicyDecision:
    return ConflictPolicyDecision(
        policy="agent_auto_resolve",
        reason="test:agent_auto_resolve",
    )


class TestQueuePolicySet:
    def test_agent_policies_in_queue_set(self):
        assert "manual_review" in QUEUE_POLICIES
        assert "agent_review" in QUEUE_POLICIES
        assert "agent_auto_resolve" in QUEUE_POLICIES
        # LWW and reject are NOT queued — they resolve in-engine.
        assert "last_write_wins" not in QUEUE_POLICIES
        assert "reject" not in QUEUE_POLICIES


class TestResolverKind:
    def test_agent_policy_overrides_source_channel(self):
        # Even from a papi (human) channel, agent_review routes to
        # the agent resolver.
        assert _resolver_kind_for("papi", "agent_review") == "agent"
        assert _resolver_kind_for("papi", "agent_auto_resolve") == "agent"

    def test_manual_review_still_human(self):
        assert _resolver_kind_for("papi", "manual_review") == "human"

    def test_channel_fallback_when_no_agent_policy(self):
        # Without policy info, channel decides.
        assert _resolver_kind_for("agent", "") == "agent"
        assert _resolver_kind_for("sync", "") == "agent"
        assert _resolver_kind_for("papi", "") == "human"
        assert _resolver_kind_for("git", "") == "human"


class TestAgentPolicyMergeShape:
    def test_modify_path_queues_under_agent_review(self):
        """Both sides modified the same path under agent_review:
        merge result should carry exactly one manual_conflict record
        flagged with the agent_review strategy and keep ``ours`` in
        the merged tree so the file isn't lost."""
        base = {"a.md": b"v0"}
        ours = {"a.md": b"alice"}
        theirs = {"a.md": b"bob"}
        result = merge_file_sets_for_policy(
            base, ours, theirs, policy=_agent_policy(),
        )
        assert len(result.manual_conflicts) == 1
        assert result.manual_conflicts[0].strategy == "agent_review"
        assert "agent merge required" in (result.manual_conflicts[0].detail or "")
        assert result.merged_files.get("a.md") == b"alice", (
            "merged file should keep ours while agent thinks"
        )

    def test_modify_delete_queues_under_agent_auto_resolve(self):
        base = {"a.md": b"v0"}
        ours = {"a.md": b"alice modified"}
        theirs = {}  # incoming deleted
        result = merge_file_sets_for_policy(
            base, ours, theirs, policy=_auto_policy(),
        )
        assert len(result.manual_conflicts) == 1
        record = result.manual_conflicts[0]
        assert record.strategy == "modify_delete"
        assert "agent merge required" in (record.detail or "")
        assert result.merged_files.get("a.md") == b"alice modified"

    def test_delete_modify_queues_under_agent_review(self):
        base = {"a.md": b"v0"}
        ours = {}  # server deleted
        theirs = {"a.md": b"bob modified"}
        result = merge_file_sets_for_policy(
            base, ours, theirs, policy=_agent_policy(),
        )
        assert len(result.manual_conflicts) == 1
        record = result.manual_conflicts[0]
        assert record.strategy == "delete_modify"
        assert "agent merge required" in (record.detail or "")
        # delete_modify intentionally does NOT keep ours (no ours to
        # keep) — merged tree mirrors current (deleted) state.
        assert "a.md" not in result.merged_files


class TestAgentRunner:
    def setup_method(self, _method):
        AgentResolverDispatcher.reset()

    def teardown_method(self, _method):
        AgentResolverDispatcher.reset()

    def test_install_replaces_previous_runner(self):
        AgentResolverDispatcher.install(NoopAgentRunner())
        first = AgentResolverDispatcher.get()
        assert first is not None

        async def take_two(_row):
            return AgentDecision(decision="defer", resolver_actor="agent:v2")

        AgentResolverDispatcher.install(runner_from_callable(take_two))
        second = AgentResolverDispatcher.get()
        assert second is not None and second is not first

    @pytest.mark.asyncio
    async def test_noop_runner_defers(self):
        runner = NoopAgentRunner()
        decision = await runner.resolve({
            "pending_conflict_id": "p1",
            "policy": "agent_review",
        })
        assert decision.decision == "defer"

    @pytest.mark.asyncio
    async def test_callable_runner_can_accept(self):
        async def picker(row):
            return AgentDecision(
                decision="accept",
                resolution_files={
                    row["payload"]["scope_path"] + "/a.md": b"merged-by-agent",
                },
                resolver_actor="agent:test-picker",
                resolution_message="picked theirs",
            )

        runner = runner_from_callable(picker)
        decision = await runner.resolve({
            "payload": {"scope_path": "docs"},
            "pending_conflict_id": "p2",
        })
        assert decision.decision == "accept"
        assert decision.resolution_files == {"docs/a.md": b"merged-by-agent"}
        assert decision.resolver_actor == "agent:test-picker"

    def test_dispatcher_get_returns_none_when_uninstalled(self):
        assert AgentResolverDispatcher.get() is None
