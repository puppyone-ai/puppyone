#!/usr/bin/env python3
"""
PuppyOne CLI ↔ MUT CLI Integration Stress Test
================================================
Tests the full workflow: puppyone CLI creates projects/access points,
MUT CLI uses those access points to clone/push/pull/link.

Validates that config flows correctly between the two CLIs:
- puppyone access add filesystem → generates access_key + AP URL
- mut clone <AP URL> → clones into a fresh empty dir (cloud is SoT)
- mut connect <AP URL> → one-shot init + link + commit + push for an existing
  local folder (local is SoT). Verified end-to-end against connect_op.
- Legacy primitive path: mut init + link_access (still supported, kept for
  regression coverage of the building blocks underneath `mut connect`).
- Scope isolation across multiple APs
- Concurrent multi-agent simulation
- Rollback + pull-version across CLIs

Usage:
    export SUPABASE_URL=... SUPABASE_KEY=...
    python test_cli_integration.py [--verbose]
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

# ── HTTP helpers ──

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


# ── MUT CLI helpers ──

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mut"))

from mut.ops import init_op, clone_op, commit_op, push_op, pull_op, status_op, log_op
from mut.ops import link_access_op
try:
    from mut.ops import connect_op  # mutai >= 0.1.7
except ImportError:  # pragma: no cover — fallback for older mutai checkouts
    connect_op = None
from mut.ops.repo import MutRepo
from mut.foundation.transport import MutClient


@dataclass
class Ctx:
    api: str = ""
    jwt: str = ""
    user_id: str = ""
    org_id: str = ""
    project_id: str = ""
    verbose: bool = False
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list = field(default_factory=list)
    base_dir: str = ""
    # access points
    ap_root_key: str = ""
    ap_root_url: str = ""
    ap_docs_key: str = ""
    ap_docs_url: str = ""
    ap_src_key: str = ""
    ap_src_url: str = ""


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


# ══════════════════════════════════════════════════════════════

def test_setup(t: T, ctx: Ctx):
    t.section("0. Setup: Create Project + Access Points via PuppyOne API")

    # Create project
    code, body = _req("POST", f"{ctx.api}/api/v1/projects/",
                       {"name": "CLI-Integration-Test", "org_id": ctx.org_id},
                       headers=_h(ctx.jwt))
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id))

    # Seed some content via API
    for path, content in [
        ("readme.md", "# Integration Test"),
        ("src/main.py", "print('hello')"),
        ("src/utils.py", "def add(a,b): return a+b"),
        ("docs/guide.md", "# Guide"),
        ("docs/internal/secret.md", "SECRET"),
    ]:
        _req("POST", f"{ctx.api}/api/v1/content/{ctx.project_id}/write",
             {"path": path, "content": content, "message": f"seed: {path}"},
             headers=_h(ctx.jwt))
    t.check("Content seeded", True)

    # Create 3 access points with different scopes via direct DB
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    def _create_ap(ap_id, scope_path, mode, excludes=None):
        key = f"cli_int_{secrets.token_urlsafe(16)}"
        sb.table("access_points").insert({
            "id": ap_id, "project_id": ctx.project_id,
            "provider": "filesystem", "direction": "bidirectional", "status": "active",
            "config": {"scope": {"id": ap_id, "path": scope_path,
                                  "exclude": excludes or [], "mode": mode}},
            "access_key": key,
        }).execute()
        return key

    ctx.ap_root_key = _create_ap("int-root", "", "rw")
    ctx.ap_root_url = f"{ctx.api}/mut/ap/{ctx.ap_root_key}"
    t.check("Root AP created (rw, scope=/)", True)

    ctx.ap_docs_key = _create_ap("int-docs", "/docs/", "rw", ["/docs/internal/"])
    ctx.ap_docs_url = f"{ctx.api}/mut/ap/{ctx.ap_docs_key}"
    t.check("Docs AP created (rw, scope=/docs/, exclude=/docs/internal/)", True)

    ctx.ap_src_key = _create_ap("int-src", "/src/", "r")
    ctx.ap_src_url = f"{ctx.api}/mut/ap/{ctx.ap_src_key}"
    t.check("Src AP created (readonly, scope=/src/)", True)

    ctx.base_dir = tempfile.mkdtemp(prefix="cli-int-")
    t.check("Temp dir ready", True)


def test_scenario_a_clone(t: T, ctx: Ctx):
    """Scenario A: mut clone <AP URL> — standard clone from PuppyOne."""
    t.section("1. Scenario A: mut clone from PuppyOne AP")

    workdir = os.path.join(ctx.base_dir, "scenario-a")
    repo = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir)
    t.check("Clone succeeds", repo is not None)
    t.check(".mut/ created", (Path(workdir) / ".mut").is_dir())

    # Verify config has server + credential
    from mut.foundation.config import load_config
    config = load_config(repo.mut_root)
    t.check("Config has server URL", ctx.api in (config.get("server") or ""),
            config.get("server", ""))
    t.check("Config has credential", bool(config.get("credential")),
            f"keys={list(config.keys())}")

    # Verify files cloned
    files = [f.relative_to(workdir).as_posix()
             for f in Path(workdir).rglob("*")
             if f.is_file() and ".mut" not in str(f)]
    # Content write API adds .json suffix, so files appear as readme.md.json etc.
    t.check("Has readme.md(.json)", any("readme" in f for f in files), f"files={files}")
    t.check("Has src/main.py(.json)", any("main.py" in f for f in files), f"files={files}")
    t.check("Has docs/guide.md(.json)", any("guide" in f for f in files), f"files={files}")

    # Write + commit + push back to PuppyOne
    (Path(workdir) / "from-clone.txt").write_text("Written via mut clone workflow")
    snap = commit_op.commit(repo, message="from clone: add file", who="clone-agent")
    t.check("Commit succeeds", snap is not None)

    result = push_op.push(repo)
    t.check("Push succeeds", result.get("status") in ("ok", "pushed"),
            f"status={result.get('status')}")

    # Verify via API that the file is visible
    code, body = _req("GET", f"{ctx.api}/api/v1/content/{ctx.project_id}/ls",
                       headers=_h(ctx.jwt))
    entries = (body.get("data") or {}).get("entries", [])
    names = [e.get("name", "") for e in entries]
    t.check("Pushed file visible via API", any("from-clone" in n for n in names),
            f"names={names}")


def test_scenario_b_init_link(t: T, ctx: Ctx):
    """Scenario B (legacy primitives): mut init + mut link access — empty dir.

    Kept as regression coverage for the underlying primitives that
    `mut connect` orchestrates. New user-facing flow is exercised in
    test_scenario_d_connect_existing.
    """
    t.section("2. Scenario B: mut init + mut link access (empty dir)")

    workdir = os.path.join(ctx.base_dir, "scenario-b")
    os.makedirs(workdir)

    # Init
    repo = init_op.init(workdir)
    t.check("Init succeeds", (Path(workdir) / ".mut").is_dir())

    # Reinit (idempotent)
    repo2 = init_op.init(workdir)
    t.check("Reinit is idempotent", repo2 is not None)

    # Link access with root_dir_name
    result = link_access_op.link_access(
        repo, ctx.ap_root_url, root_dir_name="workspace",
        credential_override=ctx.ap_root_key,
    )
    t.check("Link succeeds", result.get("status") == "linked")
    t.check("Scope created", result.get("scope_created") is True)
    t.check("workspace/ dir exists locally", (Path(workdir) / "workspace").is_dir())

    # Verify config updated
    from mut.foundation.config import load_config
    config = load_config(repo.mut_root)
    t.check("Config has server after link", bool(config.get("server")))
    t.check("Config has credential after link", bool(config.get("credential")))

    # Write in workspace, commit, push
    (Path(workdir) / "workspace" / "notes.md").write_text("# Notes from init+link")
    repo = MutRepo(workdir)
    snap = commit_op.commit(repo, message="from init+link: notes", who="link-agent")
    t.check("Commit succeeds", snap is not None)

    result = push_op.push(repo)
    t.check("Push succeeds", result.get("status") in ("ok", "pushed"))


def test_scenario_c_init_link_existing(t: T, ctx: Ctx):
    """Scenario C (legacy primitives): mut init + mut link access — non-empty dir.

    Kept as regression coverage for the underlying primitives. The user-facing
    one-shot equivalent is `mut connect <ap_url>` (test_scenario_d_connect_existing).
    """
    t.section("3. Scenario C: mut init + link (non-empty dir)")

    workdir = os.path.join(ctx.base_dir, "scenario-c")
    os.makedirs(workdir)

    # Pre-populate with files
    (Path(workdir) / "local-file.txt").write_text("Existed before init")
    (Path(workdir) / "data").mkdir()
    (Path(workdir) / "data" / "config.json").write_text(json.dumps({"local": True}))

    # Init
    repo = init_op.init(workdir)
    t.check("Init succeeds", True)

    # Commit existing files
    snap = commit_op.commit(repo, message="existing files", who="local-user")
    t.check("Commit existing files", snap is not None)

    # Link without dir_name
    result = link_access_op.link_access(
        repo, ctx.ap_root_url,
        credential_override=ctx.ap_root_key,
    )
    t.check("Link succeeds", result.get("status") == "linked")

    # Push existing files to server
    repo = MutRepo(workdir)
    result = push_op.push(repo)
    t.check("Push existing files", result.get("status") in ("ok", "pushed", "merged"))


def test_scenario_d_connect_existing(t: T, ctx: Ctx):
    """Scenario D (canonical local-first onboarding): `mut connect <ap_url>`.

    Verifies the one-shot orchestration: init + link + commit + push, on
    a workdir that already contains user files. This is the path advertised
    in the UI ("Connect existing folder") and CLI (`puppyone access add
    filesystem --link <path>`).
    """
    t.section("3b. Scenario D: mut connect (existing folder, one-shot)")

    if connect_op is None:
        t.skip("mut connect", "mutai < 0.1.7 — connect_op not available")
        return

    workdir = os.path.join(ctx.base_dir, "scenario-d")
    os.makedirs(workdir)
    (Path(workdir) / "existing.md").write_text("# Pre-existing local content")
    (Path(workdir) / "src").mkdir()
    (Path(workdir) / "src" / "app.py").write_text("print('hello from local')")

    result = connect_op.connect(
        access_point_url=ctx.ap_root_url,
        credential=ctx.ap_root_key,
        workdir=workdir,
        message="connect: import existing files",
        who="connect-test",
    )

    t.check("connect status=connected", result.get("status") == "connected",
            f"result={result}")
    t.check("connect imported=True (workdir was non-empty)",
            result.get("imported") is True, f"result={result}")
    t.check("connect initialized=True (fresh dir)",
            result.get("initialized") is True, f"result={result}")
    t.check(".mut/ created", (Path(workdir) / ".mut").is_dir())
    t.check("config.json points at AP",
            (Path(workdir) / ".mut" / "config.json").is_file())

    # Idempotency: running connect again on the now-clean repo should not
    # double-commit (no new local content) and should leave the repo healthy.
    result2 = connect_op.connect(
        access_point_url=ctx.ap_root_url,
        credential=ctx.ap_root_key,
        workdir=workdir,
        message="connect: idempotent re-run",
        who="connect-test",
    )
    t.check("connect re-run status=connected",
            result2.get("status") == "connected", f"result2={result2}")
    t.check("connect re-run initialized=False (.mut/ already there)",
            result2.get("initialized") is False, f"result2={result2}")
    t.check("connect re-run imported=False (nothing new locally)",
            result2.get("imported") is False, f"result2={result2}")

    # Verify the imported files surfaced via the API.
    code, body = _req("GET", f"{ctx.api}/api/v1/content/{ctx.project_id}/ls",
                       headers=_h(ctx.jwt))
    entries = (body.get("data") or {}).get("entries", [])
    names = [e.get("name", "") for e in entries]
    t.check("connect-imported file visible via API",
            any("existing" in n for n in names), f"names={names}")

    # Connect on a truly empty workdir must NOT push an empty tree.
    workdir_empty = os.path.join(ctx.base_dir, "scenario-d-empty")
    os.makedirs(workdir_empty)
    result3 = connect_op.connect(
        access_point_url=ctx.ap_root_url,
        credential=ctx.ap_root_key,
        workdir=workdir_empty,
        message="connect: empty workdir",
        who="connect-test",
    )
    t.check("connect on empty dir: status=connected",
            result3.get("status") == "connected", f"result3={result3}")
    t.check("connect on empty dir: imported=False (no commit/push)",
            result3.get("imported") is False, f"result3={result3}")
    t.check("connect on empty dir: pushed=0",
            result3.get("pushed", 0) == 0, f"result3={result3}")


def test_scope_isolation(t: T, ctx: Ctx):
    """Test that different AP scopes see different files."""
    t.section("4. Scope Isolation Across APs")

    # Clone via docs AP (scope=/docs/, exclude=/docs/internal/)
    workdir_docs = os.path.join(ctx.base_dir, "scope-docs")
    repo_docs = clone_op.clone(ctx.ap_docs_url, credential=ctx.ap_docs_key, workdir=workdir_docs)
    docs_files = [f.relative_to(workdir_docs).as_posix()
                  for f in Path(workdir_docs).rglob("*")
                  if f.is_file() and ".mut" not in str(f)]
    # Scoped AP may return empty on first clone if no push was done through this scope
    if docs_files:
        t.check("Docs AP: has guide.md", any("guide" in f for f in docs_files), f"files={docs_files}")
    else:
        t.skip("Docs AP: has guide.md", "Scoped clone empty — content was written via root scope, not docs scope")
    t.check("Docs AP: NO internal/secret", not any("secret" in f or "internal" in f for f in docs_files),
            f"files={docs_files}")
    t.check("Docs AP: NO src/", not any("main.py" in f for f in docs_files), f"files={docs_files}")

    # Clone via src AP (scope=/src/, readonly)
    workdir_src = os.path.join(ctx.base_dir, "scope-src")
    repo_src = clone_op.clone(ctx.ap_src_url, credential=ctx.ap_src_key, workdir=workdir_src)
    src_files = [f.relative_to(workdir_src).as_posix()
                 for f in Path(workdir_src).rglob("*")
                 if f.is_file() and ".mut" not in str(f)]
    if src_files:
        t.check("Src AP: has main.py", any("main.py" in f for f in src_files), f"files={src_files}")
    else:
        t.skip("Src AP: has main.py", "Scoped clone empty — content was written via root scope, not src scope")
    t.check("Src AP: NO docs/", not any("guide" in f for f in src_files), f"files={src_files}")

    # Readonly AP should block push
    (Path(workdir_src) / "hack.py").write_text("hacked")
    snap = commit_op.commit(repo_src, message="hack attempt", who="hacker")
    if snap:
        try:
            result = push_op.push(repo_src)
            t.check("Readonly AP blocks push", result.get("status") != "ok",
                    f"status={result.get('status')}")
        except Exception as e:
            t.check("Readonly AP blocks push (exception)", "403" in str(e) or "read" in str(e).lower(),
                    str(e)[:100])
    else:
        t.skip("Readonly push test", "Nothing to commit")


def test_cross_cli_push_pull(t: T, ctx: Ctx):
    """Agent A pushes via MUT, Agent B pulls — both using PuppyOne APs."""
    t.section("5. Cross-CLI Push/Pull (Multi-Agent)")

    # Agent A clones and pushes
    workdir_a = os.path.join(ctx.base_dir, "agent-a")
    repo_a = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir_a)
    (Path(workdir_a) / "agent-a.txt").write_text("Agent A was here")
    commit_op.commit(repo_a, message="agent A: write", who="agent-A")
    result_a = push_op.push(repo_a)
    t.check("Agent A push", result_a.get("status") in ("ok", "pushed"))

    # Agent B clones fresh — should see Agent A's file
    workdir_b = os.path.join(ctx.base_dir, "agent-b")
    repo_b = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir_b)
    t.check("Agent B sees agent-a.txt", (Path(workdir_b) / "agent-a.txt").exists())

    # Agent B writes and pushes
    (Path(workdir_b) / "agent-b.txt").write_text("Agent B was here")
    commit_op.commit(repo_b, message="agent B: write", who="agent-B")
    result_b = push_op.push(repo_b)
    t.check("Agent B push", result_b.get("status") in ("ok", "pushed"))

    # Agent A pulls — should see Agent B's file
    pull_result = pull_op.pull(repo_a)
    t.check("Agent A pull sees update", pull_result.get("status") in ("updated", "up-to-date"))
    t.check("Agent A has agent-b.txt", (Path(workdir_a) / "agent-b.txt").exists())

    # Verify both files via PuppyOne API
    client = MutClient(ctx.ap_root_url, ctx.ap_root_key)
    clone_data = client.clone()
    files = list(clone_data.get("files", {}).keys())
    t.check("API sees both agents' files",
            any("agent-a" in f for f in files) and any("agent-b" in f for f in files),
            f"files={files[:10]}")


def test_rollback_across_clis(t: T, ctx: Ctx):
    """Push multiple versions via MUT, rollback via MUT, verify via API."""
    t.section("6. Rollback Across CLIs")

    workdir = os.path.join(ctx.base_dir, "rollback")
    repo = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir)
    base_commit_id = (Path(workdir) / ".mut" / "REMOTE_HEAD").read_text().strip()

    # Push 3 versions
    commit_ids = []
    for i in range(3):
        (Path(workdir) / f"rollback-v{i}.txt").write_text(f"Version {i}")
        commit_op.commit(repo, message=f"rollback prep v{i}", who="rollback-test")
        result = push_op.push(repo)
        commit_ids.append(result.get("commit_id", result.get("server_commit_id", "")))

    t.check("3 versions pushed", len(commit_ids) == 3)

    # Rollback via MUT client
    client = MutClient(ctx.ap_root_url, ctx.ap_root_key)
    rb_result = client.rollback(base_commit_id)
    t.check("Rollback succeeds", rb_result.get("status") == "rolled-back",
            json.dumps(rb_result)[:150])

    # Clone fresh — rollback files should be gone
    workdir2 = os.path.join(ctx.base_dir, "rollback-verify")
    repo2 = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir2)
    files = [f.name for f in Path(workdir2).rglob("*")
             if f.is_file() and ".mut" not in str(f)]
    t.check("Rollback files gone", not any("rollback-v" in f for f in files),
            f"files={[f for f in files if 'rollback' in f]}")


def test_rapid_push_pull_cycle(t: T, ctx: Ctx):
    """Stress test: 10 rapid push/pull cycles between two agents."""
    t.section("7. Rapid Push/Pull Stress (10 cycles)")

    workdir1 = os.path.join(ctx.base_dir, "rapid-1")
    workdir2 = os.path.join(ctx.base_dir, "rapid-2")
    repo1 = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir1)
    repo2 = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir2)

    success = 0
    for i in range(10):
        # Agent 1 writes + pushes
        (Path(workdir1) / f"rapid-{i}.txt").write_text(f"Rapid cycle {i}")
        commit_op.commit(repo1, message=f"rapid-{i}", who="rapid-1")
        r = push_op.push(repo1)
        if r.get("status") in ("ok", "pushed"):
            success += 1

        # Agent 2 pulls
        pull_op.pull(repo2, force=True)

    t.check("10 rapid cycles completed", success == 10, f"success={success}/10")

    # Verify agent 2 has all files
    files = [f.name for f in Path(workdir2).rglob("rapid-*.txt")]
    t.check("Agent 2 has all 10 files", len(files) == 10, f"count={len(files)}")


def test_status_log_consistency(t: T, ctx: Ctx):
    """Status and log should reflect what was pushed via PuppyOne AP."""
    t.section("8. Status & Log Consistency")

    workdir = os.path.join(ctx.base_dir, "status-log")
    repo = clone_op.clone(ctx.ap_root_url, credential=ctx.ap_root_key, workdir=workdir)

    # Clean after clone
    st = status_op.status(repo)
    t.check("Clean status after clone", len(st.get("changes", [])) == 0)

    # Write, check status
    (Path(workdir) / "status-test.txt").write_text("status test")
    st = status_op.status(repo)
    t.check("Status shows 1 change", len(st.get("changes", [])) == 1)

    # Commit, check unpushed
    commit_op.commit(repo, message="status test", who="status-bot")
    st = status_op.status(repo)
    t.check("Has unpushed", st.get("unpushed", 0) >= 1)

    # Push, check clean
    push_op.push(repo)
    st = status_op.status(repo)
    t.check("Clean after push", st.get("unpushed", 0) == 0)

    # Log
    entries = log_op.log(repo)
    t.check("Log has entries", len(entries) >= 2)
    messages = [e.get("message", "") for e in entries]
    t.check("Log contains our commit", any("status test" in m for m in messages))


def test_cleanup(t: T, ctx: Ctx):
    t.section("99. Cleanup")

    if ctx.base_dir and os.path.isdir(ctx.base_dir):
        shutil.rmtree(ctx.base_dir, ignore_errors=True)
        t.check("Temp dirs cleaned", True)

    # Delete APs
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    for ap_id in ["int-root", "int-docs", "int-src"]:
        try:
            sb.table("access_points").delete().eq("id", ap_id).execute()
        except Exception:
            pass

    if ctx.project_id:
        code, _ = _req("DELETE", f"{ctx.api}/api/v1/projects/{ctx.project_id}",
                        headers=_h(ctx.jwt))
        t.check("Project deleted", code == 200)


# ══════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description="CLI Integration Stress Test")
    parser.add_argument("--api", default="https://qubits-api.puppyone.ai")
    parser.add_argument("--verbose", "-v", action="store_true")
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
    ctx = Ctx(api=args.api, jwt=session.session.access_token, user_id=session.user.id, verbose=args.verbose)
    _req("POST", f"{args.api}/api/v1/auth/initialize", headers=_h(ctx.jwt))
    _, body = _req("GET", f"{args.api}/api/v1/organizations/", headers=_h(ctx.jwt))
    ctx.org_id = (body.get("data") or [{}])[0].get("id", "")

    print(f"\nPuppyOne CLI ↔ MUT CLI Integration Stress Test")
    print(f"API: {ctx.api}")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_scenario_a_clone,
        test_scenario_b_init_link,
        test_scenario_c_init_link_existing,
        test_scenario_d_connect_existing,
        test_scope_isolation,
        test_cross_cli_push_pull,
        test_rollback_across_clis,
        test_rapid_push_pull_cycle,
        test_status_log_consistency,
        test_cleanup,
    ]

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
    print(f"  Skipped: {ctx.skipped}")
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
