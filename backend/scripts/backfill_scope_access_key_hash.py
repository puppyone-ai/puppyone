"""Backfill repo_scopes.access_key_hash from plaintext access_key (ISSUE-003).

Idempotent: only touches rows that have an access_key but no access_key_hash.
Run AFTER migration 20260704000000_repo_scopes_access_key_hash.sql and BEFORE
enabling SCOPE_ACCESS_KEY_HASH_LOOKUP.

Usage:
    python -m scripts.backfill_scope_access_key_hash            # dry run
    python -m scripts.backfill_scope_access_key_hash --apply    # write hashes
"""

from __future__ import annotations

import sys

from src.infra.supabase.client import SupabaseClient
from src.repo.access_credentials import access_token_hash


def backfill(apply: bool) -> None:
    client = SupabaseClient().client
    page = 0
    page_size = 500
    scanned = updated = 0

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
            break
        for row in rows:
            scanned += 1
            key = row.get("access_key")
            if not key:
                continue
            digest = access_token_hash(key)
            if apply:
                client.table("repo_scopes").update(
                    {"access_key_hash": digest}
                ).eq("id", row["id"]).execute()
            updated += 1
        if len(rows) < page_size:
            break
        page += 1

    verb = "updated" if apply else "would update"
    print(f"[backfill] scanned={scanned} {verb}={updated}")
    if not apply:
        print("[backfill] dry run — re-run with --apply to write hashes")


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv[1:])
