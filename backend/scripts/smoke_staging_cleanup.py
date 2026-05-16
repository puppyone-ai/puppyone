"""Wait for the outbox worker to process the smoke commit, then clean
up the test rows.

Run with:
  SMOKE_ENV_FILE=.../.env python scripts/smoke_staging_cleanup.py <commit_id> <txn_id> <scope_path> <project_id>
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path


def _load_env() -> None:
    env_path = Path(os.environ.get("SMOKE_ENV_FILE", ""))
    if not env_path.exists():
        sys.exit("set SMOKE_ENV_FILE=.../.env")
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()
from supabase import create_client


def main(commit_id: str, txn_id: int, scope_path: str, project_id: str) -> int:
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    # 1) Watch the outbox for up to 30 seconds.
    print(f"watching mut_version_outbox for commit {commit_id[:12]} (up to 30s)")
    deadline = time.time() + 30
    processed = False
    last_state = None
    while time.time() < deadline:
        r = (
            client.table("mut_version_outbox")
            .select("processed_at, attempts, last_error")
            .eq("commit_id", commit_id)
            .limit(1)
            .execute()
        )
        row = (r.data or [{}])[0]
        state = (row.get("processed_at"), row.get("attempts"), row.get("last_error"))
        if state != last_state:
            print(f"  {time.strftime('%H:%M:%S')}  processed_at={row.get('processed_at')}  "
                  f"attempts={row.get('attempts')}  last_error={(row.get('last_error') or '')[:80]}")
            last_state = state
        if row.get("processed_at"):
            processed = True
            break
        time.sleep(2)

    if not processed:
        print("  ⚠ outbox row not processed within 30s — worker may be down or polling slowly")
    else:
        print("  ✓ outbox processed")
    print()

    # 2) Clean up the 5 rows.
    print("cleaning up test rows...")
    for table, filt in [
        ("audit_logs", lambda t: t.eq("transaction_id", txn_id)),
        ("mut_version_outbox", lambda t: t.eq("commit_id", commit_id)),
        ("mut_commits", lambda t: t.eq("commit_id", commit_id)),
        ("mut_scope_state", lambda t: t.eq("project_id", project_id).eq("scope_path", scope_path)),
        ("version_transactions", lambda t: t.eq("id", txn_id)),
    ]:
        try:
            resp = filt(client.table(table).delete()).execute()
            n = len(resp.data or [])
            print(f"  deleted from {table:<22} rows={n}")
        except Exception as exc:
            print(f"  ✗ delete from {table:<22} failed: {str(exc)[:100]}")

    return 0


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: smoke_staging_cleanup.py <commit_id> <txn_id> <scope_path> <project_id>")
    sys.exit(main(sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]))
