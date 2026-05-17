"""Durable repair loop for Git-native version post-commit side effects.

Two event types travel through ``mut_version_outbox`` today:

  ``version_committed``        the SQL ``publish_mut_scope_update`` RPC
                               always enqueues one per accepted write;
                               the worker replays projection / graft /
                               notification work as a durable fallback
                               when the synchronous post-commit hook
                               failed or never ran.

  ``pending_conflict_created`` enqueued by
                               ``_record_pending_conflict_row`` when an
                               unsafe conflict needs human / hosted-agent
                               review. The worker hands these to a
                               resolver-dispatch callback (B13). The
                               default callback is a no-op + structured
                               log line; production wires in a real
                               agent worker.

Unknown event types are logged and marked complete so the queue does
not get jammed by a single bad row. Each row's failure increments
``attempts`` and re-claims after the configured back-off; rows that
exceed ``attempts >= 25`` stop being claimed (see the
``claim_mut_version_outbox_batch`` RPC).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.dependencies import get_repo_manager_standalone
from src.mut_engine.services.hooks import (
    run_post_project_update_hook,
    run_post_push_hook,
)
from src.utils.logger import log_error, log_info, log_warning


PendingConflictHook = Callable[[dict[str, Any]], None]
_pending_conflict_hook: PendingConflictHook | None = None


def register_pending_conflict_hook(hook: PendingConflictHook | None) -> None:
    """Set (or clear) the dispatch callback for ``pending_conflict_created``.

    The hook receives the full outbox row (``project_id``, ``payload``,
    ``attempts``, ``event_type``, ``commit_id``, ``id``). It runs inside
    the outbox claim loop, so a slow hook delays other rows — agent
    work that needs more than a couple of seconds should hand the
    payload off to a task queue and return immediately.

    Passing ``None`` reverts to the built-in no-op log handler.
    """

    global _pending_conflict_hook
    _pending_conflict_hook = hook


def process_version_outbox_batch(
    *,
    repo_manager=None,
    client=None,
    limit: int | None = None,
) -> int:
    """Claim a batch of outbox rows, dispatch by event_type, mark each
    row complete or failed."""

    if not settings.MUT_VERSION_OUTBOX_ENABLED:
        return 0

    db = client or SupabaseClient().client
    repos = repo_manager or get_repo_manager_standalone()
    rows = _claim_rows(db, limit or settings.MUT_VERSION_OUTBOX_BATCH_SIZE)
    processed = 0

    for row in rows:
        row_id = row.get("id")
        payload = row.get("payload") or {}
        event_type = row.get("event_type") or payload.get("event_type") or "version_committed"
        try:
            _dispatch_row(event_type, row, repos)
            _complete_row(db, row_id)
            processed += 1
        except Exception as exc:
            _fail_row(db, row_id, str(exc))
            log_warning(
                f"[version-outbox] failed row {row_id} "
                f"event={event_type!r}: {exc}",
            )

    if processed:
        log_info(f"[version-outbox] processed {processed} rows")
    return processed


def _dispatch_row(event_type: str, row: dict[str, Any], repos) -> None:
    """Run the per-event handler. Unknown events are logged and skipped."""

    if event_type == "version_committed":
        payload = row.get("payload") or {}
        run_post_push_hook(
            row["project_id"],
            repos,
            {
                "status": "ok",
                "commit_id": row.get("commit_id", ""),
                "root": payload.get("scope_hash", ""),
                "merged": bool(payload.get("merged", False)),
                "conflicts": int(payload.get("conflicts") or 0),
            },
            raise_errors=True,
        )
        return

    if event_type == "project_version_committed":
        payload = row.get("payload") or {}
        hook_root = (
            payload.get("project_root_hash")
            or payload.get("root_hash")
            or payload.get("scope_hash", "")
        )
        run_post_project_update_hook(
            row["project_id"],
            repos,
            {
                "status": "ok",
                "commit_id": row.get("commit_id", ""),
                "root": hook_root,
                "merged": bool(payload.get("merged", False)),
                "conflicts": int(payload.get("conflicts") or 0),
            },
            raise_errors=True,
        )
        return

    if event_type == "pending_conflict_created":
        _handle_pending_conflict(row)
        return

    log_warning(
        f"[version-outbox] unknown event_type {event_type!r} "
        f"(row id={row.get('id')}); marking complete to avoid queue jam"
    )


def _handle_pending_conflict(row: dict[str, Any]) -> None:
    """Dispatch a pending-conflict event to the registered hook.

    The built-in default just logs the pending id so an operator can
    spot the event in production telemetry; real agent integrations
    register a hook via :func:`register_pending_conflict_hook` at
    startup.
    """

    payload = row.get("payload") or {}
    pending_id = payload.get("pending_conflict_id", "")
    if _pending_conflict_hook is None:
        log_info(
            f"[version-outbox] pending_conflict_created "
            f"project={row.get('project_id')} "
            f"pending_id={pending_id} "
            f"scope={payload.get('scope_path')!r} "
            f"policy={payload.get('policy')!r} "
            f"(no resolver hook registered)"
        )
        return
    _pending_conflict_hook(row)


def complete_version_outbox_for_commit(
    project_id: str,
    commit_id: str,
    *,
    client=None,
) -> int:
    """Mark durable post-commit work complete after the foreground hook ran.

    ``publish_mut_scope_update`` always inserts an outbox row in the same DB
    transaction as the accepted scope head. When the request path successfully
    runs the projection hook itself, the row should become a repair fallback
    record rather than work that the scheduler repeats a few seconds later.
    """

    if not settings.MUT_VERSION_OUTBOX_ENABLED or not project_id or not commit_id:
        return 0

    db = client or SupabaseClient().client
    try:
        resp = (
            db.table("mut_version_outbox")
            .update({
                "processed_at": datetime.now(timezone.utc).isoformat(),
                "locked_at": None,
                "last_error": None,
            })
            .eq("project_id", project_id)
            .eq("commit_id", commit_id)
            .is_("processed_at", "null")
            .execute()
        )
        return len(resp.data or [])
    except Exception as exc:
        log_warning(
            f"[version-outbox] could not mark commit {commit_id[:12]} "
            f"complete: {exc}",
        )
        return 0


def _claim_rows(client, limit: int) -> list[dict[str, Any]]:
    resp = client.rpc(
        "claim_mut_version_outbox_batch",
        {"p_limit": max(1, min(int(limit or 1), 500))},
    ).execute()
    return list(resp.data or [])


def _complete_row(client, row_id) -> None:
    if row_id is None:
        return
    client.rpc("complete_mut_version_outbox", {"p_id": row_id}).execute()


def _fail_row(client, row_id, error: str) -> None:
    if row_id is None:
        log_error(f"[version-outbox] failed unclaimed row: {error}")
        return
    client.rpc(
        "fail_mut_version_outbox",
        {"p_id": row_id, "p_error": error[:2000]},
    ).execute()
