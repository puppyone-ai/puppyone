"""Conflict policy selection and server-side merge helpers.

V1 policy stack (per docs/architecture/07-version-engine-supplement.md §7):

  1. Safe deterministic auto-merge runs first
     (identical / one-side / JSON different keys / non-overlapping line hunks).
  2. Parent-scope-wins resolves cross-scope same-path overlaps. The parent
     scope's content stays; the child scope's write is audited but dropped
     from the merged file set.
  3. The configured default policy applies to the remaining unsafe
     conflicts. The shipped default is ``last_write_wins``;
     ``manual_review`` and the future agent policies are opt-in.
"""

from __future__ import annotations

import fnmatch
from dataclasses import asdict, dataclass

from src.mut_engine.application.hash_utils import hash_bytes
from src.mut_engine.application.merge import (
    AppendOnlyMergeStrategy,
    ConflictRecord,
    IdenticalStrategy,
    ImportMergeStrategy,
    JsonMergeStrategy,
    LineMergeStrategy,
    OneSideOnlyStrategy,
)
from src.mut_engine.application.path_utils import normalize_path
from src.mut_engine.domain.conflicts import (
    ConflictPolicyConfig,
    ConflictPolicyDecision,
    ConflictPolicyRule,
)


@dataclass
class PolicyMergeResult:
    merged_files: dict[str, bytes]
    auto_merge_records: list[ConflictRecord]
    manual_conflicts: list[ConflictRecord]
    lww_records: list[ConflictRecord]
    superseded_by_parent: list[ConflictRecord]


_SAFE_CONTENT_STRATEGIES = [
    IdenticalStrategy(),
    OneSideOnlyStrategy(),
    JsonMergeStrategy(),
    ImportMergeStrategy(),
    AppendOnlyMergeStrategy(),
    LineMergeStrategy(),
]


def select_conflict_policy(
    *,
    config: ConflictPolicyConfig | None = None,
    scope_path: str = "",
    source_channel: str = "",
    actor: str = "",
    paths: list[str] | None = None,
) -> ConflictPolicyDecision:
    """Pick the conflict policy for a transaction.

    Rule precedence: the first rule that matches every populated dimension
    wins. An empty dimension on a rule is treated as a wildcard. Path-glob
    rules are checked against each affected path; if any path matches, the
    rule applies.
    """

    cfg = config or ConflictPolicyConfig()
    scope_norm = normalize_path(scope_path)
    actor_kind = _actor_kind(actor)
    candidate_paths = paths or []

    for rule in cfg.rules:
        if not _rule_scope_matches(rule, scope_norm):
            continue
        if rule.actor_type and rule.actor_type != actor_kind:
            continue
        if rule.source_channel and rule.source_channel != source_channel:
            continue
        if rule.path_glob and not _any_path_matches(rule.path_glob, candidate_paths):
            continue
        return ConflictPolicyDecision(
            policy=rule.policy,
            reason=f"rule_match:{rule.policy}",
            resolver=dict(rule.resolver),
        )

    return ConflictPolicyDecision(
        policy=cfg.default_policy,
        reason=f"default:{cfg.default_policy}",
    )


