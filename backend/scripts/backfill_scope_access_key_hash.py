"""Backfill repo_scopes.access_key_hash from plaintext access_key (ISSUE-003).

Idempotent: only touches rows that have an access_key but no access_key_hash.
Run AFTER migration 20260704000000_repo_scopes_access_key_hash.sql. Once
20260711070000 has dropped those legacy columns, it exits successfully as a
no-op so later migration deployments remain repeatable.

Usage:
    python -m scripts.backfill_scope_access_key_hash            # dry run
    python -m scripts.backfill_scope_access_key_hash --apply    # write hashes
"""

from __future__ import annotations

import sys

from src.infra.supabase.client import SupabaseClient
from src.repo.access_credentials import access_token_hash


def _legacy_columns_have_been_retired(error: Exception) -> bool:
    """Only treat the expected PostgREST missing-column response as a no-op.

    The migration workflow deliberately runs this idempotent backfill before
    every `db push`.  After the destructive migration has succeeded, querying
    its dropped columns produces PGRST204. Do not hide network, auth, or other
    database errors: they must still fail the deployment.
    """
    message = str(error).lower()
    return (
        getattr(error, "code", None) == "PGRST204"
        and "repo_scopes" in message
        and ("access_key" in message or "access_key_hash" in message)
    )


def _snapshot_pending(client, page_size: int = 500) -> list[dict] | None:
    """Return legacy rows, or ``None`` when the destructive migration landed."""
    pending: list[dict] = []
    page = 0
    try:
        # Snapshot candidates before updating them. Paging a filtered set while
        # removing rows from that same set skips every other page.
        while True:
            resp = (
                client.table("repo_scopes")
                .select("id, access_key, access_key_hash")
                .not_.is_("access_key", "null")
                .is_("access_key_hash", "null")
                .range(page * page_size, page * page_size + page_size - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                return pending
            pending.extend(rows)
            if len(rows) < page_size:
                return pending
            page += 1
    except Exception as error:
        if _legacy_columns_have_been_retired(error):
            return None
        raise


def backfill(apply: bool) -> None:
    client = SupabaseClient().client
    scanned = updated = 0
    pending = _snapshot_pending(client)
    if pending is None:
        print("[backfill] legacy repo_scopes credential columns already retired; skipping")
        return

    for row in pending:
        scanned += 1
        key = row.get("access_key")
        if not key:
            continue
        digest = access_token_hash(key)
        if apply:
            client.table("repo_scopes").update({"access_key_hash": digest}).eq(
                "id", row["id"]
            ).execute()
        updated += 1

    verb = "updated" if apply else "would update"
    print(f"[backfill] scanned={scanned} {verb}={updated}")
    if not apply:
        print("[backfill] dry run — re-run with --apply to write hashes")


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv[1:])
