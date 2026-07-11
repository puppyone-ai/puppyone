"""Move legacy agent/sandbox config credentials into the hashed credential table.

The candidate set is snapshotted before mutation, so filtered pagination cannot
skip rows. Each row is processed in the safe order: persist/confirm hash state,
then remove plaintext config. Re-running is safe.

Usage:
    python -m scripts.backfill_surface_credentials
    python -m scripts.backfill_surface_credentials --apply
"""

from __future__ import annotations

import sys

from src.infra.supabase.client import SupabaseClient
from src.repo.access_credentials import AccessCredentialRepository, access_token_hash


def _snapshot(client, page_size: int = 500) -> list[dict]:
    rows: list[dict] = []
    page = 0
    while True:
        response = (
            client.table("access_surfaces")
            .select("id, org_id, project_id, kind, config, created_by")
            .in_("kind", ["agent", "sandbox"])
            .range(page * page_size, page * page_size + page_size - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        page += 1


def backfill(*, apply: bool) -> None:
    client = SupabaseClient().client
    credentials = AccessCredentialRepository(client)
    scanned = migrated = cleaned = 0

    for row in _snapshot(client):
        config = dict(row.get("config") or {})
        secret_field = "mcp_api_key" if row.get("kind") == "agent" else "access_key"
        raw_token = config.get(secret_field)
        if not raw_token:
            continue
        scanned += 1

        active = credentials.get_active_by_surface(row["id"])
        if active is None:
            if apply:
                credentials.store_bearer_token(
                    access_surface_id=row["id"],
                    org_id=row.get("org_id"),
                    project_id=row["project_id"],
                    raw_token=raw_token,
                    created_by=row.get("created_by"),
                    revoke_existing=False,
                )
            migrated += 1
        elif active.get("key_hash") != access_token_hash(raw_token):
            # A newer credential already exists. The config token is stale and
            # must not replace or reactivate it; only remove the plaintext.
            pass

        config.pop(secret_field, None)
        if apply:
            client.table("access_surfaces").update({"config": config}).eq(
                "id", row["id"]
            ).execute()
        cleaned += 1

    verb = "migrated" if apply else "would migrate"
    print(f"[backfill] scanned={scanned} {verb}={migrated} cleaned={cleaned}")
    if not apply:
        print("[backfill] dry run — re-run with --apply to persist hashes and remove plaintext")


if __name__ == "__main__":
    backfill(apply="--apply" in sys.argv[1:])

