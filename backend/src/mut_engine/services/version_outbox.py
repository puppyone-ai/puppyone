"""Durable repair loop for Git-native version post-commit side effects."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.config import settings
from src.infra.supabase.client import SupabaseClient
from src.mut_engine.dependencies import get_repo_manager_standalone
from src.mut_engine.services.hooks import (
    run_post_project_update_hook,
    run_post_push_hook,
)
from src.utils.logger import log_error, log_info, log_warning


def process_version_outbox_batch(
    *,
    repo_manager=None,
    client=None,
    limit: int | None = None,
) -> int:
    """Claim and replay pending version outbox rows.

    The synchronous post-commit hook gives Git clients read-your-write
    behavior. This worker is the durable repair path when projection,
    notification, or version-index work failed after the DB publish.
    """

    if not settings.MUT_VERSION_OUTBOX_ENABLED:
        return 0

    db = client or SupabaseClient().client
    repos = repo_manager or get_repo_manager_standalone()
    rows = _claim_rows(db, limit or settings.MUT_VERSION_OUTBOX_BATCH_SIZE)
    processed = 0

    for row in rows:
        row_id = row.get("id")
        try:
            payload = row.get("payload") or {}
            project_id = row["project_id"]
            commit_id = row["commit_id"]
            event_type = row.get("event_type") or payload.get("event_type") or ""
            hook = (
                run_post_project_update_hook
                if event_type == "project_version_committed"
                else run_post_push_hook
            )
            hook_root = (
                payload.get("project_root_hash")
                or payload.get("root_hash")
                or payload.get("scope_hash", "")
            )
            hook(
                project_id,
                repos,
                {
                    "status": "ok",
                    "commit_id": commit_id,
                    "root": hook_root,
                    "merged": bool(payload.get("merged", False)),
                    "conflicts": int(payload.get("conflicts") or 0),
                },
                raise_errors=True,
            )
            _complete_row(db, row_id)
            processed += 1
        except Exception as exc:
            _fail_row(db, row_id, str(exc))
            log_warning(f"[version-outbox] failed row {row_id}: {exc}")

    if processed:
        log_info(f"[version-outbox] processed {processed} rows")
    return processed


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
