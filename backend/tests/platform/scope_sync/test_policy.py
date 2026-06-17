"""Pure trigger-policy engine tests (the sync brain)."""

from __future__ import annotations

from src.platform.scope_sync.policy import (
    ClientKind,
    Persona,
    ScopeRole,
    SyncAction,
    SyncPolicyConfig,
    TriggerEvent,
    decide_event,
    decide_upstream,
    paths_overlap,
    policy_for,
    should_checkpoint,
)


# ── presets ───────────────────────────────────────────────────────────

def test_non_dev_is_autopilot():
    p = policy_for(Persona.NON_DEV)
    assert p.publish_on_disconnect is True          # never strand a non-dev's work
    assert p.quiescence_publish_s > 0               # publishes once work settles
    assert p.conflict_policy == "agent_auto_resolve"  # never show git/conflicts


def test_dev_publishes_deliberately():
    p = policy_for(Persona.DEV)
    assert p.quiescence_publish_s == 0              # no idle-publish
    assert p.publish_on_verification is True        # green build is a commit boundary
    assert p.publish_on_disconnect is False         # WIP stays a draft


def test_root_owner_gets_reviewer_policy_unless_dev():
    assert policy_for(Persona.NON_DEV, scope_role=ScopeRole.ROOT).conflict_policy == "manual_review"
    assert policy_for(Persona.REVIEWER).auto_integrate_disjoint is False
    # a dev keeps dev policy even at root
    assert policy_for(Persona.DEV, scope_role=ScopeRole.ROOT).publish_on_verification is True


# ── checkpoint cadence ────────────────────────────────────────────────

CFG = SyncPolicyConfig(checkpoint_debounce_s=4.0, checkpoint_max_interval_s=60.0)


def test_no_checkpoint_when_clean():
    assert should_checkpoint(CFG, now=100, dirty=False, last_edit_at=10, last_checkpoint_at=None) is False


def test_checkpoint_on_debounce():
    # edits stopped 5s ago (>= 4s debounce) → checkpoint
    assert should_checkpoint(CFG, now=100, dirty=True, last_edit_at=95, last_checkpoint_at=None) is True
    # edits stopped only 2s ago → not yet
    assert should_checkpoint(CFG, now=100, dirty=True, last_edit_at=98, last_checkpoint_at=90) is False


def test_checkpoint_on_max_interval_during_sustained_edits():
    # still actively editing (1s ago) but last checkpoint was 65s ago (>= 60) → checkpoint
    assert should_checkpoint(CFG, now=100, dirty=True, last_edit_at=99, last_checkpoint_at=35) is True


# ── event → actions ───────────────────────────────────────────────────

def test_cadence_events_checkpoint_only_when_dirty():
    p = policy_for(Persona.NON_DEV)
    assert decide_event(TriggerEvent.FILE_CHANGE, p, dirty=True) == (SyncAction.CHECKPOINT,)
    assert decide_event(TriggerEvent.FILE_CHANGE, p, dirty=False) == (SyncAction.NONE,)


def test_quiescence_publishes_for_non_dev_not_dev():
    assert decide_event(TriggerEvent.QUIESCENCE, policy_for(Persona.NON_DEV)) == (SyncAction.PUBLISH,)
    assert decide_event(TriggerEvent.QUIESCENCE, policy_for(Persona.DEV)) == (SyncAction.NONE,)


def test_agent_done_and_explicit_publish():
    p = policy_for(Persona.DEV)
    assert decide_event(TriggerEvent.AGENT_DONE, p) == (SyncAction.PUBLISH,)
    assert decide_event(TriggerEvent.EXPLICIT_SAVE, p) == (SyncAction.PUBLISH,)


def test_verification_publishes_only_for_dev():
    assert decide_event(TriggerEvent.VERIFICATION_PASS, policy_for(Persona.DEV)) == (SyncAction.PUBLISH,)
    assert decide_event(TriggerEvent.VERIFICATION_PASS, policy_for(Persona.NON_DEV)) == (SyncAction.NONE,)


def test_publish_gated_on_dirty():
    # nothing changed → an explicit save is a no-op (don't create empty versions)
    assert decide_event(TriggerEvent.EXPLICIT_SAVE, policy_for(Persona.DEV), dirty=False) == (SyncAction.NONE,)


def test_connect_fetches():
    assert decide_event(TriggerEvent.CLIENT_CONNECT, policy_for(Persona.DEV)) == (SyncAction.FETCH,)


def test_pre_publish_fetches():
    assert decide_event(TriggerEvent.PRE_PUBLISH, policy_for(Persona.DEV)) == (SyncAction.FETCH,)


def test_disconnect_checkpoints_always_publish_per_policy():
    # non-dev: checkpoint + publish (don't strand work)
    assert decide_event(TriggerEvent.DISCONNECT, policy_for(Persona.NON_DEV)) == (
        SyncAction.CHECKPOINT, SyncAction.PUBLISH)
    # dev: checkpoint only (WIP stays a draft)
    assert decide_event(TriggerEvent.DISCONNECT, policy_for(Persona.DEV)) == (SyncAction.CHECKPOINT,)
    # nothing dirty → nothing to do
    assert decide_event(TriggerEvent.DISCONNECT, policy_for(Persona.NON_DEV), dirty=False) == (SyncAction.NONE,)


# ── upstream advance → integrate vs hold ──────────────────────────────

def test_disjoint_upstream_auto_integrates():
    p = policy_for(Persona.NON_DEV)
    assert decide_upstream({"docs/a.md"}, {"src/b.py"}, p) == (SyncAction.AUTO_INTEGRATE,)


def test_overlapping_upstream_holds_and_notifies():
    p = policy_for(Persona.NON_DEV)
    assert decide_upstream({"docs/a.md"}, {"docs/a.md"}, p) == (SyncAction.HOLD, SyncAction.NOTIFY)


def test_reviewer_notifies_even_when_disjoint():
    # root owner integrates on their own cadence → notify, don't auto-ff
    assert decide_upstream({"docs/a.md"}, {"src/b.py"}, policy_for(Persona.REVIEWER)) == (SyncAction.NOTIFY,)


# ── path overlap (prefix-aware) ───────────────────────────────────────

def test_paths_overlap_prefix_aware():
    assert paths_overlap({"docs/x.md"}, {"docs"}) is True        # file under changed dir
    assert paths_overlap({"docs"}, {"docs/x.md"}) is True        # dir over changed file
    assert paths_overlap({"docs/x.md"}, {"docs/x.md"}) is True   # exact
    assert paths_overlap({"docs/x.md"}, {"src/y.py"}) is False   # disjoint
    assert paths_overlap({"a/b"}, {"a/bc"}) is False             # not a true prefix (a/bc not under a/b)
    assert paths_overlap(set(), {"x"}) is False                  # empty dirty → never overlaps


def test_paths_overlap_normalizes_slashes():
    assert paths_overlap({"/docs/x.md/"}, {"docs/x.md"}) is True
