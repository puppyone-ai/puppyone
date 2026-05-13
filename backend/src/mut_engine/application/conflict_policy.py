"""Conflict policy and conservative server-side merge helpers."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from mut.core.merge import (
    ConflictRecord,
    IdenticalStrategy,
    JsonMergeStrategy,
    LineMergeStrategy,
    OneSideOnlyStrategy,
)

from src.mut_engine.domain.conflicts import (
    ConflictPolicyConfig,
    ConflictPolicyDecision,
)


@dataclass
class PolicyMergeResult:
    merged_files: dict[str, bytes]
    auto_merge_records: list[ConflictRecord]
    manual_conflicts: list[ConflictRecord]


_SAFE_CONTENT_STRATEGIES = [
    IdenticalStrategy(),
    OneSideOnlyStrategy(),
    JsonMergeStrategy(),
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
    """Select the conflict policy for V1.

    Policy rules are intentionally shaped here, but V1 only activates the
    conservative manual-review default. The configuration must come from the
    PuppyOne control plane/admin surface, never from mutable repo content.
    """

    _ = (scope_path, source_channel, actor, paths)
    cfg = config or ConflictPolicyConfig()
    return ConflictPolicyDecision(
        policy=cfg.default_policy,
        reason="default_manual_review",
    )


def merge_file_sets_for_manual_review(
    base_files: dict[str, bytes],
    current_files: dict[str, bytes],
    incoming_files: dict[str, bytes],
) -> PolicyMergeResult:
    """Merge file sets without using LWW as an implicit fallback.

    Safe deterministic merges still publish:
    - same content;
    - one side changed;
    - JSON different-key merge with no unsafe key conflict;
    - line merge with non-overlapping hunks.

    Anything that would require choosing a winner becomes a manual conflict.
    """

    merged: dict[str, bytes] = {}
    auto_records: list[ConflictRecord] = []
    manual_conflicts: list[ConflictRecord] = []

    for path in sorted(set(base_files) | set(current_files) | set(incoming_files)):
        base_present = path in base_files
        base = base_files.get(path, b"")
        ours = current_files.get(path)
        theirs = incoming_files.get(path)

        if ours is None and theirs is None:
            continue

        if ours is None:
            if base_present and theirs != base:
                manual_conflicts.append(ConflictRecord(
                    path=path,
                    strategy="delete_modify",
                    detail="server deleted, incoming modified; manual review required",
                    kept="pending",
                ))
            elif theirs is not None:
                merged[path] = theirs
            continue

        if theirs is None:
            if base_present and ours != base:
                manual_conflicts.append(ConflictRecord(
                    path=path,
                    strategy="modify_delete",
                    detail="incoming deleted, server modified; manual review required",
                    kept="pending",
                ))
                merged[path] = ours
            elif ours is not None:
                merged[path] = ours
            continue

        result = _try_safe_content_merge(base, ours, theirs, path)
        if result is None:
            manual_conflicts.append(ConflictRecord(
                path=path,
                strategy="manual_review",
                detail="both sides modified; manual review required",
                kept="pending",
            ))
            merged[path] = ours
            continue

        content, records, unsafe_records = result
        if unsafe_records:
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
                for record in unsafe_records
            ])
            merged[path] = ours
            continue

        merged[path] = content
        auto_records.extend(records)

    return PolicyMergeResult(
        merged_files=merged,
        auto_merge_records=auto_records,
        manual_conflicts=manual_conflicts,
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
        unsafe = [
            record for record in result.conflicts
            if record.strategy not in {"line_merge"}
        ]
        return result.content, result.conflicts, unsafe
    return None