def merge_file_sets_for_policy(
    base_files: dict[str, bytes],
    current_files: dict[str, bytes],
    incoming_files: dict[str, bytes],
    *,
    policy: ConflictPolicyDecision,
    parent_scope_files: dict[str, bytes] | None = None,
) -> PolicyMergeResult:
    """Merge file sets under V1 policy.

    Steps per file:
      1. safe deterministic merge (identical / one-side / JSON / line).
      2. parent-scope-wins: if ``parent_scope_files`` carries the same path
         and the parent content differs from both sides, the parent wins
         and the loser is recorded as ``superseded_by_parent``.
      3. otherwise apply the configured policy (LWW or manual_review).
    """

    merged: dict[str, bytes] = {}
    auto_records: list[ConflictRecord] = []
    manual_conflicts: list[ConflictRecord] = []
    lww_records: list[ConflictRecord] = []
    superseded: list[ConflictRecord] = []

    parent_scope_files = parent_scope_files or {}

    for path in sorted(set(base_files) | set(current_files) | set(incoming_files)):
        base_present = path in base_files
        base = base_files.get(path, b"")
        ours = current_files.get(path)
        theirs = incoming_files.get(path)

        if ours is None and theirs is None:
            continue

        # Modify/delete & delete/modify shapes never run through the
        # content-merge strategies; route them to the policy directly.
        if ours is None:
            if base_present and theirs != base:
                _resolve_delete_modify(
                    path, theirs, policy, manual_conflicts,
                    lww_records, merged,
                )
            elif theirs is not None:
                merged[path] = theirs
            continue

        if theirs is None:
            if base_present and ours != base:
                _resolve_modify_delete(
                    path, ours, policy, manual_conflicts,
                    lww_records, merged,
                )
            elif ours is not None:
                merged[path] = ours
            continue

        # Parent-scope-wins override: when the same path is owned by a
        # parent scope and the parent content differs from both sides,
        # the parent wins regardless of policy.
        parent_content = parent_scope_files.get(path)
        if (
            parent_content is not None
            and parent_content != ours
            and parent_content != theirs
        ):
            merged[path] = parent_content
            superseded.append(ConflictRecord(
                path=path,
                strategy="superseded_by_parent",
                detail="parent scope owns this path; child writes deferred",
                kept="parent",
                lost_content=theirs.decode(errors="replace")[:500],
                lost_hash=hash_bytes(theirs),
            ))
            continue

        result = _try_safe_content_merge(base, ours, theirs, path)
        if result is None:
            _apply_policy_to_unsafe_conflict(
                path, ours, theirs, policy,
                manual_conflicts, lww_records, merged,
            )
            continue

        content, records, unsafe_records = result
        if unsafe_records:
            _apply_policy_to_unsafe_conflict(
                path, ours, theirs, policy,
                manual_conflicts, lww_records, merged,
                unsafe_detail=unsafe_records,
            )
            continue

        merged[path] = content
        auto_records.extend(records)

    return PolicyMergeResult(
        merged_files=merged,
        auto_merge_records=auto_records,
        manual_conflicts=manual_conflicts,
        lww_records=lww_records,
        superseded_by_parent=superseded,
    )


# Back-compat shim — older callers import the legacy name.
def merge_file_sets_for_manual_review(
    base_files: dict[str, bytes],
    current_files: dict[str, bytes],
    incoming_files: dict[str, bytes],
) -> PolicyMergeResult:
    return merge_file_sets_for_policy(
        base_files, current_files, incoming_files,
        policy=ConflictPolicyDecision(
            policy="manual_review", reason="legacy_caller",
        ),
    )


def conflict_to_dict(conflict: ConflictRecord) -> dict:
    try:
        return asdict(conflict)
    except TypeError:
        return {
            "path": getattr(conflict, "path", ""),
            "strategy": getattr(conflict, "strategy", ""),
            "detail": getattr(conflict, "detail", ""),
            "kept": getattr(conflict, "kept", ""),
            "lost_content": getattr(conflict, "lost_content", ""),
            "lost_hash": getattr(conflict, "lost_hash", ""),
        }


# ── internal helpers ─────────────────────────────────────────────


def _try_safe_content_merge(
    base: bytes,
    ours: bytes,
    theirs: bytes,
    path: str,
) -> tuple[bytes, list[ConflictRecord], list[ConflictRecord]] | None:
    for strategy in _SAFE_CONTENT_STRATEGIES:
        result = strategy.try_merge(base, ours, theirs, path)
        if result is None:
            continue
        # Records emitted by these strategies are audit-only — the merge
        # actually combined both sides successfully, so they should not
        # trigger the unsafe-fallback path.
        unsafe = [
            record for record in result.conflicts
            if record.strategy not in {
                "line_merge",
                "import_merge",
                "append_only_merge",
            }
        ]
        return result.content, result.conflicts, unsafe
    return None


def _apply_policy_to_unsafe_conflict(
    path: str,
    ours: bytes,
    theirs: bytes,
    policy: ConflictPolicyDecision,
    manual_conflicts: list[ConflictRecord],
    lww_records: list[ConflictRecord],
    merged: dict[str, bytes],
    *,
    unsafe_detail: list[ConflictRecord] | None = None,
) -> None:
    if policy.policy == "manual_review":
        if unsafe_detail:
            manual_conflicts.extend([
                ConflictRecord(
                    path=record.path,
                    strategy="manual_review",
                    detail=(
                        f"unsafe automatic strategy {record.strategy!r} "
                        f"requires manual review: {record.detail}"
                    ),
                    kept="pending",
                    lost_content=record.lost_content,
                    lost_hash=record.lost_hash,
                )
                for record in unsafe_detail
            ])
        else:
            manual_conflicts.append(ConflictRecord(
                path=path,
                strategy="manual_review",
                detail="both sides modified; manual review required",
                kept="pending",
            ))
        merged[path] = ours
        return

    # last_write_wins / reject / agent_*: take incoming and audit the loss.
    if policy.policy == "reject":
        manual_conflicts.append(ConflictRecord(
            path=path,
            strategy="rejected",
            detail="policy rejected this conflict",
            kept="rejected",
        ))
        merged[path] = ours
        return

    # Default last_write_wins. Before falling back to a silent overwrite,
    # try Git-style conflict markers for text files so the loser's content
    # survives in-tree (visible in the next pull / diff) rather than only
    # in the audit row's truncated ``lost_content`` field.
    marker_content = _try_conflict_markers(ours, theirs)
    if marker_content is not None:
        lww_records.append(ConflictRecord(
            path=path,
            strategy="conflict_markers",
            detail=(
                f"both sides modified; {policy.policy} → conflict markers "
                f"written so neither side is silently lost"
            ),
            kept="markers",
            lost_content="",
            lost_hash="",
        ))
        merged[path] = marker_content
        return

    lww_records.append(ConflictRecord(
        path=path,
        strategy="lww",
        detail=(
            f"both sides modified; {policy.policy} → incoming wins, "
            f"server copy preserved in audit (binary or oversize text)"
        ),
        kept="theirs",
        lost_content=ours.decode(errors="replace")[:500],
        lost_hash=hash_bytes(ours),
    ))
    merged[path] = theirs


