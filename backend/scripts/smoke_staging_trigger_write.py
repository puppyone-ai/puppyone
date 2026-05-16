"""Trigger one real write to staging through the v2 publish RPC and
verify the full ledger landed.

Strategy: call ``publish_mut_scope_update`` directly with a no-op-shaped
write (old_hash and new_hash match, but we set ``allow_same_tree`` via
the only legal path: insert a row that creates a brand-new test scope).
That isn't ideal because the SQL function isn't a generic "test mode"
entry point — it's the engine's contract.

Safer choice: write to a brand-new, deliberately ugly scope path under
a project we own. ``mut_scope_state`` already has 21 rows from earlier
testing, so adding one more isn't a meaningful change.

If you don't want to mutate staging at all, set DRY_RUN=1 and the
script will skip the publish call and just print what it would have done.
"""

from __future__ import annotations

import os
import sys
import hashlib
import zlib
from datetime import datetime, timezone
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
DRY_RUN = bool(os.environ.get("DRY_RUN"))
client = create_client(URL, KEY)


def main() -> int:
    print(f"== {URL}  DRY_RUN={DRY_RUN}")

    # 1) Pick the most-recently-active project as our target. We're going
    # to write a brand-new file under a unique scope path so it cannot
    # collide with anything real.
    r = (
        client.table("mut_commits")
        .select("project_id")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = r.data or []
    if not rows:
        print("!! no projects with activity; aborting")
        return 1
    project_id = rows[0]["project_id"]
    print(f"target project: {project_id}")

    # 2) Cook a unique, namespaced scope path and a tiny commit-shaped
    # payload. Hashes follow Git loose-object format so the data is
    # consistent with everything else in the store.
    now = datetime.now(timezone.utc)
    scope_path = f".smoke-tests/{now.strftime('%Y%m%dT%H%M%S')}"
    blob_content = f"smoke verification {now.isoformat()}\n".encode()

    blob_sha, _ = _encode_loose("blob", blob_content)
    # tree object referencing the blob as "smoke.txt"
    tree_body = _encode_tree([("smoke.txt", blob_sha)])
    tree_sha, _ = _encode_loose_from_body("tree", tree_body)
    # commit referencing the tree
    commit_body = _encode_commit(
        tree_sha=tree_sha, parent_sha="", author="smoke <smoke@puppyone>",
        message="staging smoke",
    )
    commit_sha, _ = _encode_loose_from_body("commit", commit_body)

    print(f"  scope: {scope_path}")
    print(f"  tree:  {tree_sha}")
    print(f"  commit:{commit_sha}")
    if DRY_RUN:
        print("DRY_RUN — not publishing")
        return 0

    # 3) Insert the loose objects into the object_store backing table. We
    # do NOT know the exact storage scheme for this project (could be S3
    # or a Supabase Storage bucket), so we skip the object upload step.
    # The publish RPC only stores DB rows, not S3 objects, so this still
    # exercises the v2 RPC end-to-end. Reading the resulting commit back
    # would fail (no objects in S3), but the version_transactions and
    # audit_logs rows are what we care about.

    # 4) Call publish_mut_scope_update with old_hash="" (a fresh scope).
    resp = client.rpc("publish_mut_scope_update", {
        "p_project_id": project_id,
        "p_scope_path": scope_path,
        "p_old_hash": "",
        "p_new_hash": tree_sha,
        "p_head_commit_id": commit_sha,
        "p_who": "user:staging-smoke",
        "p_message": "staging smoke",
        "p_event_type": "smoke_test_write",
        "p_changes": [{"path": "smoke.txt", "action": "add"}],
        "p_conflicts": None,
        "p_created_at": now.isoformat(),
        "p_audit_agent_id": "user:staging-smoke",
        "p_audit_detail": {"smoke": True, "purpose": "v2-publish-rpc-validation"},
        "p_source_channel": "papi",
        "p_policy": "",
        "p_base_commit_id": "",
        "p_client_commit_id": "",
        "p_proposed_tree_id": tree_sha,
        "p_intent_type": "operation",
    }).execute()
    data = resp.data
    print(f"RPC return: {data!r}")
    if not (isinstance(data, list) and data and data[0].get("published")):
        print("!! publish returned not-published")
        return 1
    txn_id = data[0]["txn_id"]
    print(f"  txn_id = {txn_id}")

    # 5) Verify the ledger.
    print()
    print("verify ledger:")
    vt = (
        client.table("version_transactions")
        .select("*")
        .eq("id", txn_id)
        .execute()
    )
    vt_row = (vt.data or [{}])[0]
    print(f"  version_transactions[{txn_id}]: status={vt_row.get('status')!r}, "
          f"source_channel={vt_row.get('source_channel')!r}, "
          f"intent_type={vt_row.get('intent_type')!r}, "
          f"committed_commit_id={vt_row.get('committed_commit_id')!r}")

    al = (
        client.table("audit_logs")
        .select("id, action, transaction_id, canonical_commit_id, "
                "scope_path, source_channel, status")
        .eq("transaction_id", txn_id)
        .execute()
    )
    al_rows = al.data or []
    print(f"  audit_logs rows linking to txn_id={txn_id}: {len(al_rows)}")
    for r in al_rows:
        print(f"    action={r['action']!r}  status={r['status']!r}  "
              f"scope={r['scope_path']!r}  channel={r['source_channel']!r}")

    ob = (
        client.table("mut_version_outbox")
        .select("id, event_type, processed_at, attempts, last_error")
        .eq("commit_id", commit_sha)
        .execute()
    )
    ob_rows = ob.data or []
    print(f"  mut_version_outbox rows for commit: {len(ob_rows)}")
    for r in ob_rows:
        print(f"    event={r['event_type']!r}  processed={r['processed_at']}  "
              f"attempts={r['attempts']}  last_error={(r.get('last_error') or '')[:80]}")

    print()
    print("== END OF SMOKE — cleanup tips ==")
    print(f"To remove the test rows:")
    print(f"  DELETE FROM mut_scope_state WHERE project_id='{project_id}' "
          f"AND scope_path='{scope_path}';")
    print(f"  DELETE FROM mut_commits WHERE commit_id='{commit_sha}';")
    print(f"  DELETE FROM mut_version_outbox WHERE commit_id='{commit_sha}';")
    print(f"  DELETE FROM audit_logs WHERE transaction_id={txn_id};")
    print(f"  DELETE FROM version_transactions WHERE id={txn_id};")
    return 0


# ── Git loose-object helpers (copied from infrastructure to avoid
#    a full Python import chain in a script) ───────────────────────


def _encode_loose(obj_type: str, content: bytes) -> tuple[str, bytes]:
    framed = f"{obj_type} {len(content)}".encode("ascii") + b"\x00" + content
    sha = hashlib.sha1(framed).hexdigest()
    return sha, zlib.compress(framed)


def _encode_loose_from_body(obj_type: str, body: bytes) -> tuple[str, bytes]:
    return _encode_loose(obj_type, body)


def _encode_tree(entries: list[tuple[str, str]]) -> bytes:
    """entries: list of (name, blob_sha) — files only, mode=100644."""
    out = bytearray()
    for name, blob_sha in sorted(entries):
        out += b"100644 " + name.encode() + b"\x00" + bytes.fromhex(blob_sha)
    return bytes(out)


def _encode_commit(*, tree_sha, parent_sha, author, message):
    ts = int(datetime.now(timezone.utc).timestamp())
    parts = [f"tree {tree_sha}"]
    if parent_sha:
        parts.append(f"parent {parent_sha}")
    parts.append(f"author {author} {ts} +0000")
    parts.append(f"committer {author} {ts} +0000")
    parts.append("")
    parts.append(message.rstrip("\n") + "\n")
    return ("\n".join(parts)).encode()


if __name__ == "__main__":
    sys.exit(main())
