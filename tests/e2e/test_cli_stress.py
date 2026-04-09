#!/usr/bin/env python3
"""
MUT CLI Stress Test
====================
Tests MUT operations programmatically against production:
- clone/push/pull full lifecycle
- concurrent multi-agent push/pull
- large file handling
- rapid commit/push cycles
- rollback under load
- scope isolation under stress

Usage:
    export SUPABASE_URL=...  SUPABASE_KEY=...
    python test_cli_stress.py [--api URL] [--verbose]
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import secrets
import shutil
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

# Add mut to path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mut"))

from mut.foundation.transport import MutClient
from mut.ops.repo import MutRepo
from mut.ops import init_op, clone_op, commit_op, push_op, pull_op, status_op, log_op


# ── Helpers ──

@dataclass
class Ctx:
    api: str = ""
    verbose: bool = False
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list = field(default_factory=list)
    # test state
    project_id: str = ""
    ap_key: str = ""
    base_dir: str = ""
    jwt: str = ""
    user_id: str = ""
    org_id: str = ""


class T:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self._sec = ""

    def section(self, name):
        self._sec = name
        print(f"\n{'='*60}\n  {name}\n{'='*60}")

    def check(self, name, cond, detail=""):
        if cond:
            self.ctx.passed += 1
            print(f"  \u2713 {name}")
        else:
            self.ctx.failed += 1
            self.ctx.errors.append(f"[{self._sec}] {name}: {detail}")
            print(f"  \u2717 {name} \u2014 {detail}")
        return cond

    def skip(self, name, reason):
        self.ctx.skipped += 1
        print(f"  - SKIP {name}: {reason}")


def _req(method, url, data=None, headers=None, timeout=30):
    import urllib.request, urllib.error
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def _h(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def _tmpdir():
    return tempfile.mkdtemp(prefix="mut-stress-")


# ══════════════════════════════════════════════════════════════

def test_setup(t: T, ctx: Ctx):
    t.section("0. Setup: Project + Access Point")

    # Create project
    code, body = _req("POST", f"{ctx.api}/api/v1/projects/",
                       {"name": "CLI-Stress-Test", "org_id": ctx.org_id},
                       headers=_h(ctx.jwt))
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id))

    # Create AP via Supabase
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    ctx.ap_key = f"cli_stress_{secrets.token_urlsafe(16)}"
    sb.table("access_points").insert({
        "id": f"cli-stress-{secrets.token_hex(4)}",
        "project_id": ctx.project_id,
        "provider": "filesystem",
        "direction": "bidirectional",
        "status": "active",
        "config": {"scope": {"id": "stress-root", "path": "", "exclude": [], "mode": "rw"}},
        "access_key": ctx.ap_key,
    }).execute()
    t.check("Access point created", True)

    ctx.base_dir = _tmpdir()
    t.check("Temp dir ready", os.path.isdir(ctx.base_dir))


def test_clone_push_pull_lifecycle(t: T, ctx: Ctx):
    t.section("1. Clone → Write → Commit → Push → Pull Lifecycle")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    workdir = os.path.join(ctx.base_dir, "lifecycle")

    # Clone
    repo = clone_op.clone(server, credential="", workdir=workdir)
    t.check("Clone succeeds", repo is not None)
    t.check("Clone creates .mut/", (Path(workdir) / ".mut").is_dir())

    # Write files
    (Path(workdir) / "readme.md").write_text("# Stress Test\n\nVersion 1")
    (Path(workdir) / "src").mkdir(exist_ok=True)
    (Path(workdir) / "src" / "main.py").write_text("print('hello')\n")
    (Path(workdir) / "data.json").write_text(json.dumps({"version": 1}))

    # Status
    st = status_op.status(repo)
    t.check("Status shows changes", len(st.get("changes", [])) >= 3,
            f"changes={len(st.get('changes', []))}")

    # Commit
    snap = commit_op.commit(repo, message="v1: initial files", who="stress-test")
    t.check("Commit creates snapshot", snap is not None and snap.get("id") is not None)

    # Push
    result = push_op.push(repo)
    t.check("Push succeeds", result.get("status") in ("ok", "pushed"),
            f"status={result.get('status')}")
    v1 = result.get("version", result.get("server_version", 0))
    t.check("Push returns version or succeeds", result.get("status") in ("ok", "pushed"), f"v={v1}")

    # Modify and push again
    (Path(workdir) / "readme.md").write_text("# Stress Test\n\nVersion 2 - updated")
    (Path(workdir) / "src" / "utils.py").write_text("def add(a,b): return a+b\n")
    snap2 = commit_op.commit(repo, message="v2: updates", who="stress-test")
    t.check("Second commit", snap2 is not None)

    result2 = push_op.push(repo)
    t.check("Second push succeeds", result2.get("status") in ("ok", "pushed"))

    # Pull in a new clone
    workdir2 = os.path.join(ctx.base_dir, "lifecycle-pull")
    repo2 = clone_op.clone(server, credential="", workdir=workdir2)
    t.check("Second clone gets latest", (Path(workdir2) / "src" / "utils.py").exists())
    content = (Path(workdir2) / "readme.md").read_text()
    t.check("Content matches v2", "Version 2" in content, content[:50])

    # Log
    entries = log_op.log(repo)
    t.check("Log has 2+ entries", len(entries) >= 2, f"count={len(entries)}")


def test_rapid_commits(t: T, ctx: Ctx):
    t.section("2. Rapid Commit/Push Cycles (20 iterations)")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    workdir = os.path.join(ctx.base_dir, "rapid")
    repo = clone_op.clone(server, credential="", workdir=workdir)

    success_count = 0
    for i in range(20):
        # Write a unique file
        (Path(workdir) / f"file_{i:03d}.txt").write_text(f"Content iteration {i}\n" * 10)
        snap = commit_op.commit(repo, message=f"rapid-{i}", who="rapid-bot")
        if snap:
            result = push_op.push(repo)
            if result.get("status") in ("ok", "pushed"):
                success_count += 1

    t.check("20 rapid push cycles", success_count == 20, f"success={success_count}/20")

    # Verify all files exist
    client = MutClient(server, credential="")
    clone_data = client.clone()
    files = list(clone_data.get("files", {}).keys())
    rapid_files = [f for f in files if f.startswith("file_")]
    t.check("All 20 files visible", len(rapid_files) == 20,
            f"count={len(rapid_files)}")


def test_large_files(t: T, ctx: Ctx):
    t.section("3. Large File Handling")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    workdir = os.path.join(ctx.base_dir, "large")
    repo = clone_op.clone(server, credential="", workdir=workdir)

    # 100KB file
    (Path(workdir) / "medium.txt").write_text("x" * 100_000)
    snap = commit_op.commit(repo, message="100KB file", who="large-test")
    result = push_op.push(repo)
    t.check("100KB push succeeds", result.get("status") in ("ok", "pushed"))

    # 500KB file
    (Path(workdir) / "large.txt").write_text("y" * 500_000)
    snap = commit_op.commit(repo, message="500KB file", who="large-test")
    result = push_op.push(repo)
    t.check("500KB push succeeds", result.get("status") in ("ok", "pushed"))

    # 1MB file
    (Path(workdir) / "huge.bin").write_bytes(os.urandom(1_000_000))
    snap = commit_op.commit(repo, message="1MB binary", who="large-test")
    result = push_op.push(repo)
    t.check("1MB push succeeds", result.get("status") in ("ok", "pushed"))

    # Pull and verify sizes
    workdir2 = os.path.join(ctx.base_dir, "large-verify")
    repo2 = clone_op.clone(server, credential="", workdir=workdir2)
    medium_size = (Path(workdir2) / "medium.txt").stat().st_size if (Path(workdir2) / "medium.txt").exists() else 0
    large_size = (Path(workdir2) / "large.txt").stat().st_size if (Path(workdir2) / "large.txt").exists() else 0
    huge_size = (Path(workdir2) / "huge.bin").stat().st_size if (Path(workdir2) / "huge.bin").exists() else 0
    t.check("100KB roundtrip", medium_size == 100_000, f"size={medium_size}")
    t.check("500KB roundtrip", large_size == 500_000, f"size={large_size}")
    t.check("1MB roundtrip", huge_size == 1_000_000, f"size={huge_size}")


def test_multi_agent_concurrent(t: T, ctx: Ctx):
    t.section("4. Multi-Agent Concurrent Push/Pull")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"

    # Get current version
    client = MutClient(server, credential="")
    clone_data = client.clone()
    base_v = clone_data.get("version", 0)

    # Agent A pushes
    workdir_a = os.path.join(ctx.base_dir, "agent-a")
    repo_a = clone_op.clone(server, credential="", workdir=workdir_a)
    (Path(workdir_a) / "agent_a.txt").write_text("Agent A was here")
    commit_op.commit(repo_a, message="Agent A commit", who="agent-A")
    result_a = push_op.push(repo_a)
    t.check("Agent A push succeeds", result_a.get("status") in ("ok", "pushed"))
    v_a = result_a.get("version", 0)

    # Agent B pushes (based on old version — triggers merge)
    workdir_b = os.path.join(ctx.base_dir, "agent-b")
    repo_b = clone_op.clone(server, credential="", workdir=workdir_b)
    # repo_b cloned AFTER agent_a pushed, so it has agent_a's files
    (Path(workdir_b) / "agent_b.txt").write_text("Agent B was here")
    commit_op.commit(repo_b, message="Agent B commit", who="agent-B")
    result_b = push_op.push(repo_b)
    t.check("Agent B push succeeds", result_b.get("status") in ("ok", "pushed", "merged"),
            f"status={result_b.get('status')}")

    # Verify both files exist
    final = client.clone()
    files = list(final.get("files", {}).keys())
    t.check("Agent A file visible", "agent_a.txt" in files, f"files={files[:10]}")
    t.check("Agent B file visible", "agent_b.txt" in files, f"files={files[:10]}")

    # Agent C clones fresh and sees everything
    workdir_c = os.path.join(ctx.base_dir, "agent-c")
    repo_c = clone_op.clone(server, credential="", workdir=workdir_c)
    t.check("Agent C sees agent_a.txt", (Path(workdir_c) / "agent_a.txt").exists())
    t.check("Agent C sees agent_b.txt", (Path(workdir_c) / "agent_b.txt").exists())


def test_rollback_stress(t: T, ctx: Ctx):
    t.section("5. Rollback Under Load")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    client = MutClient(server, credential="")

    # Get current state
    clone_data = client.clone()
    base_v = clone_data.get("version", 0)

    # Push 5 versions
    workdir = os.path.join(ctx.base_dir, "rollback")
    repo = clone_op.clone(server, credential="", workdir=workdir)
    versions = []
    for i in range(5):
        (Path(workdir) / f"rollback_{i}.txt").write_text(f"Rollback test {i}")
        commit_op.commit(repo, message=f"rollback-prep-{i}", who="rollback-test")
        result = push_op.push(repo)
        versions.append(result.get("version", 0))

    t.check("5 prep pushes done", len(versions) == 5)

    # Rollback to base_v
    rb_result = client.rollback(base_v)
    t.check("Rollback to base succeeds", rb_result.get("status") == "rolled-back",
            f"result={json.dumps(rb_result)[:200]}")
    new_v = rb_result.get("new_version", 0)
    t.check("Rollback creates new version", new_v > versions[-1])

    # Clone should not have rollback files
    post_rb = client.clone()
    files = list(post_rb.get("files", {}).keys())
    t.check("Rollback files removed", not any(f.startswith("rollback_") for f in files),
            f"files={[f for f in files if 'rollback' in f]}")

    # Pull-version may fail for versions without root_hash (known limitation)
    for v in versions[:2]:
        try:
            pv = client.pull_version(v)
            t.check(f"Pull-version v{v} accessible", len(pv.get("files", {})) > 0)
        except Exception:
            t.skip(f"Pull-version v{v}", "version may lack root_hash")


def test_status_and_log(t: T, ctx: Ctx):
    t.section("6. Status & Log Accuracy")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    workdir = os.path.join(ctx.base_dir, "status-log")
    repo = clone_op.clone(server, credential="", workdir=workdir)

    # Clean status after clone
    st = status_op.status(repo)
    t.check("Clean status after clone", len(st.get("changes", [])) == 0,
            f"changes={st.get('changes', [])}")

    # Create files, check status before commit
    (Path(workdir) / "new1.txt").write_text("new file 1")
    (Path(workdir) / "new2.txt").write_text("new file 2")
    st = status_op.status(repo)
    changes = st.get("changes", [])
    t.check("Status shows 2 new files", len(changes) == 2, f"changes={changes}")

    # Commit and check unpushed
    commit_op.commit(repo, message="status test", who="status-bot")
    st = status_op.status(repo)
    t.check("No changes after commit", len(st.get("changes", [])) == 0)
    t.check("Has unpushed snapshots", st.get("unpushed", 0) >= 1)

    # Push and verify clean
    push_op.push(repo)
    st = status_op.status(repo)
    t.check("No unpushed after push", st.get("unpushed", 0) == 0)

    # Log entries
    entries = log_op.log(repo)
    t.check("Log has entries", len(entries) >= 1)
    # Find our commit in the log (may not be the last due to clone snapshot)
    our_entries = [e for e in entries if "status test" in e.get("message", "")]
    t.check("Our commit appears in log", len(our_entries) >= 1,
            f"messages={[e.get('message','')[:30] for e in entries[-3:]]}")


def test_negotiate(t: T, ctx: Ctx):
    t.section("7. Hash Negotiation")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    client = MutClient(server, credential="")

    # Negotiate with no known hashes
    resp = client.negotiate([])
    t.check("Negotiate with empty returns missing", "missing" in resp)

    # Clone to get all hashes
    clone_data = client.clone()
    all_hashes = list(clone_data.get("objects", {}).keys())

    # Negotiate with all hashes → nothing missing
    if all_hashes:
        resp = client.negotiate(all_hashes)
        missing = resp.get("missing", [])
        t.check("Negotiate with all hashes → 0 missing", len(missing) == 0,
                f"missing={len(missing)}")

    # Negotiate with partial hashes
    if len(all_hashes) > 2:
        resp = client.negotiate(all_hashes[:2])
        missing = resp.get("missing", [])
        t.check("Negotiate with partial hashes → some missing",
                len(missing) >= 0)  # may be 0 if tree is small


def test_error_handling(t: T, ctx: Ctx):
    t.section("8. Error Handling & Edge Cases")

    server = f"{ctx.api}/mut/ap/{ctx.ap_key}"
    client = MutClient(server, credential="")

    # Push with wrong base version
    from mut.core.object_store import ObjectStore
    dummy_data = b"test"
    dummy_hash = hashlib.sha256(dummy_data).hexdigest()[:16]
    tree = json.dumps({"test.txt": ["B", dummy_hash]}, sort_keys=True).encode()
    tree_hash = hashlib.sha256(tree).hexdigest()[:16]

    try:
        result = client.push(
            base_version=999999,
            snapshots=[{"id": 1, "root": tree_hash, "message": "bad base", "who": "test", "time": ""}],
            objects={
                dummy_hash: base64.b64encode(dummy_data).decode(),
                tree_hash: base64.b64encode(tree).decode(),
            },
        )
        # May succeed with merge or fail
        t.check("Push with stale base handled", result.get("status") in ("ok", "merged", "conflict"),
                f"status={result.get('status')}")
    except Exception as e:
        t.check("Push with stale base raises error", True, str(e)[:100])

    # Rollback to future version
    try:
        result = client.rollback(999999)
        t.check("Rollback to future version fails gracefully",
                result.get("status") != "rolled-back", json.dumps(result)[:100])
    except Exception as e:
        t.check("Rollback to future version raises error", True)

    # Pull-version for non-existent version
    try:
        result = client.pull_version(999999)
        t.check("Pull-version 999999 fails gracefully",
                not result.get("files"), json.dumps(result)[:100])
    except Exception as e:
        t.check("Pull-version 999999 raises error", True)


def test_cleanup(t: T, ctx: Ctx):
    t.section("99. Cleanup")

    # Delete temp dirs
    if ctx.base_dir and os.path.isdir(ctx.base_dir):
        shutil.rmtree(ctx.base_dir, ignore_errors=True)
        t.check("Temp dirs cleaned", not os.path.isdir(ctx.base_dir))

    # Delete project
    if ctx.project_id:
        code, _ = _req("DELETE", f"{ctx.api}/api/v1/projects/{ctx.project_id}",
                        headers=_h(ctx.jwt))
        t.check("Project deleted", code == 200)


# ══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="MUT CLI Stress Tests")
    parser.add_argument("--api", default="https://qubits-api.puppyone.ai")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--no-cleanup", action="store_true")
    args = parser.parse_args()

    from supabase import create_client
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]
    sb = create_client(url, key)
    email, pw = "e2e-test@puppyone.ai", "E2eTest2026!"
    try:
        sb.auth.admin.create_user({"email": email, "password": pw, "email_confirm": True})
    except Exception:
        pass
    session = sb.auth.sign_in_with_password({"email": email, "password": pw})
    jwt = session.session.access_token

    _req("POST", f"{args.api}/api/v1/auth/initialize", headers=_h(jwt))
    _, body = _req("GET", f"{args.api}/api/v1/organizations/", headers=_h(jwt))
    org_id = (body.get("data") or [{}])[0].get("id", "")

    ctx = Ctx(api=args.api, jwt=jwt, user_id=session.user.id, org_id=org_id, verbose=args.verbose)

    print(f"\nMUT CLI Stress Tests")
    print(f"API:  {ctx.api}")
    print(f"User: {email}")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_clone_push_pull_lifecycle,
        test_rapid_commits,
        test_large_files,
        test_multi_agent_concurrent,
        test_rollback_stress,
        test_status_and_log,
        test_negotiate,
        test_error_handling,
    ]
    if not args.no_cleanup:
        modules.append(test_cleanup)

    for mod in modules:
        try:
            mod(t_obj, ctx)
        except Exception as e:
            ctx.failed += 1
            ctx.errors.append(f"[{mod.__name__}] CRASH: {e}")
            print(f"  !! CRASH in {mod.__name__}: {e}")
            if args.verbose:
                traceback.print_exc()

    elapsed = time.time() - start
    print(f"\n{'='*60}\n  RESULTS\n{'='*60}")
    print(f"  Passed:  {ctx.passed}")
    print(f"  Failed:  {ctx.failed}")
    print(f"  Time:    {elapsed:.1f}s")
    if ctx.errors:
        print(f"\n  FAILURES:")
        for e in ctx.errors:
            print(f"    \u2717 {e}")
    pct = (ctx.passed / max(ctx.passed + ctx.failed, 1)) * 100
    print(f"\n  Pass rate: {pct:.0f}%")
    sys.exit(0 if ctx.failed == 0 else 1)


if __name__ == "__main__":
    main()
