"""Pure trigger-policy engine for sandbox sync (the brain; no I/O).

Encodes the design's three decisions, as pure functions so they're trivially
unit-tested and shared by both the in-sandbox sidecar and the server:

  1. change → **checkpoint** (cheap, private, revertible) vs **publish**
     (promote to source of truth) — the change-vs-version split (P1).
  2. when an upstream change arrives → **auto-integrate** (paths disjoint from
     the local dirty set, safe) vs **hold + notify** (paths overlap) (P2/P2b).
  3. which managed policy a (persona × client × scope-role) gets — users don't
     configure triggers, we pick a preset.

See docs/proposals/PUP-sync-trigger-architecture-2026-06.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Persona(str, Enum):
    NON_DEV = "non_dev"    # "autopilot": never lose work, never show git, no conflicts
    DEV = "dev"            # "assisted": frequent checkpoints, deliberate publishes
    REVIEWER = "reviewer"  # root/parent owner: changes arrive as proposals


class ClientKind(str, Enum):
    AGENT = "agent"
    VSCODE = "vscode"
    CLI = "cli"
    UNKNOWN = "unknown"


class ScopeRole(str, Enum):
    ROOT = "root"
    SUB = "sub"


class TriggerEvent(str, Enum):
    FILE_CHANGE = "file_change"          # a write landed (drives debounce)
    IDLE = "idle"                        # edits paused ≥ debounce window
    MAX_INTERVAL = "max_interval"        # periodic tick during sustained activity
    QUIESCENCE = "quiescence"            # long idle → publish candidate
    AGENT_DONE = "agent_done"            # explicit "task complete" signal (MCP/CLI)
    EXPLICIT_SAVE = "explicit_save"      # user/agent asked to save/publish
    VERIFICATION_PASS = "verification_pass"  # tests/build green
    CLIENT_CONNECT = "client_connect"
    DISCONNECT = "disconnect"
    PRE_PUBLISH = "pre_publish"          # internal: about to promote → must fetch+rebase


class SyncAction(str, Enum):
    CHECKPOINT = "checkpoint"        # snapshot working tree to the private draft lane
    PUBLISH = "publish"              # promote current checkpoint → a version (SoT)
    FETCH = "fetch"                  # incremental fetch of SoT
    AUTO_INTEGRATE = "auto_integrate"  # silently fast-forward disjoint upstream paths
    HOLD = "hold"                    # defer integration (overlap with dirty set)
    NOTIFY = "notify"                # tell the client upstream advanced
    NONE = "none"


@dataclass(frozen=True)
class SyncPolicyConfig:
    """A managed sync policy. Chosen by PuppyOne via :func:`policy_for`, not by
    the end user. All times in seconds."""

    # checkpoint cadence (the "change" lane)
    checkpoint_debounce_s: float = 4.0       # after edits stop this long → checkpoint
    checkpoint_max_interval_s: float = 60.0  # during sustained edits, ≥ this often

    # publish triggers (the "version" lane) — kept deliberately sparse
    quiescence_publish_s: float = 180.0      # long idle → publish (0 disables)
    publish_on_agent_done: bool = True
    publish_on_explicit: bool = True
    publish_on_verification: bool = False
    publish_on_disconnect: bool = False      # always checkpoint on disconnect; publish only if True

    # upstream integration
    auto_integrate_disjoint: bool = True     # silently ff non-overlapping upstream paths

    # conflict routing — maps to version_engine conflict policy names
    conflict_policy: str = "agent_auto_resolve"

    # fetch behavior
    fetch_on_connect: bool = True
    fetch_before_publish: bool = True        # the one mandatory sync: rebase-before-publish


# ── managed presets (users don't configure; we pick) ──────────────────

_NON_DEV = SyncPolicyConfig(
    checkpoint_debounce_s=3.0,
    checkpoint_max_interval_s=45.0,
    quiescence_publish_s=120.0,      # autopilot: publish a bit eagerly once work settles
    publish_on_agent_done=True,
    publish_on_explicit=True,
    publish_on_verification=False,
    publish_on_disconnect=True,      # don't strand a non-dev's work in a draft
    auto_integrate_disjoint=True,
    conflict_policy="agent_auto_resolve",  # never show git/conflicts to a non-dev
)

_DEV = SyncPolicyConfig(
    checkpoint_debounce_s=5.0,
    checkpoint_max_interval_s=90.0,
    quiescence_publish_s=0.0,        # devs publish deliberately, not on idle
    publish_on_agent_done=True,
    publish_on_explicit=True,
    publish_on_verification=True,    # green tests/build is a natural commit boundary
    publish_on_disconnect=False,     # leave WIP as a draft, don't auto-pollute SoT
    auto_integrate_disjoint=True,
    conflict_policy="agent_review",  # surface for review
)

_REVIEWER = SyncPolicyConfig(
    checkpoint_debounce_s=5.0,
    checkpoint_max_interval_s=120.0,
    quiescence_publish_s=0.0,
    publish_on_agent_done=False,
    publish_on_explicit=True,
    publish_on_verification=False,
    publish_on_disconnect=False,
    auto_integrate_disjoint=False,   # root owner integrates sub-scope changes on their cadence
    conflict_policy="manual_review",
)

_PRESETS = {Persona.NON_DEV: _NON_DEV, Persona.DEV: _DEV, Persona.REVIEWER: _REVIEWER}


def policy_for(
    persona: Persona,
    client_kind: ClientKind = ClientKind.UNKNOWN,
    scope_role: ScopeRole = ScopeRole.SUB,
) -> SyncPolicyConfig:
    """Pick the managed policy for a (persona × client × scope-role).

    A root/parent owner always gets the reviewer policy (sub-scope changes arrive
    as proposals, integrated on their cadence) regardless of declared persona.
    """
    if scope_role is ScopeRole.ROOT and persona is not Persona.DEV:
        return _REVIEWER
    return _PRESETS.get(persona, _DEV)


# ── decision: checkpoint cadence ──────────────────────────────────────

def should_checkpoint(
    policy: SyncPolicyConfig,
    *,
    now: float,
    dirty: bool,
    last_edit_at: float | None,
    last_checkpoint_at: float | None,
) -> bool:
    """True iff a checkpoint should be taken now.

    Two ways to fire: (a) **debounce** — edits paused ≥ debounce window and there
    are uncheckpointed changes; (b) **max-interval** — sustained editing without a
    checkpoint for too long (so a long edit burst is still captured periodically).
    """
    if not dirty:
        return False
    if last_edit_at is not None and now - last_edit_at >= policy.checkpoint_debounce_s:
        return True
    base = last_checkpoint_at if last_checkpoint_at is not None else last_edit_at
    if base is not None and now - base >= policy.checkpoint_max_interval_s:
        return True
    return False


# ── decision: event → actions ─────────────────────────────────────────

def decide_event(
    event: TriggerEvent,
    policy: SyncPolicyConfig,
    *,
    dirty: bool = True,
) -> tuple[SyncAction, ...]:
    """Map a trigger event to ordered sync actions under ``policy``.

    Publishes are gated on there being something to publish (``dirty``) and on the
    policy enabling that publish source — keeping the version lane sparse (P1).
    """
    def _publish_if(enabled: bool) -> tuple[SyncAction, ...]:
        return (SyncAction.PUBLISH,) if (enabled and dirty) else (SyncAction.NONE,)

    if event is TriggerEvent.FILE_CHANGE or event is TriggerEvent.IDLE or event is TriggerEvent.MAX_INTERVAL:
        # cadence events → checkpoint (the actual timing gate is should_checkpoint)
        return (SyncAction.CHECKPOINT,) if dirty else (SyncAction.NONE,)
    if event is TriggerEvent.QUIESCENCE:
        return _publish_if(policy.quiescence_publish_s > 0)
    if event is TriggerEvent.AGENT_DONE:
        return _publish_if(policy.publish_on_agent_done)
    if event is TriggerEvent.EXPLICIT_SAVE:
        # explicit intent publishes even with no detected dirt is pointless; still gate on dirty
        return _publish_if(policy.publish_on_explicit)
    if event is TriggerEvent.VERIFICATION_PASS:
        return _publish_if(policy.publish_on_verification)
    if event is TriggerEvent.CLIENT_CONNECT:
        return (SyncAction.FETCH,) if policy.fetch_on_connect else (SyncAction.NONE,)
    if event is TriggerEvent.DISCONNECT:
        # always capture the work; publish only if the policy says so
        actions: list[SyncAction] = [SyncAction.CHECKPOINT] if dirty else []
        if policy.publish_on_disconnect and dirty:
            actions.append(SyncAction.PUBLISH)
        return tuple(actions) or (SyncAction.NONE,)
    if event is TriggerEvent.PRE_PUBLISH:
        return (SyncAction.FETCH,) if policy.fetch_before_publish else (SyncAction.NONE,)
    return (SyncAction.NONE,)


# ── decision: upstream advance → integrate vs hold ────────────────────

def decide_upstream(
    affected_paths: set[str],
    dirty_paths: set[str],
    policy: SyncPolicyConfig,
) -> tuple[SyncAction, ...]:
    """An upstream version advanced touching ``affected_paths``; the local working
    tree is dirty on ``dirty_paths``. Auto-integrate iff disjoint (safe to
    fast-forward those paths without clobbering in-flight edits); else hold +
    notify and integrate at the next publish/quiescence."""
    if paths_overlap(affected_paths, dirty_paths):
        return (SyncAction.HOLD, SyncAction.NOTIFY)
    if policy.auto_integrate_disjoint:
        return (SyncAction.AUTO_INTEGRATE,)
    return (SyncAction.NOTIFY,)


def paths_overlap(a: set[str], b: set[str]) -> bool:
    """True if any path in ``a`` overlaps any in ``b`` — equal, or one nested
    under the other (a file under a changed dir counts as overlapping)."""
    na = {_norm(p) for p in a}
    nb = {_norm(p) for p in b}
    for x in na:
        for y in nb:
            if x == y or x.startswith(y + "/") or y.startswith(x + "/"):
                return True
    return False


def _norm(p: str) -> str:
    return p.strip().strip("/")
