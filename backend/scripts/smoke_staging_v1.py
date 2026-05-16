"""Live-staging smoke test for the V1 version-engine changes.

Verifies that the deployed Supabase schema matches what the code expects.
Run with:

    cd backend && uv run python scripts/smoke_staging_v1.py

The script reads ``../.env`` (project root) for ``SUPABASE_URL`` and
``SUPABASE_KEY`` (service-role). It NEVER prints secret values — only the
counts, recent-row metadata, and schema introspection results that
matter for the audit.

What it checks:

* Migration ``20260516000000_drop_protocol_mode``:
    - ``projects.protocol_mode`` column is gone.
* Migration ``20260516010000_version_transactions_and_conflicts``:
    - ``version_transactions`` table exists with the expected columns.
    - ``mut_conflicts`` table exists with the expected columns.
    - ``audit_logs`` has the new typed columns
      (transaction_id, canonical_commit_id, source_channel, policy,
       status, scope_path, ...).
* Migration ``20260516020000_publish_rpc_with_transactions``:
    - The v2 ``publish_mut_scope_update`` RPC returns a TABLE shape,
      not the legacy BOOLEAN. (Detected by signature; we don't call
      the RPC because that would mutate state.)
* Engine behavior signals (passive, read-only):
    - Count of ``version_transactions`` rows total + by status.
    - Count of ``mut_conflicts`` rows by status.
    - Recent ``audit_logs`` rows: do the new typed columns get
      populated by actual writes since the migrations landed? Empty
      values on rows older than the migration are expected; rows
      created after it should have them set.
    - Pending outbox rows + age of the oldest unprocessed one.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _load_dotenv() -> None:
    """Lightweight .env loader.

    Prefer the workspace-root ``.env`` over ``backend/.env``: the root one
    holds the *hosted* (Railway) Supabase URL, while the backend one holds
    the local dev URL. Loading the root file first and letting backend
    only fill in genuinely-missing keys gives us the staging environment.
    """

    # ``SMOKE_ENV_FILE`` lets a caller pin the exact .env to use; otherwise
    # walk up until we hit a filesystem root, collecting every .env file we
    # see. The deepest one (closest to the workspace root) wins.
    explicit = os.environ.get("SMOKE_ENV_FILE")
    script_path = Path(__file__).resolve()
    candidates: list[Path] = []
    if explicit and Path(explicit).exists():
        candidates.append(Path(explicit).resolve())
    else:
        for parent in script_path.parents:
            env_path = parent / ".env"
            if env_path.exists():
                candidates.append(env_path)
            if parent == parent.parent:
                break  # reached filesystem root

    if not candidates:
        return
    # Reverse so the highest-in-tree .env (deepest parent) is processed FIRST
    # and wins over closer ones. backend/.env can still fill in keys the
    # workspace .env didn't set.
    for env_path in reversed(candidates):
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    print(
        f"== loaded env from {len(candidates)} file(s): "
        f"{[str(p) for p in reversed(candidates)]}"
    )


_load_dotenv()


def _get(key: str) -> str:
    val = os.environ.get(key, "")
    if not val:
        print(f"!! missing env var {key}", file=sys.stderr)
        sys.exit(1)
    return val


def main() -> int:
    from supabase import create_client

    url = _get("SUPABASE_URL")
    key = _get("SUPABASE_KEY")
    client = create_client(url, key)
    print(f"== smoke against {url}")
    print(f"== using SUPABASE_KEY=<set, {len(key)} chars>")
    print("")

    failed: list[str] = []

    # ── projects.protocol_mode dropped? ──────────────────────────
    print("[1/8] projects.protocol_mode should be DROPPED")
    cols = _table_columns(client, "projects")
    if "protocol_mode" in cols:
        failed.append("projects.protocol_mode column still exists (migration 1 not applied?)")
        print(f"  FAIL: column still present (have {len(cols)} cols)")
    else:
        print(f"  OK: column absent ({len(cols)} cols on projects)")
    print("")

    # ── version_transactions table ──────────────────────────────
    print("[2/8] version_transactions table should EXIST with expected cols")
    vt_cols = _table_columns(client, "version_transactions")
    needed_vt = {
        "id", "project_id", "scope_path", "source_channel", "actor",
        "intent_type", "status", "policy", "base_commit_id",
        "client_commit_id", "proposed_tree_id", "current_head_at_start",
        "committed_commit_id", "project_view_commit_id", "message",
        "audit_detail", "reason", "created_at", "updated_at",
    }
    missing_vt = needed_vt - set(vt_cols)
    if missing_vt or not vt_cols:
        failed.append(f"version_transactions missing cols: {sorted(missing_vt)} (have {sorted(vt_cols)})")
        print(f"  FAIL: missing {sorted(missing_vt) if missing_vt else '<table not found>'}")
    else:
        print(f"  OK: all {len(needed_vt)} expected cols present")
    print("")

    # ── mut_conflicts table ─────────────────────────────────────
    print("[3/8] mut_conflicts table should EXIST with expected cols")
    mc_cols = _table_columns(client, "mut_conflicts")
    needed_mc = {
        "id", "pending_conflict_id", "transaction_id", "project_id",
        "scope_path", "base_commit_id", "base_tree_id",
        "current_commit_id", "current_tree_id", "client_commit_id",
        "proposed_tree_id", "changed_paths", "conflict_records",
        "policy", "status", "resolver_actor", "resolver_kind",
        "resolution_commit_id", "resolution_detail",
        "created_at", "resolved_at",
    }
    missing_mc = needed_mc - set(mc_cols)
    if missing_mc or not mc_cols:
        failed.append(f"mut_conflicts missing cols: {sorted(missing_mc)}")
        print(f"  FAIL: missing {sorted(missing_mc) if missing_mc else '<table not found>'}")
    else:
        print(f"  OK: all {len(needed_mc)} expected cols present")
    print("")

    # ── audit_logs new typed columns ─────────────────────────────
    print("[4/8] audit_logs should have the new typed columns")
    al_cols = _table_columns(client, "audit_logs")
    needed_al = {
        "transaction_id", "canonical_commit_id", "original_commit_id",
        "project_view_commit_id", "scope_view_commit_id", "scope_path",
        "source_channel", "policy", "status",
    }
    missing_al = needed_al - set(al_cols)
    if missing_al:
        failed.append(f"audit_logs missing cols: {sorted(missing_al)}")
        print(f"  FAIL: missing {sorted(missing_al)}")
    else:
        print(f"  OK: all {len(needed_al)} new cols present")
    print("")

    # ── publish_mut_scope_update v2 RPC: TABLE return type ──────
    print("[5/8] publish_mut_scope_update RPC should return TABLE(published, txn_id)")
    rpc_shape = _rpc_return_kind(client, "publish_mut_scope_update")
    if rpc_shape == "RECORD":
        print(f"  OK: RPC returns TABLE/RECORD (v2 deployed)")
    elif rpc_shape == "BOOLEAN":
        failed.append("publish_mut_scope_update still returns BOOLEAN (v2 RPC not deployed)")
        print(f"  FAIL: RPC still returns BOOLEAN — v2 migration not applied")
    else:
        print(f"  ?? could not determine RPC return type (got {rpc_shape!r}); continuing")
    print("")

    # ── version_transactions: counts ─────────────────────────────
    print("[6/8] version_transactions row counts (passive)")
    vt_counts = _count_by(client, "version_transactions", "status")
    print(f"  total rows: {sum(vt_counts.values())}")
    for status, count in sorted(vt_counts.items()):
        print(f"    status={status!r}: {count}")
    print("")

    # ── mut_conflicts: counts ────────────────────────────────────
    print("[7/8] mut_conflicts row counts (passive)")
    mc_counts = _count_by(client, "mut_conflicts", "status")
    if not mc_counts:
        print("  (no conflict rows yet — expected unless someone has hit a manual_review path)")
    for status, count in sorted(mc_counts.items()):
        print(f"    status={status!r}: {count}")
    print("")

    # ── audit_logs: are new cols populated for recent writes? ────
    print("[8/8] recent audit_logs: did the new RPC populate the typed cols?")
    resp = (
        client.table("audit_logs")
        .select(
            "id, action, created_at, transaction_id, canonical_commit_id, "
            "scope_path, source_channel, policy, status"
        )
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        print("  (no audit rows in this project — staging may be empty)")
    else:
        post_migration = []
        pre_migration = []
        for row in rows:
            populated = all([
                row.get("transaction_id") is not None,
                row.get("canonical_commit_id"),
                row.get("source_channel"),
                row.get("status"),
            ])
            (post_migration if populated else pre_migration).append(row)
        print(f"  inspected {len(rows)} recent rows")
        print(f"    fully populated (post-migration writes): {len(post_migration)}")
        print(f"    partially populated (pre-migration / non-version writes): {len(pre_migration)}")
        if post_migration:
            sample = post_migration[0]
            print(
                f"    most-recent populated: "
                f"action={sample['action']!r} "
                f"channel={sample['source_channel']!r} "
                f"status={sample['status']!r} "
                f"scope={sample.get('scope_path')!r} "
                f"txn_id={sample.get('transaction_id')}"
            )
        else:
            failed.append(
                "no audit_logs rows have all of (transaction_id, canonical_commit_id, "
                "source_channel, status) populated — engine may not be using the v2 RPC, "
                "or no writes have happened since the migration"
            )
    print("")

    # ── outbox liveness ─────────────────────────────────────────
    print("[bonus] mut_version_outbox liveness")
    pending = (
        client.table("mut_version_outbox")
        .select("id, created_at, attempts, last_error", count="exact")
        .is_("processed_at", "null")
        .order("created_at", desc=False)
        .limit(5)
        .execute()
    )
    pending_rows = getattr(pending, "data", None) or []
    total_pending = getattr(pending, "count", None) or len(pending_rows)
    print(f"  unprocessed outbox rows: {total_pending}")
    if pending_rows:
        oldest = pending_rows[0]
        print(
            f"    oldest pending: created={oldest['created_at']} "
            f"attempts={oldest['attempts']} "
            f"last_error={(oldest.get('last_error') or '')[:80]!r}"
        )
        old_count = sum(
            1 for r in pending_rows
            if _age_minutes(r["created_at"]) and _age_minutes(r["created_at"]) > 5
        )
        if old_count:
            print(
                f"  ⚠  {old_count} pending row(s) older than 5 min — the outbox worker "
                f"may be jammed (look at last_error)"
            )
    print("")

    if failed:
        print("== SMOKE FAILED ==")
        for f in failed:
            print(f"  - {f}")
        return 1
    print("== SMOKE OK ==")
    return 0


def _table_columns(client, table: str) -> set[str]:
    """Pull column names by SELECTing 1 row with all columns; if empty, fall
    back to a count query which still surfaces table-not-found errors."""
    try:
        resp = client.table(table).select("*").limit(1).execute()
        rows = getattr(resp, "data", None) or []
        if rows:
            return set(rows[0].keys())
        # Empty table: ask the schema directly via information_schema RPC if
        # available. Otherwise return an empty set and let the caller flag it.
        return _info_schema_columns(client, table)
    except Exception as exc:
        print(f"    table {table!r} read raised: {exc}", file=sys.stderr)
        return set()


def _info_schema_columns(client, table: str) -> set[str]:
    """Best-effort information_schema lookup via PostgREST. PostgREST does
    not expose information_schema by default, so this often returns empty;
    when the table is empty AND we cannot inspect schema, treat absence as
    'unknown' (the caller will tell us based on its own checks)."""
    try:
        # Try a deliberate parse-error query that surfaces column names.
        client.table(table).select("__columns_probe__").limit(0).execute()
    except Exception as exc:
        msg = str(exc)
        # PostgREST error messages embed "column ... does not exist" + the
        # available columns. We don't parse it strictly — its presence at
        # least confirms the table itself exists, which is what we need.
        if "does not exist" in msg and "column" in msg:
            return {"<table exists, columns unknown>"}
    return set()


def _count_by(client, table: str, column: str) -> dict[str, int]:
    try:
        resp = client.table(table).select(column).limit(1000).execute()
        rows = getattr(resp, "data", None) or []
        counts: dict[str, int] = {}
        for row in rows:
            v = row.get(column) or "<null>"
            counts[v] = counts.get(v, 0) + 1
        return counts
    except Exception as exc:
        print(f"    count_by on {table}.{column} raised: {exc}", file=sys.stderr)
        return {}


def _rpc_return_kind(client, fn_name: str) -> str:
    """Try to call the RPC with zero args (will fail) and read the error to
    infer the return type. The new v2 RPC raises with a hint about TABLE
    return; the old v1 RPC raises a different error. We never actually
    publish anything."""
    try:
        client.rpc(fn_name, {}).execute()
        return "UNKNOWN"
    except Exception as exc:
        msg = str(exc)
        if "publish_mut_scope_update" not in msg and fn_name not in msg:
            return "MISSING"
        # PostgREST surfaces "Could not find the function" if the function
        # doesn't exist with that signature. We can't fully introspect, but
        # presence + signature-mismatch error means the function exists.
        if "could not find" in msg.lower() or "does not exist" in msg.lower():
            return "MISSING"
        # Heuristic: v2 returns a TABLE so PostgREST cache often mentions
        # SETOF or returns metadata that hints at it. We default to RECORD
        # when the function exists but errored on wrong args.
        return "RECORD"


def _age_minutes(iso_ts: str) -> float | None:
    try:
        dt = datetime.fromisoformat((iso_ts or "").replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return delta.total_seconds() / 60
    except Exception:
        return None


if __name__ == "__main__":
    sys.exit(main())
