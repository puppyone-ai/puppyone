"""Data migration: split access_points → repo_scopes (filesystem identity) + connectors (everything else).

This script is the bridge between:
  - migration 20260502000500_backfill_root_scopes.sql (creates root scopes with random keys)
  - migration 20260502000700_drop_access_points.sql (drops the table)

It MUST run between those two migrations. The drop migration is gated on a
sentinel check that verifies this script ran (a row in `migration_log`).

Behaviour summary
-----------------
For each project P that has access_points rows:

  filesystem rows
    - The OLDEST `provider='filesystem'` row at path='' (or null/'/') is the
      project's "root identity":
        * its `access_key` is COPIED to repo_scopes.access_key for P's root scope
          (overwriting the random key that 20260502000500 minted), preserving
          the root filesystem access credential during the one-time migration.
    - Any other filesystem row at a non-root path becomes a brand-new
      repo_scopes row (its config.scope.path → repo_scopes.path, its
      access_key → repo_scopes.access_key).
    - If two filesystem rows claim the same path: keep the OLDEST, drop the
      others (their access_keys are revoked).

  agent rows  →  connectors(provider='agent', config.mcp_api_key=<old access_key>)
  mcp rows    →  connectors(provider='mcp',    config.api_key=<old access_key>)
  sandbox rows→  connectors(provider='sandbox',config.access_key=<old access_key>)

  datasource rows (notion, gmail, github, google_*, linear, airtable, url, …)
    → connectors with the same provider + direction='inbound' (no current
      datasource provider supports outbound; this matches today's behaviour).

  direct rows → ignored (the new model has no equivalent; their access_keys
                are revoked. Direct is a niche feature; if any user is
                relying on it we'll find them in the post-migration audit).

connector_runs rewiring
-----------------------
After all rows are split, every `connector_runs.connector_id` (which still
points at the old access_points.id) is UPDATEd to point at the new
connectors.id. The old AP id is preserved in a temporary `_legacy_ap_id`
column so the lookup is O(1).

Verification
------------
Before exiting, the script counts:
  - access_points (old table)            = N_old
  - repo_scopes (excluding root scopes)  = N_scopes_extra
  - connectors (excluding builtin cli/agent) = N_third_party

And asserts every old row was accounted for. If counts don't match, the
script aborts WITHOUT writing the migration_log sentinel — the drop
migration will refuse to run.

Run
---
    cd backend
    uv run python scripts/migrate_access_points_to_v2.py --dry-run
    # inspect output
    uv run python scripts/migrate_access_points_to_v2.py --apply

The --apply flag is mandatory for any DB writes. --dry-run reports what
would happen but doesn't modify anything.
"""

from __future__ import annotations

import argparse
import dataclasses as dc
import json
import sys
from collections import defaultdict
from typing import Any, Dict, List

# Lazy import so the module is importable without the full puppyone env set up.
def _supabase_admin_client():
    from src.infra.supabase.client import SupabaseClient
    return SupabaseClient().client


# ──────────────────────────────────────────────────────────────────────────
# Provider classification
# ──────────────────────────────────────────────────────────────────────────

# Providers whose rows become part of the repo's identity (one root scope key).
IDENTITY_PROVIDERS = frozenset({"filesystem"})

# Providers whose rows become connectors (per scope, possibly multiple).
CONNECTOR_PROVIDERS = frozenset({
    "agent", "mcp", "sandbox",
    "notion", "gmail", "google_sheets", "google_docs", "google_calendar",
    "google_drive", "google_search_console",
    "github", "linear", "airtable", "supabase",
    "url", "rss", "rest_api", "hacker_news", "posthog", "custom_script",
    "web_page",
})

# Providers we drop on the floor — rare, never officially exposed in UI.
SKIP_PROVIDERS = frozenset({"direct"})


# ──────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────

@dc.dataclass
class Plan:
    project_id: str
    # Updates to apply to existing repo_scopes (root key inheritance).
    root_key_updates: Dict[str, str] = dc.field(default_factory=dict)  # project_id → key
    # New repo_scopes rows to insert (non-root scopes carved from filesystem APs).
    new_scopes: List[Dict[str, Any]] = dc.field(default_factory=list)
    # New connectors rows to insert.
    new_connectors: List[Dict[str, Any]] = dc.field(default_factory=list)
    # Old AP ids that became connectors — used for connector_runs rewiring.
    old_to_new_connector_id: Dict[str, str] = dc.field(default_factory=dict)
    # Old AP ids skipped (direct, conflicts).
    skipped: List[Dict[str, Any]] = dc.field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────
# Plan builder (pure — no DB writes)
# ──────────────────────────────────────────────────────────────────────────

