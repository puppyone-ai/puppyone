"""Write intents consumed by the Write Engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal


SourceChannel = Literal[
    "git",
    "papi",
    "web",
    "agent",
    "sync",
    "github",
]


@dataclass(frozen=True)
class ProjectWriteState:
    """Authoritative DB snapshot needed to start a product-root write.

    This is intentionally a request/input object, not a cache. It collapses
    project authorization and current root/head state into one database read,
    then lets the SQL CAS at publish time remain the correctness boundary.
    """

    project_id: str
    project_name: str
    org_id: str = ""
    visibility: str = "org"
    role: str = ""
    can_write: bool = False
    root_hash: str = ""
    head_commit_id: str = ""


@dataclass(frozen=True)
class OperationWriteIntent:
    """A typed product operation such as write, move, delete, or import."""

    project_id: str
    scope_path: str
    actor: str
    source_channel: SourceChannel
    operation_type: str
    message: str = ""
    audit_detail: dict = field(default_factory=dict)
    expected_head_commit_id: str | None = None
    allow_same_tree_commit: bool = False
    defer_projection: bool = False
    # Caller-requested conflict policy override (e.g. ``"manual_review"``)
    # — honored by ``_apply_operation_optimistic``'s CAS-retry merge so
    # ProductOperationAdapter callers that opt into ``manual_review`` queue conflicts in
    # the conflict table instead of silently merging via LWW. Empty string
    # falls back to the configured rule set in ``select_conflict_policy``.
    policy_override: str = ""
    project_write_state: ProjectWriteState | None = None
    # When the L1 router can attribute the write to a specific WS-
    # connected device/tab (via the ``X-PuppyOne-Client-Id`` header),
    # threading the value through here lets the L6 notification fan-out
    # suppress echo to ONLY that connection — the user's other tabs
    # still see the commit_update event for their own write. Empty
    # falls back to agent-level suppression in NotificationManager.
    pusher_client_id: str = ""


@dataclass(frozen=True)
class VersionSubmissionIntent:
    """A proposed Git tree/commit submitted by Git or an in-process adapter."""

    project_id: str
    scope_path: str
    actor: str
    source_channel: SourceChannel
    base_commit_id: str
    proposed_tree_id: str
    client_commit_id: str = ""
    message: str = ""
    scope_excludes: list[str] = field(default_factory=list)
    audit_detail: dict = field(default_factory=dict)
    proposed_files: dict[str, bytes] | None = None
    changed_paths: list[str] = field(default_factory=list)
    promote_objects: Callable[[], None] | None = None
    defer_projection: bool = False
    # Caller-requested conflict policy override (e.g. ``"manual_review"``).
    # Honored by the write engine's conflict-policy selection so Git push
    # callers can opt into ``manual_review`` instead of silently LWW-merging
    # on the server. Empty string falls back to the configured rule set.
    policy_override: str = ""
    # See ``OperationWriteIntent.pusher_client_id``. Git submissions
    # rarely have a WS-connected origin client but the field is here
    # for symmetry so AP-FS callers that hold a session can pass it.
    pusher_client_id: str = ""


@dataclass(frozen=True)
class RollbackIntent:
    """A source-side request to restore one scope to a historical commit."""

    project_id: str
    scope_path: str
    actor: str
    source_channel: SourceChannel
    target_commit_id: str
    message: str = ""
    scope_excludes: list[str] = field(default_factory=list)
    audit_detail: dict = field(default_factory=dict)
    defer_projection: bool = False
    # See ``OperationWriteIntent.policy_override``. Rollbacks can also
    # trip the conflict pipeline (e.g. concurrent edits while the target
    # commit's content is being applied) and deserve the same opt-in.
    policy_override: str = ""


@dataclass(frozen=True)
class ScopePromoteIntent:
    """A derived scope-promote publish — child commit lands on parent scope.

    Triggered by ``derived/parent_scope_promote`` after a child scope's
    commit lands; the parent ancestors graft the child tree into their
    own tree and need to publish a new ``scope-promote`` commit so the
    parent's Git view stays current. Conceptually this is a derived L6
    work, but the actual ref-advancing call must go through L5 (the
    engine) so all publishes share one audit / tracing / hardening
    boundary.

    Unlike ``OperationWriteIntent`` (engine builds the commit) and
    ``VersionSubmissionIntent`` (Git push supplies a proposed tree),
    scope-promote provides the FULLY-FORMED commit + tree — the engine
    just runs the publish RPC + lifecycle bookkeeping. Cordon logic
    (orphan-parent for damaged ancestry) is already applied to
    ``commit_id`` by the caller; the engine doesn't re-validate.
    """

    project_id: str
    scope_path: str
    actor: str
    source_channel: SourceChannel
    old_scope_hash: str
    new_scope_hash: str
    commit_id: str
    base_commit_id: str
    message: str
    audit_detail: dict = field(default_factory=dict)
    changes: list = field(default_factory=list)


ResolutionDecision = Literal["accept", "reject"]


@dataclass(frozen=True)
class ConflictResolutionIntent:
    """A manual or hosted-agent resolution for a pending transaction.

    Re-enters the publish pipeline rather than bypassing it: the engine
    treats ``resolution_tree_id`` as a server-side proposed tree applied
    on top of the current scope head, records the resolver's identity in
    audit, and clears the pending conflict row.

    ``decision``:
      - ``"accept"``: publish ``resolution_tree_id`` as the new scope state.
      - ``"reject"``: leave the scope head unchanged but close the pending
        conflict with an audited rejection.
    """

    project_id: str
    pending_conflict_id: str
    scope_path: str
    resolver_actor: str
    source_channel: SourceChannel
    resolution_tree_id: str = ""
    resolution_files: dict[str, bytes] | None = None
    resolution_message: str = ""
    decision: ResolutionDecision = "accept"
    audit_detail: dict = field(default_factory=dict)
    defer_projection: bool = False


@dataclass
class TransactionResult:
    """Result of a committed, rejected, or no-op version transaction."""

    commit_id: str = ""
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)
    changes: list[dict] = field(default_factory=list)
    new_scope_hash: str = ""
    is_noop: bool = False
    merged_changes: list[dict] = field(default_factory=list)
    commit_object: str = ""
    pending_conflict_id: str = ""
    reason: str = ""
