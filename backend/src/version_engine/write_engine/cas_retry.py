"""CAS-retry merge for L5 write convergence.

Writers optimistically compute candidate trees in parallel. If the root/scope
CAS loses, L5 has to merge the caller intent onto the new current tree instead
of blindly retrying the stale candidate. This module owns that convergence
mechanic.
"""

from __future__ import annotations

from src.version_engine.domain.intents import OperationWriteIntent
from src.version_engine.write_engine.conflict_policy import (
    QUEUE_POLICIES,
    merge_file_sets_for_policy,
    select_conflict_policy,
)
from src.version_engine.write_engine.tree_objects import flatten_tree_to_bytes
from src.version_engine.adapters.product.tree_patch import splice_batch
from src.utils.logger import log_info, log_warning


def merge_on_cas_retry(
    *,
    repo,
    intent: OperationWriteIntent,
    scope_norm: str,
    base_scope_hash: str,
    current_scope_hash: str,
    incoming_scope_hash: str,
) -> "tuple[str | None, dict | None, list, str, dict, dict, dict]":
    """Run policy-driven three-way merge after a lost CAS attempt."""

    try:
        base_files = flatten_tree_to_bytes(repo.store, base_scope_hash)
        current_files = flatten_tree_to_bytes(repo.store, current_scope_hash)
        incoming_files = flatten_tree_to_bytes(repo.store, incoming_scope_hash)
    except Exception as exc:
        log_warning(
            f"[cas-retry-merge] failed to load tree files "
            f"(base={base_scope_hash[:8]}, current={current_scope_hash[:8]}, "
            f"incoming={incoming_scope_hash[:8]}): {exc}",
        )
        raise RuntimeError("CAS retry merge could not load tree files") from exc

    touched = sorted(
        (set(current_files) | set(incoming_files))
        - {
            p for p in (set(current_files) & set(incoming_files))
            if current_files.get(p) == incoming_files.get(p)
        }
    )
    if not touched:
        return (None, None, [], "", {}, {}, {})

    if intent.policy_override in QUEUE_POLICIES:
        from src.version_engine.domain.conflicts import ConflictPolicyDecision

        policy = ConflictPolicyDecision(
            policy=intent.policy_override,
            reason=f"op_intent_override:{intent.policy_override}",
        )
    else:
        policy = select_conflict_policy(
            scope_path=scope_norm,
            source_channel=intent.source_channel,
            actor=intent.actor,
            paths=touched,
        )
    merge_result = merge_file_sets_for_policy(
        base_files,
        current_files,
        incoming_files,
        policy=policy,
    )

    ops: list = []
    considered_paths = (
        set(base_files) | set(current_files) | set(incoming_files)
    )
    for path in considered_paths:
        if path in merge_result.merged_files:
            content = merge_result.merged_files[path]
            if content is None:
                ops.append(("rm", path))
            elif current_files.get(path) != content:
                ops.append(("put", path, content))
        elif path in current_files:
            ops.append(("rm", path))

    try:
        merged_tree, _splice_changes = splice_batch(
            repo.store,
            current_scope_hash,
            ops,
        )
    except Exception as exc:
        log_warning(
            f"[cas-retry-merge] splice_batch failed for {len(ops)} ops: {exc}",
        )
        raise RuntimeError("CAS retry merge splice failed") from exc

    audit = {
        "policy": policy.policy,
        "policy_reason": policy.reason,
        "base_scope_hash": base_scope_hash,
        "current_scope_hash": current_scope_hash,
        "auto_merged_paths": [r.path for r in merge_result.auto_merge_records],
        "lww_paths": [r.path for r in merge_result.lww_records],
        "superseded_paths": [
            r.path for r in merge_result.superseded_by_parent
        ],
        "pending_paths": [r.path for r in merge_result.manual_conflicts],
    }
    log_info(
        f"[cas-retry-merge] scope={scope_norm!r} "
        f"auto={len(merge_result.auto_merge_records)} "
        f"lww={len(merge_result.lww_records)} "
        f"pending={len(merge_result.manual_conflicts)} "
        f"superseded={len(merge_result.superseded_by_parent)}",
    )
    return (
        merged_tree,
        audit,
        list(merge_result.manual_conflicts),
        policy.policy,
        base_files,
        current_files,
        incoming_files,
    )
