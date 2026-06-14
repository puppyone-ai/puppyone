"""Ports (interfaces) + value types for the sync coordinator.

The coordinator orchestrates over these abstract ports so its logic is unit-
testable without a real sandbox / git / object store. Concrete impls:
  - WorkingTree   → the sandbox working tree (git status + sparse checkout).
  - CheckpointStore → shadow-snapshot-backed checkpoint chain (M1c).
  - Publisher     → fetch + rebase-onto-head + promote→commit (M2).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol


@dataclass(frozen=True)
class TreeSnapshot:
    """A capture of the working tree at an instant."""

    tree_hash: str
    changed_paths: tuple[str, ...] = ()   # vs the last published base


@dataclass(frozen=True)
class Checkpoint:
    """A private, revertible draft in the checkpoint chain (NOT in SoT)."""

    id: str
    created_at: float
    tree_hash: str
    changed_paths: tuple[str, ...] = ()
    parent_id: str | None = None


class PublishOutcome(str, Enum):
    PUBLISHED = "published"   # promoted to a new version (SoT advanced)
    CONFLICT = "conflict"     # rebase hit a real overlap → routed to resolver
    NOOP = "noop"             # nothing new to publish


@dataclass(frozen=True)
class PublishResult:
    outcome: PublishOutcome
    version_id: str | None = None
    conflict_paths: tuple[str, ...] = ()
    conflict_policy: str | None = None


class WorkingTree(Protocol):
    def dirty_paths(self) -> set[str]:
        """Paths changed in the working tree since the last published base."""

    def snapshot(self) -> TreeSnapshot:
        """Capture the current working tree (cheap; read-only)."""

    def restore(self, checkpoint: Checkpoint) -> None:
        """Reset the working tree to a checkpoint (local rollback; no SoT change)."""

    def integrate(self, paths: set[str]) -> None:
        """Fast-forward only ``paths`` from upstream (sparse checkout)."""


class CheckpointStore(Protocol):
    def save(self, snap: TreeSnapshot, *, created_at: float, parent_id: str | None) -> Checkpoint: ...
    def latest(self) -> Checkpoint | None: ...
    def list(self) -> list[Checkpoint]: ...
    def get(self, checkpoint_id: str) -> Checkpoint | None: ...


class Publisher(Protocol):
    def fetch(self) -> None:
        """Incremental fetch of the scope's latest SoT (git fetch, not re-clone)."""

    def publish(self, snap: TreeSnapshot, *, conflict_policy: str) -> PublishResult:
        """Rebase ``snap`` onto the scope head and promote → a version. On a real
        overlap, route to the server resolver per ``conflict_policy`` and return
        a CONFLICT result."""


@dataclass
class CoordinatorState:
    """Mutable bookkeeping the coordinator keeps between events."""

    last_edit_at: float | None = None
    last_checkpoint_at: float | None = None
    last_published_tree_hash: str | None = None
    held_upstream_paths: set[str] = field(default_factory=set)
