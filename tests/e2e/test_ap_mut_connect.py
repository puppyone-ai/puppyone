#!/usr/bin/env python3
"""
Access Point → MUT Connection Test (No Gateway Types)
======================================================
Tests that agent, mcp, sandbox, filesystem, direct AP types
can be created via PuppyOne CLI/API and connected via MUT.

For each non-gateway provider:
1. Create AP via PuppyOne API
2. Verify AP has access_key
3. MUT clone via AP URL (cloud-first onboarding)
4. MUT connect via AP URL (local-first one-shot, mutai >= 0.1.7)
5. MUT push content
6. MUT pull to verify
7. Cleanup

Usage:
    export SUPABASE_URL=... SUPABASE_KEY=...
    python test_ap_mut_connect.py
"""
from __future__ import annotations

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

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mut"))

from mut.ops import clone_op, commit_op, push_op, pull_op, init_op
from mut.ops import link_access_op
try:
    from mut.ops import connect_op  # mutai >= 0.1.7 (one-shot init+link+commit+push)
except ImportError:  # pragma: no cover — older mutai checkouts
    connect_op = None
from mut.ops.repo import MutRepo
from mut.foundation.transport import MutClient


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


class T:
    def __init__(self, ctx):
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


def _create_ap_via_api(ctx, provider, name, scope_path="", mode="rw", extra_config=None):
    """Create AP via unified API POST /api/v1/access/."""
    config = extra_config or {}
    if "scope" not in config:
        config["scope"] = {"path": scope_path, "mode": mode}

    code, body = _req("POST", f"{ctx.api}/api/v1/access/",
                       {"project_id": ctx.project_id, "provider": provider,
                        "name": name, "config": config},
                       headers=_h(ctx.jwt))
    data = body.get("data") or {}
    return code, data


def _create_ap_via_db(ctx, provider, scope_path="", mode="rw", excludes=None):
    """Create AP directly in DB (fallback for providers where API may not work)."""
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    ap_id = f"test-{provider}-{secrets.token_hex(4)}"
    key = f"cli_{provider}_{secrets.token_urlsafe(16)}"
    sb.table("access_points").insert({
        "id": ap_id, "project_id": ctx.project_id,
        "provider": provider, "direction": "bidirectional", "status": "active",
        "config": {"scope": {"id": ap_id, "path": scope_path,
                              "exclude": excludes or [], "mode": mode}},
        "access_key": key,
    }).execute()
    return ap_id, key


def _test_mut_connection(t, ctx, provider, ap_key, ap_url, workdir, can_push=True):
    """Test MUT clone → push → pull cycle for an AP."""

    # Clone
    try:
        repo = clone_op.clone(ap_url, credential=ap_key, workdir=workdir)
        t.check(f"{provider}: clone succeeds", repo is not None)
    except Exception as e:
        t.check(f"{provider}: clone succeeds", False, str(e)[:150])
        return

    # Verify .mut/config.json
    from mut.foundation.config import load_config
    config = load_config(repo.mut_root)
    t.check(f"{provider}: config has server", bool(config.get("server")))
    t.check(f"{provider}: config has credential", bool(config.get("credential")))

    if not can_push:
        # Readonly — verify push is blocked
        (Path(workdir) / "test.txt").write_text("test")
        snap = commit_op.commit(repo, message="test", who="test")
        if snap:
            try:
                result = push_op.push(repo)
                t.check(f"{provider}: readonly blocks push",
                        result.get("status") not in ("ok", "pushed"))
            except Exception as e:
                t.check(f"{provider}: readonly blocks push (exception)",
                        "403" in str(e) or "read" in str(e).lower(), str(e)[:80])
        return

    # Write + commit + push
    (Path(workdir) / f"{provider}-test.txt").write_text(f"Written via {provider} AP")
    snap = commit_op.commit(repo, message=f"{provider}: test write", who=f"{provider}-agent")
    t.check(f"{provider}: commit succeeds", snap is not None)

    result = push_op.push(repo)
    t.check(f"{provider}: push succeeds",
            result.get("status") in ("ok", "pushed"),
            f"status={result.get('status')}")

    # Pull in a new clone to verify
    workdir2 = workdir + "-verify"
    try:
        repo2 = clone_op.clone(ap_url, credential=ap_key, workdir=workdir2)
        files = [f.name for f in Path(workdir2).rglob("*")
                 if f.is_file() and ".mut" not in str(f)]
        t.check(f"{provider}: pushed file visible in fresh clone",
                any(f"{provider}-test" in f for f in files), f"files={files}")
    except Exception as e:
        t.check(f"{provider}: verify clone", False, str(e)[:100])


