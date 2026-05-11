"""direct_writer — orchestrate a typed tree mutation end-to-end.

This module is the bridge between the pure tree primitives in
``tree_splice`` and PuppyOne's persisted state (Supabase + S3). For each
typed write op (``write_file``, ``delete``, ``mkdir``, ``move``, …)
the caller hands us a ``SpliceFn`` and we:

1. Hold a per-(project, scope) async lock to serialise concurrent
   writers and avoid CAS thrashing.
2. Read current ``scope_hash`` + ``head_commit_id`` from the DB.
3. Run the splice synchronously on a worker thread — it consults
   ``repo.store`` (S3-backed, with the in-memory LRU cache) and
   writes new content-addressed objects.
4. If the splice returned the same root (idempotent no-op), return
   early — no commit, no audit pollution.
5. Compute a deterministic ``commit_id``.
6. CAS-update ``scope_hash`` + ``head_commit_id`` in one DB call.
7. Record history (``mut_commits``) + audit (``audit_logs``) using
   the typed ``op_type`` so the trail says exactly what happened
   ("write_file foo.md") instead of the generic "push".
8. Run the post-push graft hook to refresh ``mut_root_hash``.

CAS retry: if step 6 loses the race against a concurrent commit,
the loop re-reads ``scope_hash`` and re-runs the splice on top of
the new state. This is safe because splices are pure and content
addressing means previously written objects are reused for free.

This replaces the ``MutOps._do_push`` / ``MutEphemeralClient.push``
path for INTERNAL writes. External CLI / sync clients still use the
MUT protocol via ``/api/v1/mut/*`` — that path keeps its 3-way merge
because the assumptions are different (long-lived clients with
potentially divergent local state).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable

from mut.core.object_store import ObjectStore
from mut.server.history import compute_commit_id

from src.mut_engine.server.repo_manager import MutRepoManager
from src.utils.logger import log_error, log_info, log_warning

# ── Public types ──────────────────────────────────────

# Each splice produces ``(new_root_hash, changes)``. ``changes`` is a list
# of ``(action, rel_path)`` from ``tree_splice``.
SpliceFn = Callable[[ObjectStore, str], "tuple[str, list[tuple[str, str]]]"]


@dataclass
class WriteResult:
    commit_id: str = ""
    status: str = "ok"
    merged: bool = False
    conflicts: int = 0
    paths: list[str] = field(default_factory=list)
    new_scope_hash: str = ""
    is_noop: bool = False


class ConcurrentMutationError(RuntimeError):
    """Raised when a caller supplied a stale scope head precondition."""

    def __init__(
        self,
        *,
        scope_path: str,
        expected_head_commit_id: str,
        current_head_commit_id: str,
    ):
        self.scope_path = scope_path
        self.expected_head_commit_id = expected_head_commit_id
        self.current_head_commit_id = current_head_commit_id
        super().__init__(
            "Scope changed since the command started. Pull the latest state "
            "or use the MUT merge workflow (`mut pull`, resolve if needed, "
            "then `mut commit` and `mut push`)."
        )


# ── Concurrency: per-(project, scope) async lock cache ─────────


class _ScopeLockRegistry:
    """Process-wide cache of asyncio.Lock keyed by (project_id, scope_path).

    Serializing writes to the same scope at the application layer is a
    cheap optimization on top of CAS: if 10 concurrent saves hit the
    same scope, having them queue here means we do 10 sequential
    splices instead of 10 splices that CAS-fail and retry. CAS still
    runs as the final correctness check — the lock is purely for
    throughput.

    The lock dict itself is guarded by a sync lock so we can lazily
    create entries from any coroutine without races. We never evict
    entries; their footprint is tiny (~one ``asyncio.Lock`` per active
    scope) and a long-lived backend tends to write to the same scopes
    repeatedly.
    """

    def __init__(self):
        import threading

        self._dict_lock = threading.Lock()
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    def get(self, project_id: str, scope_path: str) -> asyncio.Lock:
        key = (project_id, scope_path or "")
        with self._dict_lock:
            lk = self._locks.get(key)
            if lk is None:
                lk = asyncio.Lock()
                self._locks[key] = lk
            return lk


_locks = _ScopeLockRegistry()


# ── CAS retry tuning ──────────────────────────────────

_MAX_CAS_ATTEMPTS = 5

# Hook to run the global root graft after a successful commit. Imported
# lazily inside ``apply_mutation`` to avoid a circular import.
HookFn = Callable[[], Awaitable[None] | None]


# ── Core orchestrator ─────────────────────────────────


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
) -> WriteResult:
    """Apply a tree-splice mutation atomically.

    Args:
        repo_manager: source for ``PuppyOneServerRepo`` instances.
        project_id: which project to write to.
        scope_path: which scope to write into. Empty string = root scope.
        splice: callable taking ``(store, root_hash)`` and returning
            ``(new_root, changes)``. Should be a closure over the
            specific paths/content being mutated.
        who: agent id for audit (``user:<uuid>`` for web UI).
        message: human-readable commit message.
        op_type: typed op name for the audit trail (e.g.
            ``"write_file"``, ``"move"``, ``"delete"``).
        audit_detail: extra fields merged into the audit record.

    Returns:
        ``WriteResult`` with ``commit_id`` (empty if the mutation was a
        no-op), ``new_scope_hash``, ``is_noop``, and the affected
        ``paths`` (full project-root paths, not scope-relative).

    Raises:
        ``RuntimeError`` if CAS still fails after ``_MAX_CAS_ATTEMPTS``
        retries — indicates persistent contention or a bug in the
        retry loop.
    """
    started_ms = int(time.time() * 1000)
    log_info(
        f"[direct_writer][{op_type}] start project={project_id} "
        f"scope={scope_path!r} who={who}",
    )

    lock = _locks.get(project_id, scope_path or "")
    async with lock:
        return await _apply_under_lock(
            repo_manager=repo_manager,
            project_id=project_id,
            scope_path=scope_path,
            splice=splice,
            who=who,
            message=message,
            op_type=op_type,
            audit_detail=audit_detail or {},
            expected_head_commit_id=expected_head_commit_id,
            allow_same_tree_commit=allow_same_tree_commit,
            started_ms=started_ms,
        )


async def _apply_under_lock(
    *,
    repo_manager: MutRepoManager,
    project_id: str,
    scope_path: str,
    splice: SpliceFn,
    who: str,
    message: str,
    op_type: str,
    audit_detail: dict,
    expected_head_commit_id: str | None,
    allow_same_tree_commit: bool,
    started_ms: int,
) -> WriteResult:
    repo = repo_manager.get_server_repo(project_id)
    scope_norm = (scope_path or "").strip("/")

    last_error: Exception | None = None
    for attempt in range(_MAX_CAS_ATTEMPTS):
        old_scope_hash = repo.get_scope_hash(scope_norm) or ""
        current_head_commit_id = repo.get_scope_head_commit_id(scope_norm) or ""
        if (
            expected_head_commit_id is not None
            and current_head_commit_id != expected_head_commit_id
        ):
            raise ConcurrentMutationError(
                scope_path=scope_norm,
                expected_head_commit_id=expected_head_commit_id,
                current_head_commit_id=current_head_commit_id,
            )

        # Run the pure splice on a worker thread (the splice may do
        # synchronous S3 reads via ``repo.store`` — S3StorageBackend's
        # in-memory LRU cache absorbs the second-and-later reads).
        new_scope_hash, changes = await asyncio.to_thread(
            splice, repo.store, old_scope_hash,
        )

        if not changes or (new_scope_hash == old_scope_hash and not allow_same_tree_commit):
            elapsed = int(time.time() * 1000) - started_ms
            log_info(
                f"[direct_writer][{op_type}] noop "
                f"(content unchanged) project={project_id} "
                f"scope={scope_path!r} elapsed={elapsed}ms",
            )
            return WriteResult(
                status="ok",
                is_noop=True,
                new_scope_hash=old_scope_hash,
            )

        created_at_iso = datetime.now(timezone.utc).isoformat(
            timespec="microseconds",
        )
        new_commit_id = compute_commit_id(
            scope_path=scope_norm,
            scope_hash=new_scope_hash,
            created_at_iso=created_at_iso,
            who=who,
        )

        cas_ok = await asyncio.to_thread(
            repo.cas_update_scope,
            scope_norm,
            old_scope_hash,
            new_scope_hash,
            new_commit_id,
        )
        if not cas_ok:
            log_info(
                f"[direct_writer][{op_type}] CAS lost "
                f"(attempt {attempt + 1}/{_MAX_CAS_ATTEMPTS}) "
                f"project={project_id} scope={scope_path!r} — retrying",
            )
            continue

        full_changes = _build_full_changes(scope_norm, changes)

        # History: persist the typed op-aware changeset. We record
        # synchronously on a worker thread — failure to record
        # history is a hard error because losing it leaves a commit
        # with no audit trail.
        try:
            await asyncio.to_thread(
                repo.record_history,
                new_commit_id,
                who,
                message,
                scope_norm,
                full_changes,
                None,                # conflicts
                new_scope_hash,      # scope_hash
                "",                  # root_hash (graft hook fills this in)
                created_at_iso,
            )
            await asyncio.to_thread(repo.set_head_commit_id, new_commit_id)
        except Exception as e:
            last_error = e
            log_error(
                f"[direct_writer][{op_type}] record_history failed "
                f"after CAS success: {e}",
            )
            raise

        # Audit: best-effort. The commit is persisted regardless.
        try:
            audit = {
                "scope": scope_norm,
                "commit_id": new_commit_id,
                "scope_hash": new_scope_hash,
                "cas_attempts": attempt + 1,
                "changes": len(full_changes),
                **audit_detail,
            }
            await asyncio.to_thread(
                repo.record_audit, op_type, who, audit,
            )
        except Exception as e:
            log_warning(
                f"[direct_writer][{op_type}] record_audit failed "
                f"(non-fatal): {e}",
            )

        # Graft hook: rebuild ``mut_root_hash`` from DB scope state.
        # We synthesise the same dict shape ``run_post_push_hook``
        # expects from MUT's ``handle_push`` so we can reuse the
        # existing implementation unchanged.
        try:
            from src.mut_engine.services.hooks import run_post_push_hook

            push_result = {
                "status": "ok",
                "commit_id": new_commit_id,
                "root": new_scope_hash,
                "merged": False,
                "conflicts": 0,
            }
            await asyncio.to_thread(
                run_post_push_hook,
                project_id,
                repo_manager,
                push_result,
            )
        except Exception as e:
            log_error(
                f"[direct_writer][{op_type}] post-push graft hook failed "
                f"(commit landed but root_hash may lag): {e}",
            )

        elapsed = int(time.time() * 1000) - started_ms
        log_info(
            f"[direct_writer][{op_type}] done commit={new_commit_id[:12]} "
            f"new_scope_hash={new_scope_hash[:12]} "
            f"changes={len(full_changes)} "
            f"cas_attempts={attempt + 1} elapsed={elapsed}ms",
        )

        return WriteResult(
            commit_id=new_commit_id,
            status="ok",
            merged=False,
            conflicts=0,
            paths=[c["path"] for c in full_changes],
            new_scope_hash=new_scope_hash,
            is_noop=False,
        )

    raise RuntimeError(
        f"[direct_writer][{op_type}] CAS still failing after "
        f"{_MAX_CAS_ATTEMPTS} attempts (project={project_id}, "
        f"scope={scope_path!r}); last error: {last_error}",
    )


def _build_full_changes(
    scope_path: str,
    changes: list[tuple[str, str]],
) -> list[dict]:
    """Convert splice-output ``(action, rel_path)`` tuples to history-entry
    dicts with full project-root paths.

    The MUT history schema stores ``[{"path": full, "action": "..."}]``
    where ``full`` includes the scope prefix. We add the prefix here so
    the audit trail matches what users see in the UI.
    """
    scope_norm = (scope_path or "").strip("/")
    out: list[dict] = []
    for action, rel in changes:
        rel_norm = rel.strip("/")
        full = f"{scope_norm}/{rel_norm}" if scope_norm else rel_norm
        out.append({"path": full, "action": action})
    return out
