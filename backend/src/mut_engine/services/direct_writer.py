"""Compatibility wrapper for the old typed-write helper.

The publish authority is
``src.mut_engine.application.transaction_engine.GitNativeTransactionEngine``.
This module remains for older imports/tests that still call
``apply_mutation`` directly; it immediately translates the request into an
``OperationWriteIntent`` so there is no second CAS/history/audit write path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from mut.core.object_store import ObjectStore

from src.mut_engine.application.transaction_engine import (
    ConcurrentMutationError,
    GitNativeTransactionEngine,
)
from src.mut_engine.domain.intents import OperationWriteIntent
from src.mut_engine.server.repo_manager import MutRepoManager


SpliceFn = Callable[[ObjectStore, str], tuple[str, list[tuple[str, str]]]]


@dataclass
class WriteResult:
    commit_id: str = ""
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)
    new_scope_hash: str = ""
    is_noop: bool = False


async def apply_mutation(
    repo_manager: MutRepoManager,
    project_id: str,
    scope_path: str,
    splice: SpliceFn,
    *,
    who: str,
    message: str,
    op_type: str,
    audit_detail: dict | None = None,
    expected_head_commit_id: str | None = None,
    allow_same_tree_commit: bool = False,
    defer_projection: bool = False,
) -> WriteResult:
    """Apply a typed tree splice through the canonical transaction engine."""

    result = await GitNativeTransactionEngine(repo_manager).apply_operation(
        OperationWriteIntent(
            project_id=project_id,
            scope_path=scope_path,
            actor=who,
            source_channel="papi",
            operation_type=op_type,
            message=message,
            audit_detail=audit_detail or {},
            expected_head_commit_id=expected_head_commit_id,
            allow_same_tree_commit=allow_same_tree_commit,
            defer_projection=defer_projection,
        ),
        splice,
    )
    return WriteResult(
        commit_id=result.commit_id,
        status=result.status,
        merged=result.merged,
        conflicts=result.conflicts,
        paths=result.paths,
        new_scope_hash=result.new_scope_hash,
        is_noop=result.is_noop,
    )


__all__ = [
    "ConcurrentMutationError",
    "SpliceFn",
    "WriteResult",
    "apply_mutation",
]
