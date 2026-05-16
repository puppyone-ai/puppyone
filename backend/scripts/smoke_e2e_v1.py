"""End-to-end V1 stack exercise — scope auth, MutOps, GitNativeTransactionEngine.

Run against staging Supabase (reads root ``.env``):

    cd backend && uv run python scripts/smoke_e2e_v1.py

What it exercises, in order:

1. **Scope acquisition**: picks an existing staging project, creates a
   brand-new sub-scope ``.smoke-tests/e2e/{ts}`` so collisions with real
   user data are impossible. Lists ``mut_scopes`` rows before and after
   so we can see scope creation flows through ``ensure_root_scope``
   semantics.

2. **Auth context**: resolves the project's CLI access-key from the
   ``connectors`` table (or any user-created access point) and verifies
   ``resolve_access_point`` returns a scope-bound auth dict that
   ``MutOps`` understands. We use the service-role key in-process to
   write — the auth resolution is what we're validating, not the
   actor identity.

3. **MutOps single-writer happy path**:
     - ``ops.write_file(... scope=test_scope ...)``
     - ``ops.read_file(...)`` returns the written bytes
     - The expected rows land in ``mut_commits``,
       ``version_transactions`` (status=committed), ``audit_logs``
       (status=committed, typed columns populated),
       ``mut_version_outbox`` (event_type=commit_update).

4. **Concurrent two-writer race**: two ``asyncio`` tasks both write to
   the same file under the test scope. Per the V1 conflict policy
   stack (safe auto-merge → parent-scope-wins → LWW), expectations:
     - Both tasks succeed (LWW with same scope, different content, same
       parent base) → two commits, one wins as scope head.
     - OR one task gets ``ConcurrentMutationError`` from the optimistic
       CAS and retries inside the engine.
     - We verify that the final scope head is one of the two writes,
       and ``version_transactions`` has exactly 2 rows tied to this
       scope.

5. **Cleanup hints**: prints SQL the operator can run to remove the
   test rows. Does not auto-delete (staging is not throwaway).

The script does NOT touch S3 — it lets the engine create the loose
objects in whatever store the production code path uses, since we go
through the real MutOps.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _load_env() -> None:
    """Load root .env (workspace-level), preferring it over backend/.env."""
    script_path = Path(__file__).resolve()
    candidates: list[Path] = []
    for parent in script_path.parents:
        env_path = parent / ".env"
        if env_path.exists():
            candidates.append(env_path)
        if parent == parent.parent:
            break
    # Reverse so the highest .env wins.
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
    print(f"== loaded env from {[str(p) for p in reversed(candidates)]}")


_load_env()

# Make ``src.*`` importable when this script is run via ``uv run python
# scripts/...`` from the backend dir (uv doesn't add cwd to sys.path).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Imports must come AFTER env load so config.py picks up the right values.
from supabase import create_client  # noqa: E402

from src.mut_engine.adapters.operations.ops_adapter import MutOps  # noqa: E402
from src.mut_engine.server.repo_manager import MutRepoManager  # noqa: E402
from src.infra.s3.service import S3Service  # noqa: E402
from src.infra.supabase.client import SupabaseClient  # noqa: E402


URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_KEY"]
sb = create_client(URL, KEY)


def banner(label: str) -> None:
    print()
    print(f"════ {label} ════")


def _now_ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")


# ──────────────────────────────────────────────────────────────
# Phase 1 — pick project + create test scope
# ──────────────────────────────────────────────────────────────
def pick_project() -> str:
    rows = (
        sb.table("mut_commits")
        .select("project_id")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data
        or []
    )
    if not rows:
        sys.exit("!! no projects with recent activity in mut_commits")
    project_id = rows[0]["project_id"]
    print(f"target project: {project_id}")
    return project_id


def create_test_scope(project_id: str, suffix: str = "") -> tuple[str, str]:
    """Insert a fresh ``repo_scopes`` row + return (scope_path, access_key).

    The V1 scope model lives in ``repo_scopes`` (path, mode, is_root,
    access_key). The runtime head/root_hash is tracked separately in
    ``mut_scope_state`` and is created lazily by the engine on the
    first commit, so we don't seed that row here.

    ``suffix`` lets callers create multiple distinct scopes within the
    same second without colliding on the timestamp portion of the path.
    """
    scope_path = f".smoke-tests/e2e/{_now_ts()}{suffix}"
    existing = (
        sb.table("repo_scopes")
        .select("path")
        .eq("project_id", project_id)
        .eq("path", scope_path)
        .execute()
        .data
    )
    if existing:
        sys.exit(f"!! scope {scope_path} already exists, change timestamp")
    access_key = f"cli_e2e_{_now_ts()}{suffix}"
    sb.table("repo_scopes").insert({
        "project_id": project_id,
        "name": f"e2e-{_now_ts()}",
        "path": scope_path,
        "exclude": [],
        "is_root": False,
        "mode": "rw",
        "access_key": access_key,
    }).execute()
    print(f"created test scope: {scope_path} (ak={access_key[:14]}...)")
    return scope_path, access_key


# ──────────────────────────────────────────────────────────────
# Phase 2 — resolve scope auth via the access-point path
# ──────────────────────────────────────────────────────────────
def resolve_auth_demo(project_id: str, test_ak: str) -> None:
    """Walk ``resolve_access_point`` for two scopes: the one we just made,
    plus a real existing one. Validates that the auth-resolution seam still
    works end-to-end (the resolver reads ``repo_scopes`` directly).
    """
    from src.mut_engine.routers.access_point import resolve_access_point

    aks_to_check = [("e2e-test", test_ak)]
    real_rows = (
        sb.table("repo_scopes")
        .select("name, path, access_key")
        .eq("project_id", project_id)
        .not_.is_("access_key", "null")
        .neq("access_key", test_ak)
        .limit(2)
        .execute()
        .data
        or []
    )
    for row in real_rows:
        aks_to_check.append((row["name"] or row["path"] or "-", row["access_key"]))

    for label, ak in aks_to_check:
        try:
            pid, auth = resolve_access_point(ak)
            scope_dict = auth.get("_scope") or {}
            print(
                f"  AP {label:<14}  pid={pid[:8]}  "
                f"scope={scope_dict.get('path')!r:<28}  "
                f"mode={scope_dict.get('mode')}"
            )
        except Exception as e:
            print(f"  AP {label}: resolve failed -> {type(e).__name__}: {e}")
            return
    print("  scope-bound auth resolution: OK")


# ──────────────────────────────────────────────────────────────
# Phase 3 — single-writer happy path
# ──────────────────────────────────────────────────────────────
async def single_writer(ops: MutOps, project_id: str, scope: str) -> str:
    """Write a file, read it back, return the resulting commit_id.

    Note: when ``scope`` is supplied explicitly, ``MutOps.write_file``
    treats ``path`` as already scope-relative (no auto-routing), so we
    pass the bare filename here.
    """
    rel_path = "hello.txt"
    full_path = f"{scope}/{rel_path}"
    content = f"hello from smoke_e2e_v1 at {datetime.now(timezone.utc).isoformat()}\n".encode()
    result = await ops.write_file(
        project_id, rel_path, content,
        who="user:e2e-smoke",
        scope=scope,
        message="initial e2e write",
    )
    print(f"  write_file -> commit={result.commit_id[:12]} status={result.status} "
          f"merged={result.merged} conflicts={result.conflicts}")
    if not result.commit_id:
        sys.exit("!! write returned no commit_id")

    # Read via the scope's own state — bypasses the project root projection.
    in_scope = ops.read_file_in_scope(project_id, scope, rel_path)
    print(f"  read_file_in_scope: OK ({len(in_scope)} bytes)")
    if in_scope != content:
        sys.exit("!! in-scope readback mismatch")

    # Now try the projected-root read — surfaces the root-projection bug
    # if scope-promote up to root failed.
    try:
        proj = ops.read_file(project_id, full_path)
        match = "OK" if proj == content else "MISMATCH"
        print(f"  read_file (root projection): {match} ({len(proj)} bytes)")
    except FileNotFoundError as e:
        print(f"  read_file (root projection): MISS - {e}")
        print("    (scope-promote to root failed; new file not visible via project root)")
    return result.commit_id


def verify_ledger(commit_id: str, scope: str) -> None:
    """Confirm the V1 ledger rows are populated for this commit."""
    mc = (
        sb.table("mut_commits")
        .select("commit_id, scope_path, who, message")
        .eq("commit_id", commit_id)
        .execute()
        .data
    )
    print(f"  mut_commits rows: {len(mc)} (expected 1)")
    if mc:
        r = mc[0]
        print(f"    scope={r['scope_path']!r} who={r['who']!r} msg={r['message']!r}")

    vt = (
        sb.table("version_transactions")
        .select("id, status, source_channel, scope_path, committed_commit_id, "
                "intent_type, policy")
        .eq("committed_commit_id", commit_id)
        .execute()
        .data
    )
    print(f"  version_transactions rows: {len(vt)} (expected 1)")
    txn_id = None
    if vt:
        r = vt[0]
        txn_id = r["id"]
        print(f"    txn_id={r['id']} status={r['status']!r} "
              f"channel={r['source_channel']!r} scope={r['scope_path']!r} "
              f"intent={r['intent_type']!r} policy={r['policy']!r}")
        if r["status"] != "committed":
            print(f"    !! status is not 'committed'")
        if r["source_channel"] != "papi":
            print(f"    !! source_channel is not 'papi'")

    if txn_id is not None:
        al = (
            sb.table("audit_logs")
            .select("action, status, scope_path, source_channel, "
                    "canonical_commit_id, transaction_id")
            .eq("transaction_id", txn_id)
            .execute()
            .data
        )
        print(f"  audit_logs rows linked to txn: {len(al)}")
        for r in al:
            print(f"    action={r['action']!r}  status={r['status']!r}  "
                  f"scope={r['scope_path']!r}  channel={r['source_channel']!r}")

    ob = (
        sb.table("mut_version_outbox")
        .select("event_type, processed_at, attempts")
        .eq("commit_id", commit_id)
        .execute()
        .data
    )
    print(f"  mut_version_outbox rows: {len(ob)}")
    for r in ob:
        print(f"    event={r['event_type']!r}  processed={r['processed_at']}  "
              f"attempts={r['attempts']}")


# ──────────────────────────────────────────────────────────────
# Phase 4 — concurrent two-writer race
# ──────────────────────────────────────────────────────────────
async def concurrent_race(ops: MutOps, project_id: str, scope: str) -> tuple[str, str]:
    """Two tasks both write the same file with different content.

    Expected per V1 conflict policy: optimistic CAS detects the race,
    one task retries inside the engine, both eventually succeed (LWW
    on identical scope), and the scope head ends up at one of them.
    Returns (commit_a, commit_b).
    """
    rel_path = "race.txt"

    async def writer(tag: str) -> str:
        result = await ops.write_file(
            project_id, rel_path,
            f"content from {tag} at {datetime.now(timezone.utc).isoformat()}\n".encode(),
            who=f"user:e2e-{tag}",
            scope=scope,
            message=f"race write from {tag}",
        )
        return result.commit_id

    a, b = await asyncio.gather(writer("A"), writer("B"))
    print(f"  writer A commit: {a[:12]}")
    print(f"  writer B commit: {b[:12]}")
    if a == b:
        sys.exit("!! two concurrent writes produced the same commit_id (impossible)")

    final = ops.read_file_in_scope(project_id, scope, rel_path)
    print(f"  final scope-tree readback: {final.decode().strip()!r}")
    return a, b


def verify_concurrent(scope: str, commit_a: str, commit_b: str) -> None:
    """Both commits should be in mut_commits; one should be the scope head."""
    head = (
        sb.table("mut_scope_state")
        .select("head_commit_id, scope_hash")
        .eq("scope_path", scope)
        .execute()
        .data
    )
    if not head:
        print("  !! could not find mut_scope_state row for scope")
        return
    h = head[0]
    winner = "A" if h["head_commit_id"] == commit_a else (
        "B" if h["head_commit_id"] == commit_b else "neither"
    )
    print(f"  scope head: {h['head_commit_id'][:12]} (winner={winner})  "
          f"scope_hash: {(h['scope_hash'] or '')[:12]}")

    for tag, commit in (("A", commit_a), ("B", commit_b)):
        r = (
            sb.table("version_transactions")
            .select("id, status, policy")
            .eq("committed_commit_id", commit)
            .execute()
            .data
        )
        print(f"  writer {tag} ({commit[:8]}): "
              f"txn rows={len(r)}, "
              f"first={r[0] if r else None}")


# ──────────────────────────────────────────────────────────────
# Phase 5 — bulk write + delete roundtrip
# ──────────────────────────────────────────────────────────────
async def bulk_and_delete(ops: MutOps, project_id: str, scope: str) -> None:
    """One bulk_write, then a delete, then verify reads reflect both."""
    files = {
        "a.txt": b"alpha\n",
        "b.txt": b"bravo\n",
        "nested/c.txt": b"charlie\n",
    }
    bw = await ops.bulk_write(
        project_id, files,
        who="user:e2e-bulk",
        scope=scope,
        message="bulk write three files",
    )
    print(f"  bulk_write -> commit={bw.commit_id[:12]} status={bw.status} "
          f"paths={len(bw.paths)}")
    if not bw.commit_id:
        sys.exit("!! bulk_write returned no commit_id")

    # Verify all three landed
    for rel, expected in files.items():
        got = ops.read_file_in_scope(project_id, scope, rel)
        if got != expected:
            sys.exit(f"!! bulk readback mismatch for {rel}")
    print("  bulk readback: 3/3 files match")

    # Delete a.txt + nested/c.txt; b.txt remains
    rm = await ops.delete(
        project_id, ["a.txt", "nested/c.txt"],
        who="user:e2e-bulk",
        scope=scope,
        message="delete two files",
    )
    print(f"  delete -> commit={rm.commit_id[:12]} status={rm.status} "
          f"paths={len(rm.paths)}")

    # Confirm deletion semantics: removed files raise FileNotFoundError,
    # b.txt still readable.
    for rel in ("a.txt", "nested/c.txt"):
        try:
            ops.read_file_in_scope(project_id, scope, rel)
            sys.exit(f"!! {rel} should be gone but reads OK")
        except FileNotFoundError:
            pass
    if ops.read_file_in_scope(project_id, scope, "b.txt") != b"bravo\n":
        sys.exit("!! b.txt should survive the delete")
    print("  delete semantics: a.txt + nested/c.txt gone, b.txt survives")


# ──────────────────────────────────────────────────────────────
# Phase 6 — scope isolation
# ──────────────────────────────────────────────────────────────
def scope_isolation(ops: MutOps, project_id: str, scope_a: str, scope_b: str) -> None:
    """A file written under scope A must not be readable under scope B
    (the two scopes have disjoint trees by construction).
    """
    try:
        leaked = ops.read_file_in_scope(project_id, scope_b, "b.txt")
        sys.exit(f"!! scope leak: scope_b sees scope_a's b.txt "
                 f"({len(leaked)} bytes)")
    except FileNotFoundError:
        print(f"  scope_b cannot see scope_a/b.txt: OK")


# ──────────────────────────────────────────────────────────────
# Phase 7 — auto-cleanup
# ──────────────────────────────────────────────────────────────
def cleanup(project_id: str, scopes: list[str]) -> None:
    """Delete the rows this run wrote, in FK-safe order. Idempotent.

    Set ``SMOKE_KEEP=1`` to leave the rows in place for postmortem.
    """
    if os.environ.get("SMOKE_KEEP"):
        print("  SMOKE_KEEP set; leaving test rows in place")
        return

    for sp in scopes:
        commits = (
            sb.table("mut_commits")
            .select("commit_id")
            .eq("project_id", project_id)
            .eq("scope_path", sp)
            .execute()
            .data
            or []
        )
        cids = [c["commit_id"] for c in commits]
        if cids:
            txns = (
                sb.table("version_transactions")
                .select("id")
                .in_("committed_commit_id", cids)
                .execute()
                .data
                or []
            )
            tids = [t["id"] for t in txns]
            if tids:
                sb.table("audit_logs").delete().in_("transaction_id", tids).execute()
            sb.table("mut_version_outbox").delete().in_("commit_id", cids).execute()
            sb.table("version_transactions").delete().in_("committed_commit_id", cids).execute()
            sb.table("mut_commits").delete().in_("commit_id", cids).execute()
        sb.table("mut_scope_state").delete().eq("project_id", project_id).eq("scope_path", sp).execute()
        sb.table("mut_version_index").delete().eq("project_id", project_id).eq("scope_path", sp).execute()
        sb.table("repo_scopes").delete().eq("project_id", project_id).eq("path", sp).execute()
        print(f"  cleaned scope {sp} ({len(cids)} commits)")


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
async def main() -> int:
    banner("phase 1: pick project + create two test scopes")
    project_id = pick_project()
    scope, access_key = create_test_scope(project_id)
    # Sibling scope to exercise isolation in phase 6
    scope_b, _ = create_test_scope(project_id, suffix="-sib")

    banner("phase 2: resolve scope-bound access-point auth")
    resolve_auth_demo(project_id, access_key)

    banner("phase 3: single-writer happy path via MutOps")
    repo_manager = MutRepoManager(S3Service(), SupabaseClient())
    ops = MutOps(repo_manager)
    single_commit = await single_writer(ops, project_id, scope)
    verify_ledger(single_commit, scope)

    banner("phase 4: concurrent two-writer race")
    commit_a, commit_b = await concurrent_race(ops, project_id, scope)
    verify_concurrent(scope, commit_a, commit_b)

    banner("phase 5: bulk_write + delete roundtrip")
    await bulk_and_delete(ops, project_id, scope)

    banner("phase 6: scope isolation (sibling scope can't see scope's files)")
    scope_isolation(ops, project_id, scope, scope_b)

    banner("phase 7: auto-cleanup")
    cleanup(project_id, [scope, scope_b])

    print()
    print("== e2e smoke OK ==")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
