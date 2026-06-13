"""SyncCoordinator orchestration tests (fakes for the ports)."""

from __future__ import annotations

import itertools

from src.platform.scope_sync.coordinator import SyncCoordinator, new_checkpoint_id
from src.platform.scope_sync.policy import (
    Persona,
    SyncAction,
    TriggerEvent,
    policy_for,
)
from src.platform.scope_sync.ports import (
    Checkpoint,
    PublishOutcome,
    PublishResult,
    TreeSnapshot,
)


class FakeWorkingTree:
    def __init__(self) -> None:
        self._dirty: set[str] = set()
        self.tree_hash = "t0"
        self.integrated: list[set[str]] = []
        self.restored: list[Checkpoint] = []

    def set_dirty(self, paths: set[str], tree_hash: str | None = None) -> None:
        self._dirty = set(paths)
        if tree_hash:
            self.tree_hash = tree_hash

    def dirty_paths(self) -> set[str]:
        return set(self._dirty)

    def snapshot(self) -> TreeSnapshot:
        return TreeSnapshot(tree_hash=self.tree_hash, changed_paths=tuple(sorted(self._dirty)))

    def restore(self, checkpoint: Checkpoint) -> None:
        self.restored.append(checkpoint)

    def integrate(self, paths: set[str]) -> None:
        self.integrated.append(set(paths))


class FakeCheckpointStore:
    def __init__(self) -> None:
        self._items: list[Checkpoint] = []
        self._ids = (f"cp-{i}" for i in itertools.count(1))

    def save(self, snap: TreeSnapshot, *, created_at: float, parent_id: str | None) -> Checkpoint:
        cp = Checkpoint(id=next(self._ids), created_at=created_at, tree_hash=snap.tree_hash,
                        changed_paths=snap.changed_paths, parent_id=parent_id)
        self._items.append(cp)
        return cp

    def latest(self) -> Checkpoint | None:
        return self._items[-1] if self._items else None

    def list(self) -> list[Checkpoint]:
        return list(self._items)

    def get(self, checkpoint_id: str) -> Checkpoint | None:
        return next((c for c in self._items if c.id == checkpoint_id), None)


class FakePublisher:
    def __init__(self, result: PublishResult | None = None) -> None:
        self.fetches = 0
        self.publishes = 0
        self._result = result or PublishResult(PublishOutcome.PUBLISHED, version_id="v1")

    def fetch(self) -> None:
        self.fetches += 1

    def publish(self, snap: TreeSnapshot, *, conflict_policy: str) -> PublishResult:
        self.publishes += 1
        self.last_conflict_policy = conflict_policy
        return self._result


def _coord(persona=Persona.NON_DEV, publisher=None, notify=None):
    wt = FakeWorkingTree()
    cps = FakeCheckpointStore()
    pub = publisher or FakePublisher()
    c = SyncCoordinator(policy_for(persona), wt, cps, pub, clock=lambda: 0.0, notify=notify)
    return c, wt, cps, pub


# ── checkpoint cadence ────────────────────────────────────────────────

def test_maybe_checkpoint_debounce():
    c, wt, cps, _ = _coord()
    wt.set_dirty({"a.txt"})
    c.note_edit(now=100)
    assert c.maybe_checkpoint(now=101) is None          # 1s < debounce
    cp = c.maybe_checkpoint(now=110)                      # 10s ≥ debounce(3)
    assert cp is not None and cps.list() == [cp]


def test_maybe_checkpoint_noop_when_clean():
    c, wt, cps, _ = _coord()
    c.note_edit(now=100)
    assert c.maybe_checkpoint(now=200) is None and cps.list() == []


def test_checkpoint_chain_links_parent():
    c, wt, cps, _ = _coord()
    wt.set_dirty({"a"})
    c.note_edit(now=0)
    cp1 = c.maybe_checkpoint(now=10)
    wt.set_dirty({"b"}, tree_hash="t1")
    c.note_edit(now=20)
    cp2 = c.maybe_checkpoint(now=30)
    assert cp2.parent_id == cp1.id


# ── events ────────────────────────────────────────────────────────────

def test_file_change_event_checkpoints_when_dirty():
    c, wt, cps, _ = _coord()
    wt.set_dirty({"a"})
    assert c.handle(TriggerEvent.FILE_CHANGE, now=5) == (SyncAction.CHECKPOINT,)
    assert len(cps.list()) == 1