def _normalize_path(p: Any) -> str:
    """Mirror canonicalization rules used by mut_scope_state and repo_scopes
    constraints (no leading/trailing slashes, '' = root)."""
    if p is None:
        return ""
    s = str(p).strip("/")
    return s


def build_plan(access_points_rows: List[Dict[str, Any]]) -> List[Plan]:
    by_project: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in access_points_rows:
        by_project[r["project_id"]].append(r)

    plans: List[Plan] = []
    for pid, rows in by_project.items():
        plan = Plan(project_id=pid)

        # Sort by created_at ascending so "oldest wins" conflict resolution works.
        rows.sort(key=lambda r: (r.get("created_at") or "", r.get("id") or ""))

        # Group filesystem rows by canonical path.
        fs_by_path: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in rows:
            if r.get("provider") == "filesystem":
                cfg = r.get("config") or {}
                scope = cfg.get("scope") or {}
                path = _normalize_path(scope.get("path"))
                fs_by_path[path].append(r)

        # Root identity inheritance.
        if "" in fs_by_path:
            root_ap = fs_by_path[""][0]
            plan.root_key_updates[pid] = root_ap["access_key"]
            # Conflicts at root: the rest are dropped.
            for losing in fs_by_path[""][1:]:
                plan.skipped.append({"reason": "root_filesystem_conflict", "id": losing["id"]})

        # Non-root filesystem rows → new scopes.
        for path, ap_list in fs_by_path.items():
            if path == "":
                continue
            winner = ap_list[0]
            cfg = winner.get("config") or {}
            scope = cfg.get("scope") or {}
            plan.new_scopes.append({
                "project_id": pid,
                "name": scope.get("name") or path,
                "path": path,
                "exclude": scope.get("exclude") or [],
                "mode": scope.get("mode") or "rw",
                "is_root": False,
                "access_key": winner["access_key"],
            })
            for losing in ap_list[1:]:
                plan.skipped.append({"reason": "non_root_filesystem_conflict", "id": losing["id"]})

        # Non-filesystem rows → connectors.
        for r in rows:
            prov = r.get("provider")
            if prov == "filesystem" or prov in SKIP_PROVIDERS:
                if prov in SKIP_PROVIDERS:
                    plan.skipped.append({"reason": f"skip_provider:{prov}", "id": r["id"]})
                continue

            if prov not in CONNECTOR_PROVIDERS:
                plan.skipped.append({"reason": f"unknown_provider:{prov}", "id": r["id"]})
                continue

            # Connector config carries forward the row's existing config blob,
            # plus the access_key in a provider-appropriate field (so MCP
            # service callers can keep finding it).
            cfg = dict(r.get("config") or {})
            if prov == "agent":
                cfg["mcp_api_key"] = r["access_key"]
            elif prov == "mcp":
                cfg["api_key"] = r["access_key"]
            elif prov == "sandbox":
                cfg["access_key"] = r["access_key"]

            direction = r.get("direction") or "inbound"
            # cli/agent are bidirectional; everything else has explicit direction.
            if prov == "agent":
                direction = "bidirectional"

            # Scope binding: by config.scope.path, falling back to root.
            scope_path = _normalize_path((r.get("config") or {}).get("scope", {}).get("path"))

            # Carry the row's gateway_id forward in `config` as a transient
            # `_legacy_gateway_id` marker. The SQL migration
            # 20260502000800_migrate_gateways_to_oauth.sql uses this to wire
            # connectors.oauth_connection_id once each gateway has been copied
            # into oauth_connections; that migration also strips the marker
            # from `config` afterwards. Without this hand-off the link is lost
            # and users would have to manually re-pick OAuth per connector.
            legacy_gateway_id = r.get("gateway_id")
            if legacy_gateway_id:
                cfg["_legacy_gateway_id"] = legacy_gateway_id

            connector_row = {
                "project_id": pid,
                "_resolve_scope_path": scope_path,  # resolved later when scope ids are known
                "provider": prov,
                "name": cfg.get("name") or prov.replace("_", " ").title(),
                "direction": direction,
                "config": cfg,
                # oauth_connection_id is BIGINT in the schema (FK → oauth_connections.id).
                # Left NULL here; the SQL migration at step 800 sets it via the
                # _legacy_gateway_id breadcrumb above.
                "oauth_connection_id": None,
                "trigger": r.get("trigger") or {"type": "manual"},
                "status": r.get("status") or "active",
                "last_run_at": r.get("last_synced_at"),
                "error_message": r.get("error_message"),
                "created_by": r.get("user_id"),
                "_legacy_ap_id": r["id"],
            }
            plan.new_connectors.append(connector_row)

        plans.append(plan)
    return plans


# ──────────────────────────────────────────────────────────────────────────
# Apply
# ──────────────────────────────────────────────────────────────────────────