# Threshold beyond which conflict markers stop being useful — a user
# can't review a 1MB diff inline. For those paths we keep the legacy
# LWW so the tree doesn't balloon by 2x.
_MARKER_MAX_BYTES = 200_000


def _try_conflict_markers(ours: bytes, theirs: bytes) -> bytes | None:
    """Produce Git-style conflict markers for text files.

    Returns ``None`` for binary content (not UTF-8 decodable) or content
    over ``_MARKER_MAX_BYTES`` — those still go through legacy LWW.
    """

    if len(ours) > _MARKER_MAX_BYTES or len(theirs) > _MARKER_MAX_BYTES:
        return None
    try:
        ours.decode("utf-8")
        theirs.decode("utf-8")
    except UnicodeDecodeError:
        return None
    parts: list[bytes] = []
    parts.append(b"<<<<<<< current (server)\n")
    parts.append(ours)
    if not ours.endswith(b"\n"):
        parts.append(b"\n")
    parts.append(b"=======\n")
    parts.append(theirs)
    if not theirs.endswith(b"\n"):
        parts.append(b"\n")
    parts.append(b">>>>>>> incoming\n")
    return b"".join(parts)


def _resolve_delete_modify(
    path: str,
    theirs: bytes,
    policy: ConflictPolicyDecision,
    manual_conflicts: list[ConflictRecord],
    lww_records: list[ConflictRecord],
    merged: dict[str, bytes],
) -> None:
    if policy.policy == "manual_review":
        manual_conflicts.append(ConflictRecord(
            path=path,
            strategy="delete_modify",
            detail="server deleted, incoming modified; manual review required",
            kept="pending",
        ))
        return
    lww_records.append(ConflictRecord(
        path=path,
        strategy="lww",
        detail="server deleted, incoming modified; LWW keeps incoming",
        kept="theirs",
    ))
    merged[path] = theirs


def _resolve_modify_delete(
    path: str,
    ours: bytes,
    policy: ConflictPolicyDecision,
    manual_conflicts: list[ConflictRecord],
    lww_records: list[ConflictRecord],
    merged: dict[str, bytes],
) -> None:
    if policy.policy == "manual_review":
        manual_conflicts.append(ConflictRecord(
            path=path,
            strategy="modify_delete",
            detail="incoming deleted, server modified; manual review required",
            kept="pending",
        ))
        merged[path] = ours
        return
    # LWW: incoming wins → the file ends up deleted.
    lww_records.append(ConflictRecord(
        path=path,
        strategy="lww",
        detail="incoming deleted, server modified; LWW honors deletion",
        kept="theirs",
        lost_content=ours.decode(errors="replace")[:500],
        lost_hash=hash_bytes(ours),
    ))
    # explicit no-op: leave path out of ``merged``.


def _rule_scope_matches(rule: ConflictPolicyRule, scope_norm: str) -> bool:
    if not rule.scope_path:
        return True
    rule_scope = normalize_path(rule.scope_path)
    if scope_norm == rule_scope:
        return True
    if rule_scope == "":
        return True
    return scope_norm.startswith(rule_scope + "/")


def _any_path_matches(glob: str, paths: list[str]) -> bool:
    return any(fnmatch.fnmatch(p, glob) for p in paths)


def _actor_kind(actor: str) -> str:
    if not actor:
        return ""
    if actor.startswith("agent:"):
        return "agent"
    if actor.startswith("sync:"):
        return "sync"
    if actor.startswith("user:"):
        return "user"
    if actor.startswith("scope:"):
        return "scope"
    return "system"
