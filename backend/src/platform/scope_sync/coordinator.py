"""SyncCoordinator — the in-sandbox sync orchestration (per scope × user × session).

Drives the two-speed model using the pure policy + the abstract ports:
  - file edits → debounced **checkpoints** (private draft lane).
  - publish triggers → **publish** (PRE_PUBLISH fetch → rebase+promote).
  - upstream advance → **auto-integrate** (disjoint) or **hold+notify** (overlap).
  - rollback → restore the working tree to a checkpoint (no SoT change).

Pure orchestration over ports → unit-testable with fakes. The real sidecar wraps
this with an inotify watcher + a tick loop (calls ``note_edit`` / ``maybe_checkpoint``
/ ``handle`` / ``on_upstream``).
"""

from __future__ import annotations

import time
import uuid
from typing import Callable

from src.platform.scope_sync.policy import (
    SyncAction,
    SyncPolicyConfig,
    TriggerEvent,
    decide_event,
    decide_upstream,
    should_checkpoint,
)
from src.platform.scope_sync.ports import (
    Checkpoint,
    CheckpointStore,
    CoordinatorState,
    Publisher,
    PublishOutcome,
    PublishResult,
    WorkingTree,
)


class SyncCoordinator:
    def __init__(
        self,
        policy: SyncPolicyConfig,
        working_tree: WorkingTree,
        checkpoints: CheckpointStore,
        publisher: Publisher,
        *,
        clock: Callable[[], float] = time.time,
        notify: Callable[[set[str]], None] | None = None,
    ) -> None:
        self._policy = policy
        self._wt = working_tree
        self._checkpoints = checkpoints
        self._publisher = publisher
        self._clock = clock
        self._notify = notify
        self._state = CoordinatorState()

    def _now(self, now: float | None) -> float:
        return self._clock() if now is None else now

    @property
    def state(self) -> CoordinatorState:
        return self._state

    def _dirty(self) -> bool:
        return bool(self._wt.dirty_paths())

    # ── edits + checkpoint cadence ────────────────────────────────────

    def note_edit(self, *, now: float | None = None) -> None:
        """Record that a write landed (drives the debounce window)."""
        self._state.last_edit_at = self._now(now)

    def maybe_checkpoint(self, *, now: float | None = None) -> Checkpoint | None:
        """Tick: checkpoint iff the cadence policy says so (debounce / max-interval)."""
        now = self._now(now)
        if not should_checkpoint(
            self._policy, now=now, dirty=self._dirty(),
            last_edit_at=self._state.last_edit_at,
            last_checkpoint_at=self._state.last_checkpoint_at,
        ):
            return None
        return self._do_checkpoint(now)

    def _do_checkpoint(self, now: float) -> Checkpoint:
        snap = self._wt.snapshot()
        parent = self._checkpoints.latest()
        cp = self._checkpoints.save(snap, created_at=now, parent_id=parent.id if parent else None)
        self._state.last_checkpoint_at = now
        return cp

    # ── generic trigger events ────────────────────────────────────────

    def handle(self, event: TriggerEvent, *, now: float | None = None) -> tuple[SyncAction, ...]:
        """Apply the policy's actions for ``event``. Returns the actions actually
        performed (excluding NONE)."""
        now = self._now(now)
        performed: list[SyncAction] = []
        for action in decide_event(event, self._policy, dirty=self._dirty()):
            if action is SyncAction.CHECKPOINT:
                self._do_checkpoint(now); performed.append(action)
            elif action is SyncAction.PUBLISH:
                self.publish(now=now); performed.append(action)
            elif action is SyncAction.FETCH:
                self._publisher.fetch(); performed.append(action)
            # NONE / others: nothing
        return tuple(performed)

    # ── publish (the version lane) ────────────────────────────────────

    def publish(self, *, now: float | None = None) -> PublishResult:
        """Promote the current working state to a version: PRE_PUBLISH fetch →
        checkpoint → rebase+promote. No-op if nothing changed since last publish."""
        now = self._now(now)
        snap = self._wt.snapshot()
        if not self._dirty() and snap.tree_hash == self._state.last_published_tree_hash:
            return PublishResult(PublishOutcome.NOOP)

        if self._policy.fetch_before_publish:
            self._publisher.fetch()
        # capture the exact state we publish as a checkpoint first (revertible)
        self._do_checkpoint(now)
        result = self._publisher.publish(snap, conflict_policy=self._policy.conflict_policy)
        if result.outcome is PublishOutcome.PUBLISHED:
            self._state.last_published_tree_hash = snap.tree_hash
            self._state.held_upstream_paths.clear()  # publish rebased onto head → caught up
        return result

    # ── upstream advance (lazy, path-scoped) ──────────────────────────

    def on_upstream(self, affected_paths: set[str], *, now: float | None = None) -> tuple[SyncAction, ...]:
        """Another version advanced touching ``affected_paths``. Auto-integrate if
        disjoint from the local dirty set; else hold + notify."""
        actions = decide_upstream(set(affected_paths), self._wt.dirty_paths(), self._policy)
        for action in actions:
            if action is SyncAction.AUTO_INTEGRATE:
                self._wt.integrate(set(affected_paths))
            elif action is SyncAction.HOLD:
                self._state.held_upstream_paths |= set(affected_paths)
            elif action is SyncAction.NOTIFY and self._notify is not None:
                self._notify(set(affected_paths))
        return actions

    def held_upstream(self) -> set[str]:
        return set(self._state.held_upstream_paths)

    # ── rollback (local, no SoT change) ───────────────────────────────

    def rollback(self, checkpoint_id: str) -> Checkpoint:
        cp = self._checkpoints.get(checkpoint_id)
        if cp is None:
            raise LookupError(f"checkpoint {checkpoint_id} not found")
        self._wt.restore(cp)
        return cp


# A trivial default id minter for in-memory checkpoint stores / tests.
def new_checkpoint_id() -> str:
    return uuid.uuid4().hex