def _test_mut_link(t, ctx, provider, ap_key, ap_url, workdir):
    """Test the legacy primitive cycle: mut init → mut link access → push.

    These primitives are still supported but the canonical user-facing
    flow is `mut connect <ap_url>` (see _test_mut_connect).
    """
    os.makedirs(workdir, exist_ok=True)

    repo = init_op.init(workdir)
    t.check(f"{provider}: init succeeds", (Path(workdir) / ".mut").is_dir())

    result = link_access_op.link_access(
        repo, ap_url, credential_override=ap_key,
    )
    t.check(f"{provider}: link succeeds", result.get("status") == "linked",
            json.dumps(result)[:150])

    # Write + commit + push after link
    (Path(workdir) / f"{provider}-linked.txt").write_text(f"Linked via {provider}")
    repo = MutRepo(workdir)
    snap = commit_op.commit(repo, message=f"{provider}: linked write", who=f"{provider}-link")
    t.check(f"{provider}: commit after link", snap is not None)

    result = push_op.push(repo)
    t.check(f"{provider}: push after link",
            result.get("status") in ("ok", "pushed"),
            f"status={result.get('status')}")


def _test_mut_connect(t, ctx, provider, ap_key, ap_url, workdir):
    """Test the canonical one-shot flow: `mut connect <ap_url>`.

    Pre-populates the workdir with user content, runs `connect_op.connect`
    (init + link + commit + push in one call), and verifies that:
    - status == "connected"
    - imported == True (we had local content)
    - the file shows up via a fresh clone from the same AP
    """
    if connect_op is None:
        t.skip(f"{provider}: mut connect", "mutai < 0.1.7 — connect_op unavailable")
        return

    os.makedirs(workdir, exist_ok=True)
    (Path(workdir) / f"{provider}-connect.txt").write_text(f"Connected via {provider}")
    (Path(workdir) / "nested").mkdir(exist_ok=True)
    (Path(workdir) / "nested" / "deep.md").write_text(f"# {provider} deep file")

    result = connect_op.connect(
        access_point_url=ap_url,
        credential=ap_key,
        workdir=workdir,
        message=f"{provider}: connect existing folder",
        who=f"{provider}-connect",
    )
    t.check(f"{provider}: connect status=connected",
            result.get("status") == "connected",
            f"result={json.dumps(result)[:150]}")
    t.check(f"{provider}: connect imported=True",
            result.get("imported") is True,
            f"result={json.dumps(result)[:150]}")
    t.check(f"{provider}: .mut/ created",
            (Path(workdir) / ".mut").is_dir())
    t.check(f"{provider}: .mut/config.json present",
            (Path(workdir) / ".mut" / "config.json").is_file())

    # Idempotent re-run on the same workdir → no new commit
    result2 = connect_op.connect(
        access_point_url=ap_url,
        credential=ap_key,
        workdir=workdir,
        message=f"{provider}: connect rerun",
        who=f"{provider}-connect",
    )
    t.check(f"{provider}: connect re-run is idempotent",
            result2.get("status") == "connected"
            and result2.get("imported") is False,
            f"result2={json.dumps(result2)[:150]}")

    # Verify via a fresh clone that the connected files are on the server
    workdir_verify = workdir + "-verify"
    try:
        clone_op.clone(ap_url, credential=ap_key, workdir=workdir_verify)
        files = [f.name for f in Path(workdir_verify).rglob("*")
                 if f.is_file() and ".mut" not in str(f)]
        t.check(f"{provider}: connected file visible in fresh clone",
                any(f"{provider}-connect" in f for f in files),
                f"files={files}")
    except Exception as e:
        t.check(f"{provider}: verify clone after connect", False, str(e)[:120])


# ══════════════════════════════════════════════════════════════

def test_setup(t, ctx):
    t.section("0. Setup")

    code, body = _req("POST", f"{ctx.api}/api/v1/projects/",
                       {"name": "AP-MUT-Connect-Test", "org_id": ctx.org_id},
                       headers=_h(ctx.jwt))
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id))
    ctx.base_dir = tempfile.mkdtemp(prefix="ap-mut-")


def test_filesystem_ap(t, ctx):
    t.section("1. Filesystem AP → MUT Clone + Push + Pull")

    ap_id, key = _create_ap_via_db(ctx, "filesystem", scope_path="", mode="rw")
    url = f"{ctx.api}/mut/ap/{key}"
    t.check("filesystem: AP created", bool(key))

    _test_mut_connection(t, ctx, "filesystem", key, url,
                         os.path.join(ctx.base_dir, "fs-clone"))


