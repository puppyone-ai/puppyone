"""Deeper diagnostics for staging Supabase after a partial migration result.

The earlier smoke saw:
  * audit_logs has the new typed columns (so migration 20260516010000 ran)
  * version_transactions / mut_conflicts tables not exposed by PostgREST
  * publish_mut_scope_update RPC reports MISSING

This script disambiguates whether:
  (a) The migrations did NOT run for the tables / RPC, or
  (b) They ran but PostgREST has a stale schema cache.

It also asks PostgREST to reload its cache (if the service-role key
permits) and prints the real error bodies for each probe.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _load_dotenv() -> None:
    explicit = os.environ.get("SMOKE_ENV_FILE")
    if not explicit:
        print("!! set SMOKE_ENV_FILE to /c/Users/29757/PuppyNew/.env", file=sys.stderr)
        sys.exit(1)
    env_path = Path(explicit)
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


def main() -> int:
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    client = create_client(url, key)
    print(f"== smoke against {url}")
    print(f"== key prefix={key[:6]!r}, len={len(key)}")
    print()

    # 1) Ask PostgREST to reload schema. With a service-role key this is
    # allowed via the `pgrst_reload` channel through a Postgres NOTIFY.
    # supabase-py doesn't expose NOTIFY directly, but it does expose a
    # raw RPC; the standard reload helper is `NOTIFY pgrst, 'reload schema'`
    # which has to be wrapped in a SQL function — Supabase-managed
    # projects expose this via `supabase functions invoke` or an admin API.
    # For our purposes, simply hitting PostgREST with an unknown path
    # sometimes triggers a refresh; reality is the safest test is to query
    # via raw SQL through the `postgrest_admin_v1_rpc` if available.
    # As a soft try, we hit a known schema-refresh RPC that supabase
    # projects sometimes ship; if absent, we skip.
    print("[A] try to refresh PostgREST schema cache")
    for fn in ("reload_schema", "pgrst_reload", "refresh_schema"):
        try:
            client.rpc(fn, {}).execute()
            print(f"  reloaded via rpc({fn})")
            break
        except Exception as exc:
            msg = str(exc)[:160]
            print(f"    rpc({fn!r}) → {msg}")
    print()

    # 2) Probe each table by attempting a count query. PGRST205 means
    # "schema cache miss" (table not exposed via REST). 42P01 means
    # the table literally doesn't exist in Postgres.
    print("[B] direct table probes (PGRST205 = stale cache, 42P01 = missing in DB)")
    for table in [
        "version_transactions",
        "mut_conflicts",
        "audit_logs",
        "mut_scope_state",
        "mut_commits",
        "mut_version_outbox",
        "mut_version_index",
        "projects",
        "repo_scopes",
    ]:
        try:
            resp = client.table(table).select("*", count="exact").limit(0).execute()
            count = getattr(resp, "count", None)
            print(f"  ✓ {table:<22}  rows={count}")
        except Exception as exc:
            msg = str(exc)
            # extract code from the error if possible
            code = ""
            if "PGRST" in msg:
                start = msg.find("PGRST")
                code = msg[start:start + 6]
            elif "42P01" in msg:
                code = "42P01"
            short = msg[:140].replace("\n", " ")
            print(f"  ✗ {table:<22}  code={code or '?'}  {short}")
    print()

    # 3) Probe the publish RPC with the EXACT named args the engine sends.
    # We pick all-empty args so any successful resolution would CAS-fail
    # and return (false, NULL) without mutating state. If the function is
    # the v2 (TABLE return) we expect a list-shaped response.
    print("[C] publish_mut_scope_update RPC probe (no-op args)")
    try:
        resp = client.rpc("publish_mut_scope_update", {
            "p_project_id": "smoke-test-nonexistent",
            "p_scope_path": "",
            "p_old_hash": "deadbeef",  # guaranteed CAS miss
            "p_new_hash": "feedface",
            "p_head_commit_id": "0" * 40,
            "p_who": "smoke",
            "p_message": "",
            "p_event_type": "smoke_test",
            "p_changes": [],
            "p_conflicts": None,
            "p_created_at": "",
            "p_audit_agent_id": "smoke",
            "p_audit_detail": {},
            "p_source_channel": "smoke",
            "p_policy": "",
            "p_base_commit_id": "",
            "p_client_commit_id": "",
            "p_proposed_tree_id": "",
            "p_intent_type": "operation",
        }).execute()
        data = resp.data
        print(f"  RPC OK; raw data={data!r}")
        # Shape tells us v1 vs v2:
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict) and "published" in first:
                print("  → v2 deployed (TABLE return with published+txn_id)")
            else:
                print(f"  → unexpected list shape: {first!r}")
        elif isinstance(data, dict):
            print("  → v2 (object return)")
        elif isinstance(data, bool):
            print("  → v1 deployed (BOOLEAN return) — migration 20260516020000 NOT applied")
    except Exception as exc:
        msg = str(exc)
        print(f"  RPC error: {msg[:240]}")
        if "Could not find" in msg:
            print("  → RPC is missing OR the v2 signature doesn't match (check param names)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