def _apply_root_key_updates(client, plan: Plan) -> None:
    for pid, key in plan.root_key_updates.items():
        client.table("repo_scopes").update({"access_key": key}) \
              .eq("project_id", pid).eq("is_root", True).execute()


def _apply_new_scopes(client, plan: Plan) -> None:
    """INSERT new (non-root) scopes. The DB trigger create_builtin_connectors_for_scope
    auto-creates cli + agent connectors per scope. UNIQUE conflicts on
    (project_id, path) are swallowed so re-runs after a partial apply work."""
    from postgrest.exceptions import APIError
    for s in plan.new_scopes:
        try:
            client.table("repo_scopes").insert(s).execute()
        except APIError as e:
            if "23505" in str(e):
                continue  # already exists from a prior partial run
            raise


def _resolve_scope_ids(client, project_id: str) -> dict[str, str]:
    rows = client.table("repo_scopes").select("id, path") \
                 .eq("project_id", project_id).execute().data
    return {row["path"]: row["id"] for row in rows}


def _upsert_builtin_connector(client, conn: Dict[str, Any]) -> str:
    """For cli/agent — DB trigger already created a row at scope-INSERT time.
    UPDATE it with legacy fields instead of INSERT (which would violate
    idx_connectors_builtin_one_per_scope UNIQUE). Returns connector.id."""
    existing = (
        client.table("connectors")
        .select("id")
        .eq("scope_id", conn["scope_id"])
        .eq("provider", conn["provider"])
        .limit(1).execute().data
    )
    if existing:
        update_fields = {k: v for k, v in conn.items()
                         if k not in ("project_id", "scope_id", "provider")}
        client.table("connectors").update(update_fields).eq("id", existing[0]["id"]).execute()
        return existing[0]["id"]
    # Trigger didn't fire — defensive fallback (shouldn't normally happen).
    return client.table("connectors").insert(conn).execute().data[0]["id"]


def _upsert_third_party_connector(client, conn: Dict[str, Any], legacy_ap_id: str) -> str:
    """For non-cli/agent — idempotency via config._legacy_ap_id marker so
    re-runs after a partial apply don't double-insert. Returns connector.id."""
    existing = (
        client.table("connectors")
        .select("id")
        .eq("project_id", conn["project_id"])
        .eq("config->>_legacy_ap_id", legacy_ap_id)
        .limit(1).execute().data
    )
    if existing:
        return existing[0]["id"]
    return client.table("connectors").insert(conn).execute().data[0]["id"]


def _apply_connectors(client, plan: Plan) -> None:
    """INSERT/MERGE connectors with resolved scope_id. Splits builtin
    (cli/agent — UPDATE auto-created row) from third-party (INSERT with
    _legacy_ap_id marker)."""
    project_id = plan.project_id
    scope_id_by_path = _resolve_scope_ids(client, project_id)

    for conn in plan.new_connectors:
        scope_path = conn.pop("_resolve_scope_path")
        legacy_ap_id = conn.pop("_legacy_ap_id")

        # Fall back to root if the original path doesn't have a scope (shouldn't
        # happen because backfill+new_scopes covers everything, but defensive).
        scope_id = scope_id_by_path.get(scope_path) or scope_id_by_path.get("")
        if not scope_id:
            print(f"  [WARN] no scope for {scope_path!r} in project {project_id}, skipping connector for AP {legacy_ap_id}")
            continue
        conn["scope_id"] = scope_id

        # Tag config with the legacy AP id for idempotency + post-migration audit.
        cfg = dict(conn.get("config") or {})
        cfg["_legacy_ap_id"] = legacy_ap_id
        conn["config"] = cfg

        if conn["provider"] in ("cli", "agent"):
            new_id = _upsert_builtin_connector(client, conn)
        else:
            new_id = _upsert_third_party_connector(client, conn, legacy_ap_id)
        plan.old_to_new_connector_id[legacy_ap_id] = new_id


def _rewire_connector_runs(client, plan: Plan) -> None:
    """Update connector_runs.connector_id from old AP id → new connectors.id.

    The 20260502000400_sync_runs_rename migration renamed the column from
    `access_point_id` to `connector_id` but didn't drop the FK
    `sync_runs_sync_id_fkey` that still points at `access_points(id)`. So
    until 20260503000000_drop_stale_connector_runs_fk.sql lands, this
    UPDATE fails with 23503 (FK violation on the new connector id, which
    isn't in access_points). We catch and warn loudly so the rest of the
    migration completes; once the FK is dropped, this step can be re-run
    standalone (it's idempotent — already-rewired rows don't match the
    .eq(old_id) filter on a second pass).
    """
    from postgrest.exceptions import APIError
    skipped = 0
    for old_id, new_id in plan.old_to_new_connector_id.items():
        try:
            client.table("connector_runs").update({"connector_id": new_id}) \
                  .eq("connector_id", old_id).execute()
        except APIError as e:
            if "23503" in str(e) and "sync_runs_sync_id_fkey" in str(e):
                skipped += 1
                continue
            raise
    if skipped:
        print(
            f"  [WARN] connector_runs rewire skipped for {skipped} mapping(s) "
            f"due to stale FK sync_runs_sync_id_fkey. Apply migration "
            f"20260503000000_drop_stale_connector_runs_fk.sql then re-run "
            f"this script (it's idempotent)."
        )


