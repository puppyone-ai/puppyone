"""Verify that recent staging writes flow through the v2 publish RPC.

If the v2 RPC was deployed AND the engine code is using it, every write
since the migration should appear in ``version_transactions`` and the
matching ``audit_logs`` row should have the new typed columns populated.

If we see recent ``mut_commits`` but no ``version_transactions`` rows
for them, the engine is somehow still using a legacy publish path —
that would be the bug to chase.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta
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

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_KEY"]
client = create_client(URL, KEY)


def _age(iso_ts: str) -> str:
    try:
        dt = datetime.fromisoformat((iso_ts or "").replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        if delta.total_seconds() < 60:
            return f"{int(delta.total_seconds())}s ago"
        if delta.total_seconds() < 3600:
            return f"{int(delta.total_seconds()/60)}m ago"
        if delta.total_seconds() < 86400:
            return f"{int(delta.total_seconds()/3600)}h ago"
        return f"{int(delta.total_seconds()/86400)}d ago"
    except Exception:
        return "?"


print(f"== {URL}")
print()


# 1) The 10 most-recent mut_commits — when were they written?
print("[1] Last 10 commits in mut_commits:")
recent = (
    client.table("mut_commits")
    .select("commit_id, project_id, scope_path, who, created_at")
    .order("created_at", desc=True)
    .limit(10)
    .execute()
)
rows = recent.data or []
for r in rows:
    print(
        f"  {r['created_at'][:19]} ({_age(r['created_at']):>8})  "
        f"{r['commit_id'][:8]}  project={r['project_id'][:8]}  "
        f"scope={r['scope_path']!r:<20}  who={r['who']!r}"
    )
print()


# 2) The 10 most-recent version_transactions
print("[2] Last 10 version_transactions:")
vt = (
    client.table("version_transactions")
    .select("id, project_id, scope_path, source_channel, intent_type, status, "
            "committed_commit_id, created_at, message")
    .order("created_at", desc=True)
    .limit(10)
    .execute()
)
vt_rows = vt.data or []
if not vt_rows:
    print("  (none)")
for r in vt_rows:
    print(
        f"  {r['created_at'][:19]} ({_age(r['created_at']):>8})  "
        f"id={r['id']} status={r['status']!r:<11} channel={r['source_channel']!r:<8} "
        f"intent={r['intent_type']!r:<11} commit={(r['committed_commit_id'] or '')[:8]:<8} "
        f"scope={r['scope_path']!r}"
    )
print()


# 3) Most-recent audit_logs rows that came from the new RPC
print("[3] Last 10 audit_logs rows tagged as version writes:")
al = (
    client.table("audit_logs")
    .select("id, action, created_at, transaction_id, canonical_commit_id, "
            "scope_path, source_channel, policy, status")
    .order("created_at", desc=True)
    .limit(20)
    .execute()
)
al_rows = al.data or []
v2_tagged = [
    r for r in al_rows
    if r.get("transaction_id") is not None or r.get("canonical_commit_id")
]
non_tagged = [
    r for r in al_rows
    if r.get("transaction_id") is None and not r.get("canonical_commit_id")
]
print(f"  inspected {len(al_rows)} recent rows; {len(v2_tagged)} have v2 typed cols set")
for r in v2_tagged[:5]:
    print(
        f"  {r['created_at'][:19]} ({_age(r['created_at']):>8})  "
        f"action={r['action']!r:<25} "
        f"channel={r['source_channel']!r:<8} status={r['status']!r:<11} "
        f"txn={r['transaction_id']}"
    )
print()
print("  Recent rows WITHOUT v2 cols (sample 5):")
for r in non_tagged[:5]:
    print(
        f"  {r['created_at'][:19]} ({_age(r['created_at']):>8})  "
        f"action={r['action']!r}"
    )
print()


# 4) Cross-check: of the 10 latest commits, how many have a
# corresponding version_transactions row?
print("[4] Coverage: do recent mut_commits have a version_transactions row?")
if rows:
    matched = 0
    for c in rows:
        match = (
            client.table("version_transactions")
            .select("id")
            .eq("committed_commit_id", c["commit_id"])
            .limit(1)
            .execute()
        )
        if match.data:
            matched += 1
    print(f"  {matched}/{len(rows)} recent commits have version_transactions rows")
    if matched == 0:
        print(
            "  ⚠  None of the recent mut_commits made it into version_transactions."
            "  Either (a) all 'recent' commits predate the v2 RPC migration"
            ", or (b) the engine isn't actually calling publish_mut_scope_update."
        )
print()


# 5) Migration timing: when was the v2 RPC migration applied?
# If all commits predate that timestamp, "0 rows" is expected.
print("[5] Migration timing inferred from mut_commits gap")
if rows:
    newest = rows[0]["created_at"]
    print(f"  newest mut_commit: {newest}  ({_age(newest)})")
print("  Expected: any commit after the v2 RPC deployment timestamp should")
print("  appear in version_transactions. If newest commit is older than the")
print("  deployment, that explains the 0 rows.")