def test_agent_done_publishes_and_fetches_first():
    c, wt, cps, pub = _coord(Persona.NON_DEV)
    wt.set_dirty({"a"}, tree_hash="t1")
    actions = c.handle(TriggerEvent.AGENT_DONE, now=5)
    assert actions == (SyncAction.PUBLISH,)
    assert pub.fetches == 1 and pub.publishes == 1        # PRE_PUBLISH fetch then publish
    assert pub.last_conflict_policy == "agent_auto_resolve"


def test_connect_only_fetches():
    c, wt, cps, pub = _coord(Persona.DEV)
    assert c.handle(TriggerEvent.CLIENT_CONNECT) == (SyncAction.FETCH,)
    assert pub.fetches == 1 and pub.publishes == 0


def test_disconnect_non_dev_checkpoints_and_publishes():
    c, wt, cps, pub = _coord(Persona.NON_DEV)
    wt.set_dirty({"a"}, tree_hash="t1")
    actions = c.handle(TriggerEvent.DISCONNECT, now=5)
    assert actions == (SyncAction.CHECKPOINT, SyncAction.PUBLISH)
    assert pub.publishes == 1


def test_disconnect_dev_checkpoints_only():
    c, wt, cps, pub = _coord(Persona.DEV)
    wt.set_dirty({"a"}, tree_hash="t1")
    assert c.handle(TriggerEvent.DISCONNECT, now=5) == (SyncAction.CHECKPOINT,)
    assert pub.publishes == 0


# ── publish ───────────────────────────────────────────────────────────

def test_publish_noop_when_clean_and_unchanged():
    c, wt, cps, pub = _coord()
    # not dirty, tree_hash never published → first publish is also noop only if
    # tree matches last_published (None). Make tree match a published state:
    wt.set_dirty(set(), tree_hash="t0")
    # prime: a real publish to set last_published_tree_hash
    wt.set_dirty({"a"}, tree_hash="t1")
    assert c.publish(now=1).outcome is PublishOutcome.PUBLISHED
    wt.set_dirty(set(), tree_hash="t1")                   # clean + same tree as published
    assert c.publish(now=2).outcome is PublishOutcome.NOOP


def test_publish_records_base_and_clears_held():
    c, wt, cps, pub = _coord()
    c.state.held_upstream_paths = {"x"}
    wt.set_dirty({"a"}, tree_hash="t1")
    res = c.publish(now=1)
    assert res.outcome is PublishOutcome.PUBLISHED
    assert c.state.last_published_tree_hash == "t1"
    assert c.held_upstream() == set()                     # rebased onto head → caught up


def test_publish_conflict_surfaces_result():
    pub = FakePublisher(PublishResult(PublishOutcome.CONFLICT, conflict_paths=("a",),
                                      conflict_policy="agent_review"))
    c, wt, cps, _ = _coord(Persona.DEV, publisher=pub)
    wt.set_dirty({"a"}, tree_hash="t1")
    res = c.publish(now=1)
    assert res.outcome is PublishOutcome.CONFLICT and res.conflict_paths == ("a",)
    assert c.state.last_published_tree_hash is None        # not advanced on conflict


# ── upstream advance ──────────────────────────────────────────────────

def test_upstream_disjoint_auto_integrates():
    c, wt, cps, pub = _coord(Persona.NON_DEV)
    wt.set_dirty({"src/b.py"})
    actions = c.on_upstream({"docs/a.md"})
    assert actions == (SyncAction.AUTO_INTEGRATE,)
    assert wt.integrated == [{"docs/a.md"}] and c.held_upstream() == set()


def test_upstream_overlap_holds_and_notifies():
    seen: list[set[str]] = []
    c, wt, cps, pub = _coord(Persona.NON_DEV, notify=seen.append)
    wt.set_dirty({"docs/a.md"})
    actions = c.on_upstream({"docs/a.md"})
    assert actions == (SyncAction.HOLD, SyncAction.NOTIFY)
    assert wt.integrated == [] and c.held_upstream() == {"docs/a.md"} and seen == [{"docs/a.md"}]


# ── rollback ──────────────────────────────────────────────────────────

def test_rollback_restores_checkpoint():
    c, wt, cps, _ = _coord()
    wt.set_dirty({"a"}); c.note_edit(now=0)
    cp = c.maybe_checkpoint(now=10)
    c.rollback(cp.id)
    assert wt.restored == [cp]


def test_rollback_unknown_raises():
    c, *_ = _coord()
    import pytest
    with pytest.raises(LookupError):
        c.rollback("nope")