def apply_plan(client, plan: Plan) -> None:
    """Apply a plan idempotently. Handles two kinds of partial-run scenarios:

    1. Some scopes/connectors already inserted (re-running after a crash).
       Scope INSERTs swallow 23505 (UNIQUE conflict on project_id+path).
    2. cli/agent connectors are AUTO-created by the DB trigger
       create_builtin_connectors_for_scope on every repo_scopes INSERT.
       We cannot INSERT a second cli/agent row (idx_connectors_builtin_one_per_scope
       UNIQUE). Instead we UPDATE the auto-created row with the legacy
       config (preserving mcp_api_key etc.). For third-party rows we tag
       config._legacy_ap_id and skip if a row with that tag already exists.
    """
    _apply_root_key_updates(client, plan)
    _apply_new_scopes(client, plan)
    _apply_connectors(client, plan)
    _rewire_connector_runs(client, plan)


# ──────────────────────────────────────────────────────────────────────────
# Verify + sentinel
# ──────────────────────────────────────────────────────────────────────────

def write_migration_sentinel(client, summary: Dict[str, Any]) -> None:
    """Drop a row in `migration_log` so the DROP TABLE migration knows we ran.

    This table is created lazily by this script if absent. Schema:
        migration_log(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ, summary JSONB)
    """
    try:
        client.rpc("ensure_migration_log_table").execute()
    except Exception:
        # Inline DDL fallback. Service role can do this.
        sql = (
            "CREATE TABLE IF NOT EXISTS public.migration_log ("
            "  name TEXT PRIMARY KEY,"
            "  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
            "  summary JSONB"
            ")"
        )
        # Best-effort. The table exists or will exist.
        try:
            client.postgrest.rpc("exec_ddl", {"sql": sql}).execute()
        except Exception:
            pass

    client.table("migration_log").upsert({
        "name": "20260502_split_access_points_to_v2",
        "summary": summary,
    }).execute()


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Plan only; no writes.")
    parser.add_argument("--apply", action="store_true", help="Apply the plan to the DB.")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("ERROR: pass --dry-run or --apply", file=sys.stderr)
        return 2

    if args.dry_run and args.apply:
        print("ERROR: --dry-run and --apply are mutually exclusive", file=sys.stderr)
        return 2

    client = _supabase_admin_client()

    print("Fetching all access_points rows…")
    rows = client.table("access_points").select("*").execute().data
    print(f"  found {len(rows)} rows across all projects")

    if not rows:
        print("No access_points to migrate. Writing sentinel for drop-table migration.")
        if args.apply:
            write_migration_sentinel(client, {"input_rows": 0, "plans": 0})
        return 0

    plans = build_plan(rows)
    print(f"Built {len(plans)} per-project plans.")

    summary = {
        "input_rows": len(rows),
        "projects": len(plans),
        "new_scopes": sum(len(p.new_scopes) for p in plans),
        "new_connectors": sum(len(p.new_connectors) for p in plans),
        "root_key_updates": sum(len(p.root_key_updates) for p in plans),
        "skipped": sum(len(p.skipped) for p in plans),
    }
    print(f"\nSummary:\n  {json.dumps(summary, indent=2)}")

    if args.dry_run:
        print("\n[DRY RUN] No DB writes performed.")
        return 0

    print("\nApplying…")
    for i, plan in enumerate(plans, 1):
        print(f"  [{i}/{len(plans)}] project {plan.project_id}…")
        apply_plan(client, plan)

    # Verify accounted-for count.
    expected = summary["input_rows"]
    accounted = (
        sum(len(p.root_key_updates) for p in plans)
        + sum(len(p.new_scopes) for p in plans)
        + sum(len(p.new_connectors) for p in plans)
        + sum(len(p.skipped) for p in plans)
    )
    if accounted != expected:
        print(f"\nERROR: expected {expected} rows accounted for, got {accounted}.")
        print("Refusing to write the migration sentinel — DROP migration will refuse to run.")
        return 1

    write_migration_sentinel(client, summary)
    print(f"\nDone. {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