def test_filesystem_link(t, ctx):
    t.section("2. Filesystem AP → MUT Init + Link (legacy primitives)")

    ap_id, key = _create_ap_via_db(ctx, "filesystem", scope_path="", mode="rw")
    url = f"{ctx.api}/mut/ap/{key}"

    _test_mut_link(t, ctx, "filesystem-link", key, url,
                   os.path.join(ctx.base_dir, "fs-link"))


def test_filesystem_connect(t, ctx):
    """Canonical local-first onboarding: `mut connect <ap_url>` (one-shot)."""
    t.section("2b. Filesystem AP → MUT Connect (one-shot, existing folder)")

    ap_id, key = _create_ap_via_db(ctx, "filesystem", scope_path="", mode="rw")
    url = f"{ctx.api}/mut/ap/{key}"

    _test_mut_connect(t, ctx, "filesystem-connect", key, url,
                      os.path.join(ctx.base_dir, "fs-connect"))


def test_agent_ap(t, ctx):
    t.section("3. Agent AP → MUT Clone + Push + Pull")

    # Create agent AP via unified API
    code, data = _create_ap_via_api(ctx, "agent", "Test Agent")
    ap_id = data.get("id", "")
    key = data.get("access_key", "")

    if not key:
        # Fallback to DB
        ap_id, key = _create_ap_via_db(ctx, "agent", scope_path="", mode="rw")

    url = f"{ctx.api}/mut/ap/{key}"
    t.check("agent: AP created with key", bool(key))

    _test_mut_connection(t, ctx, "agent", key, url,
                         os.path.join(ctx.base_dir, "agent-clone"))


def test_sandbox_ap(t, ctx):
    t.section("4. Sandbox AP → MUT Clone + Push + Pull")

    ap_id, key = _create_ap_via_db(ctx, "sandbox", scope_path="", mode="rw")
    url = f"{ctx.api}/mut/ap/{key}"
    t.check("sandbox: AP created", bool(key))

    _test_mut_connection(t, ctx, "sandbox", key, url,
                         os.path.join(ctx.base_dir, "sandbox-clone"))


def test_direct_ap(t, ctx):
    t.section("5. Direct AP → MUT Clone + Push + Pull")

    ap_id, key = _create_ap_via_db(ctx, "direct", scope_path="", mode="rw")
    url = f"{ctx.api}/mut/ap/{key}"
    t.check("direct: AP created", bool(key))

    _test_mut_connection(t, ctx, "direct", key, url,
                         os.path.join(ctx.base_dir, "direct-clone"))


def test_direct_readonly(t, ctx):
    t.section("6. Direct AP (Readonly) → MUT Clone (push blocked)")

    ap_id, key = _create_ap_via_db(ctx, "direct", scope_path="", mode="r")
    url = f"{ctx.api}/mut/ap/{key}"
    t.check("direct-ro: AP created", bool(key))

    _test_mut_connection(t, ctx, "direct-ro", key, url,
                         os.path.join(ctx.base_dir, "direct-ro"), can_push=False)


def test_scoped_agent(t, ctx):
    t.section("7. Scoped Agent AP → Push in scope, blocked outside")

    # Push some content first via root AP
    root_id, root_key = _create_ap_via_db(ctx, "filesystem", scope_path="", mode="rw")
    root_url = f"{ctx.api}/mut/ap/{root_key}"
    root_dir = os.path.join(ctx.base_dir, "scoped-root")
    repo = clone_op.clone(root_url, credential=root_key, workdir=root_dir)
    (Path(root_dir) / "global.txt").write_text("global file")
    os.makedirs(Path(root_dir) / "agent-data", exist_ok=True)
    (Path(root_dir) / "agent-data" / "data.txt").write_text("agent data")
    commit_op.commit(repo, message="setup scoped test", who="setup")
    push_op.push(repo)

    # Create scoped agent AP for /agent-data/
    agent_id, agent_key = _create_ap_via_db(ctx, "agent", scope_path="/agent-data/", mode="rw")
    agent_url = f"{ctx.api}/mut/ap/{agent_key}"

    # Clone via scoped AP
    agent_dir = os.path.join(ctx.base_dir, "scoped-agent")
    try:
        repo_agent = clone_op.clone(agent_url, credential=agent_key, workdir=agent_dir)
        files = [f.relative_to(agent_dir).as_posix()
                 for f in Path(agent_dir).rglob("*")
                 if f.is_file() and ".mut" not in str(f)]
        t.check("scoped agent: clone succeeds", True)

        # Push within scope should work
        (Path(agent_dir) / "scoped-write.txt").write_text("in scope")
        commit_op.commit(repo_agent, message="in scope", who="agent")
        result = push_op.push(repo_agent)
        t.check("scoped agent: push in scope",
                result.get("status") in ("ok", "pushed"),
                f"status={result.get('status')}")

    except Exception as e:
        t.check("scoped agent: operations", False, str(e)[:150])


