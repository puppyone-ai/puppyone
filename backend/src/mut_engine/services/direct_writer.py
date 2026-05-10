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
from mut.foundation.git_format import encode_commit

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


# ── Commit object construction ──────────────────────
#
# Pre-git-format-storage we used ``mut.server.history.compute_commit_id``,
# a deterministic 16-hex SHA-256 of (scope, hash, time, who). The new
# mut wire contract (commit ``3b81887`` on branch ``feat/git-format-storage``)
# replaces that with a real git commit object whose SHA-1 IS the commit_id.
# The same shape lives in ``mut.server.handlers._make_commit``; we
# inline the logic here rather than importing a private symbol to keep
# the dependency surface explicit.

def _format_git_time(created_at_iso: str) -> tuple[str, str]:
    """Convert ISO 8601 → ``("<unix_seconds>", "<+HHMM>")``.

    Falls back to "now / +0000" on parse error so a malformed input
    can't take down the write path.
    """
    try:
        dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = int(dt.timestamp())
    offset = dt.utcoffset()
    if offset is None:
        return str(ts), "+0000"
    secs = int(offset.total_seconds())
    sign = "+" if secs >= 0 else "-"
    secs = abs(secs)
    return str(ts), f"{sign}{secs // 3600:02d}{(secs % 3600) // 60:02d}"


def _identity_for_git(who: str) -> str:
    """Wrap a bare agent id in git's ``<email>`` shape so the commit
    object passes ``git fsck`` cleanly.

    Match what the remote ``mut/`` server-side helper does (see
    ``mut.server.handlers._make_commit`` on branch
    ``feat/git-format-storage``).
    """
    identity = (who or "anonymous").strip()
    if "<" in identity:
        return identity
    slug = identity.replace(" ", "-").lower() or "anonymous"
    return f"{identity} <{slug}@puppyone>"


def _build_git_commit(
    repo,
    *,
    tree_sha: str,
    parent_sha: str,
    who: str,
    message: str,
    created_at_iso: str,
) -> str:
    """Build a real git commit object pointing at *tree_sha* (with
    *parent_sha* if non-empty), store it in the project's ObjectStore,
    and return its SHA-1 hex (the new ``commit_id``).

    The commit object lives in S3 alongside blobs and trees — pulled
    by clients in clone/pull responses so ``refs/remotes/origin/main``
    on the client side resolves to a present object.
    """
    ts, tz = _format_git_time(created_at_iso)
    identity = _identity_for_git(who)
    commit_body = encode_commit(
        tree_sha1=tree_sha,
        parent_sha1=parent_sha or None,
        author=identity,
        author_time=f"{ts} {tz}",
        committer=identity,
        committer_time=f"{ts} {tz}",
        message=message or "(no message)",
    )
    return repo.store.put_commit(commit_body)


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
    started_ms: int,
) -> WriteResult:
    repo = repo_manager.get_server_repo(project_id)
    scope_norm = (scope_path or "").strip("/")

    last_error: Exception | None = None
    for attempt in range(_MAX_CAS_ATTEMPTS):
        old_scope_hash = repo.get_scope_hash(scope_norm) or ""

        # Run the pure splice on a worker thread (the splice may do
        # synchronous S3 reads via ``repo.store`` — S3StorageBackend's
        # in-memory LRU cache absorbs the second-and-later reads).
        new_scope_hash, changes = await asyncio.to_thread(
            splice, repo.store, old_scope_hash,
        )

        if not changes or new_scope_hash == old_scope_hash:
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
        # Parent commit comes from the scope's current head — mirrors
        # what ``mut.server.handlers._push_cas_attempt`` does so the
        # commit DAG on the client side is linear and connected.
        parent_sha = await asyncio.to_thread(
            repo.get_scope_head_commit_id, scope_norm,
        ) or ""

        new_commit_id = await asyncio.to_thread(
            _build_git_commit,
            repo,
            tree_sha=new_scope_hash,
            parent_sha=parent_sha,
            who=who,
            message=message,
            created_at_iso=created_at_iso,
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