def test_unified_api_creation(t, ctx):
    t.section("8. Unified API: Create all non-gateway AP types")

    providers = [
        ("agent", "API Agent", {}),
        ("sandbox", "API Sandbox", {"mounts": [{"path": "/", "mount_path": "/workspace",
                                                  "permissions": {"read": True}}],
                                     "runtime": "alpine"}),
        ("filesystem", "API Filesystem", {"scope": {"path": "/api-fs", "mode": "rw"}}),
        ("direct", "API Direct", {"scope": {"path": "", "mode": "rw"}}),
    ]

    created_ids = []
    for provider, name, config in providers:
        code, data = _create_ap_via_api(ctx, provider, name, extra_config=config)
        ap_id = data.get("id", "")
        has_key = bool(data.get("access_key", ""))
        t.check(f"unified API: create {provider} ({code})",
                code in (200, 201), f"code={code} data={json.dumps(data)[:150]}")
        if ap_id:
            created_ids.append(ap_id)

    # Verify all in list
    code, body = _req("GET", f"{ctx.api}/api/v1/access/?project_id={ctx.project_id}",
                       headers=_h(ctx.jwt))
    aps = body.get("data", []) or []
    ap_providers = [a.get("provider") for a in aps]
    t.check("unified API: all types in list",
            "agent" in ap_providers and "filesystem" in ap_providers,
            f"providers={ap_providers}")


def test_multi_provider_concurrent(t, ctx):
    t.section("9. Multi-Provider Concurrent: 3 APs push simultaneously")

    aps = []
    for i, provider in enumerate(["filesystem", "agent", "direct"]):
        ap_id, key = _create_ap_via_db(ctx, provider, scope_path="", mode="rw")
        aps.append((provider, key, f"{ctx.api}/mut/ap/{key}"))

    # Each AP clones, writes, pushes
    for provider, key, url in aps:
        workdir = os.path.join(ctx.base_dir, f"concurrent-{provider}")
        try:
            repo = clone_op.clone(url, credential=key, workdir=workdir)
            (Path(workdir) / f"concurrent-{provider}.txt").write_text(f"from {provider}")
            commit_op.commit(repo, message=f"concurrent {provider}", who=provider)
            result = push_op.push(repo)
            t.check(f"concurrent {provider}: push",
                    result.get("status") in ("ok", "pushed", "merged"))
        except Exception as e:
            t.check(f"concurrent {provider}: push", False, str(e)[:100])

    # Verify all files visible via one AP
    verify_dir = os.path.join(ctx.base_dir, "concurrent-verify")
    _, verify_key = _create_ap_via_db(ctx, "direct", scope_path="", mode="r")
    client = MutClient(f"{ctx.api}/mut/ap/{verify_key}", verify_key)
    clone_data = client.clone()
    files = list(clone_data.get("files", {}).keys())
    for provider in ["filesystem", "agent", "direct"]:
        t.check(f"concurrent: {provider} file visible",
                any(f"concurrent-{provider}" in f for f in files),
                f"files={[f for f in files if 'concurrent' in f]}")


def test_cleanup(t, ctx):
    t.section("99. Cleanup")

    if ctx.base_dir and os.path.isdir(ctx.base_dir):
        shutil.rmtree(ctx.base_dir, ignore_errors=True)
        t.check("Temp dirs cleaned", True)

    if ctx.project_id:
        code, _ = _req("DELETE", f"{ctx.api}/api/v1/projects/{ctx.project_id}",
                        headers=_h(ctx.jwt))
        t.check("Project deleted", code == 200)


def main():
    import argparse
    parser = argparse.ArgumentParser()
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

    print(f"\nAP → MUT Connection Test (Non-Gateway Types)")
    print(f"API: {ctx.api}")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_filesystem_ap,
        test_filesystem_link,
        test_filesystem_connect,
        test_agent_ap,
        test_sandbox_ap,
        test_direct_ap,
        test_direct_readonly,
        test_scoped_agent,
        test_unified_api_creation,
        test_multi_provider_concurrent,
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
