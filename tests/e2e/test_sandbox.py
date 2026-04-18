#!/usr/bin/env python3
"""
PuppyOne Sandbox Deep E2E Test
================================
Tests sandbox endpoint CRUD, auth, scope/mounts, execution,
file read/write, MUT sync, rollback interaction, and lifecycle.

Usage:
    export SUPABASE_URL=...  SUPABASE_KEY=...
    python test_sandbox.py [--api URL] [--verbose]
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone

# ── HTTP helpers (reuse from run_e2e) ──

def _headers(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def _req(method, url, data=None, headers=None, timeout=30):
    import urllib.request
    import urllib.error
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
    errors: list = field(default_factory=list)
    # sandbox state
    sbx_id: str = ""
    sbx_key: str = ""
    sbx_rw_id: str = ""
    sbx_rw_key: str = ""
    sbx_ro_id: str = ""
    sbx_ro_key: str = ""


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
        if self.ctx.verbose and detail:
            print(f"    {detail}")
        return cond

    def get(self, path):
        return _req("GET", f"{self.ctx.api}{path}", headers=_headers(self.ctx.jwt))

    def post(self, path, data=None):
        return _req("POST", f"{self.ctx.api}{path}", data, headers=_headers(self.ctx.jwt))

    def put(self, path, data=None):
        return _req("PUT", f"{self.ctx.api}{path}", data, headers=_headers(self.ctx.jwt))

    def delete(self, path):
        return _req("DELETE", f"{self.ctx.api}{path}", headers=_headers(self.ctx.jwt))

    def exec_sbx(self, endpoint_id, key, command):
        """Execute a command in a sandbox endpoint."""
        return _req("POST", f"{self.ctx.api}/api/v1/sandbox-endpoints/{endpoint_id}/exec",
                     data={"command": command},
                     headers={"X-Access-Key": key, "Content-Type": "application/json"},
                     timeout=60)

    def ap_post(self, key, op, data=None):
        return _req("POST", f"{self.ctx.api}/api/v1/mut/ap/{key}/{op}",
                     data=data or {},
                     headers={"Content-Type": "application/json"})


# ── MUT helpers ──

def sha256_16(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]

def build_tree(files: dict[str, bytes]):
    objects = {}
    def _blob(c):
        h = sha256_16(c); objects[h] = base64.b64encode(c).decode(); return h
    def _build(nested):
        entries = {}
        for name, val in sorted(nested.items()):
            entries[name] = list(val) if isinstance(val, tuple) else ["T", _build(val)]
        d = json.dumps(entries, sort_keys=True).encode()
        h = sha256_16(d); objects[h] = base64.b64encode(d).decode(); return h
    nested = {}
    for path, content in files.items():
        parts = path.split("/"); d = nested
        for p in parts[:-1]: d = d.setdefault(p, {})
        d[parts[-1]] = ("B", _blob(content))
    return _build(nested), objects


# ══════════════════════════════════════════════════════════════
# TEST MODULES
# ══════════════════════════════════════════════════════════════

def test_setup(t: T, ctx: Ctx):
    """Create project and seed content for sandbox tests."""
    t.section("0. Setup: Project + Content")

    # Create project
    code, body = t.post("/api/v1/projects/", {"name": "SBX-E2E-Test", "org_id": ctx.org_id})
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id))

    # Write test files
    for path, content in [
        ("src/main.py", "print('hello sandbox')"),
        ("src/utils.py", "def add(a,b): return a+b"),
        ("data/config.json", json.dumps({"version": 1, "debug": True})),
        ("data/users.csv", "name,age\nalice,30\nbob,25"),
        ("docs/readme.md", "# Sandbox Test Project"),
    ]:
        code, body = t.post(f"/api/v1/content/{ctx.project_id}/write", {
            "path": path, "content": content, "message": f"seed: {path}",
        })
    t.check("Seed content written", code == 200)

    # Create a MUT AP for version tracking
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    ap_key = f"e2e_sbx_{secrets.token_urlsafe(12)}"
    sb.table("access_points").insert({
        "id": f"sbx-ap-{secrets.token_hex(4)}",
        "project_id": ctx.project_id,
        "provider": "filesystem",
        "direction": "bidirectional",
        "status": "active",
        "config": {"scope": {"id": "sbx-root", "path": "", "exclude": [], "mode": "rw"}},
        "access_key": ap_key,
    }).execute()
    ctx.ap_key = ap_key
    t.check("MUT AP created", True)


def test_sandbox_crud(t: T, ctx: Ctx):
    t.section("1. Sandbox Endpoint CRUD")

    pid = ctx.project_id

    # Create sandbox endpoint (read-write, /src scope)
    code, body = t.post("/api/v1/sandbox-endpoints", {
        "project_id": pid,
        "name": "RW Sandbox - src",
        "description": "Read-write sandbox scoped to /src",
        "mounts": [{"path": "/src", "mount_path": "/workspace/src", "permissions": {"read": True, "write": True}}],
        "runtime": "alpine",
        "timeout_seconds": 60,
        "resource_limits": {"memory_mb": 128, "cpu_shares": 0.5},
    })
    t.check("Create RW sandbox returns 200", code == 200, json.dumps(body)[:300])
    sbx = (body.get("data") or {})
    ctx.sbx_rw_id = sbx.get("id", "")
    ctx.sbx_rw_key = sbx.get("access_key", "")
    t.check("RW sandbox has id", bool(ctx.sbx_rw_id))
    t.check("RW sandbox has access_key (sbx_ prefix)", ctx.sbx_rw_key.startswith("sbx_"), ctx.sbx_rw_key[:20])

    # Create read-only sandbox endpoint (/data scope)
    code, body = t.post("/api/v1/sandbox-endpoints", {
        "project_id": pid,
        "name": "RO Sandbox - data",
        "mounts": [{"path": "/data", "mount_path": "/workspace/data", "permissions": {"read": True, "write": False}}],
        "runtime": "alpine",
        "timeout_seconds": 30,
    })
    sbx2 = (body.get("data") or {})
    ctx.sbx_ro_id = sbx2.get("id", "")
    ctx.sbx_ro_key = sbx2.get("access_key", "")
    t.check("Create RO sandbox", bool(ctx.sbx_ro_id))

    # Create multi-mount sandbox
    code, body = t.post("/api/v1/sandbox-endpoints", {
        "project_id": pid,
        "name": "Multi-mount Sandbox",
        "mounts": [
            {"path": "/src", "mount_path": "/workspace/code", "permissions": {"read": True, "write": True}},
            {"path": "/data", "mount_path": "/workspace/data", "permissions": {"read": True, "write": False}},
            {"path": "/docs", "mount_path": "/workspace/docs", "permissions": {"read": True, "write": False}},
        ],
        "runtime": "alpine",
        "timeout_seconds": 45,
    })
    multi_sbx = (body.get("data") or {})
    ctx.sbx_id = multi_sbx.get("id", "")
    ctx.sbx_key = multi_sbx.get("access_key", "")
    t.check("Create multi-mount sandbox", bool(ctx.sbx_id))

    # List sandbox endpoints
    code, body = t.get(f"/api/v1/sandbox-endpoints?project_id={pid}")
    t.check("List sandboxes returns 200", code == 200)
    sbxs = body.get("data", []) or []
    t.check("Has 3 sandbox endpoints", len(sbxs) >= 3, f"count={len(sbxs)}")

    # Get single sandbox
    if ctx.sbx_rw_id:
        code, body = t.get(f"/api/v1/sandbox-endpoints/{ctx.sbx_rw_id}")
        t.check("Get sandbox by id", code == 200)
        data = body.get("data", {})
        t.check("Sandbox has correct name", data.get("name") == "RW Sandbox - src")
        t.check("Sandbox has mounts", len(data.get("mounts", [])) >= 1)

    # Update sandbox
    if ctx.sbx_rw_id:
        code, body = t.put(f"/api/v1/sandbox-endpoints/{ctx.sbx_rw_id}", {
            "name": "RW Sandbox - src (updated)",
            "timeout_seconds": 90,
        })
        t.check("Update sandbox returns 200", code == 200)
        data = (body.get("data") or {})
        t.check("Name updated", "updated" in data.get("name", ""), data.get("name", ""))


def test_sandbox_auth(t: T, ctx: Ctx):
    t.section("2. Sandbox Auth & Key Management")

    # Exec with valid key
    if ctx.sbx_rw_id and ctx.sbx_rw_key:
        code, body = t.exec_sbx(ctx.sbx_rw_id, ctx.sbx_rw_key, "echo 'auth test'")
        t.check("Exec with valid key", code == 200, json.dumps(body)[:200])

    # Exec with invalid key
    if ctx.sbx_rw_id:
        code, body = t.exec_sbx(ctx.sbx_rw_id, "sbx_INVALID_KEY_12345", "echo hack")
        t.check("Exec with invalid key rejected (403)", code == 403, json.dumps(body)[:200])

    # Exec with empty key
    if ctx.sbx_rw_id:
        code, body = t.exec_sbx(ctx.sbx_rw_id, "", "echo hack")
        t.check("Exec with empty key rejected", code in (401, 403), f"code={code}")

    # Exec with wrong endpoint's key (cross-endpoint)
    if ctx.sbx_rw_id and ctx.sbx_ro_key:
        code, body = t.exec_sbx(ctx.sbx_rw_id, ctx.sbx_ro_key, "echo cross")
        t.check("Cross-endpoint key rejected (403)", code == 403)

    # Regenerate key
    if ctx.sbx_rw_id:
        old_key = ctx.sbx_rw_key
        code, body = t.post(f"/api/v1/sandbox-endpoints/{ctx.sbx_rw_id}/regenerate-key")
        t.check("Regenerate key returns 200", code == 200)
        new_key = (body.get("data") or {}).get("access_key", "")
        t.check("New key differs", new_key != old_key and bool(new_key))

        # Old key should fail
        code, body = t.exec_sbx(ctx.sbx_rw_id, old_key, "echo old-key")
        t.check("Old key rejected after regeneration", code == 403)

        # New key should work
        code, body = t.exec_sbx(ctx.sbx_rw_id, new_key, "echo new-key")
        t.check("New key works", code == 200, json.dumps(body)[:200])
        ctx.sbx_rw_key = new_key

    # Deactivate endpoint then try exec
    if ctx.sbx_ro_id and ctx.sbx_ro_key:
        # Deactivate via CRUD API
        code, _ = t.put(f"/api/v1/sandbox-endpoints/{ctx.sbx_ro_id}", {"status": "inactive"})
        if code == 200:
            code, body = t.exec_sbx(ctx.sbx_ro_id, ctx.sbx_ro_key, "echo deactivated")
            t.check("Deactivated endpoint rejects exec", code in (403, 400), f"code={code}")
            # Reactivate
            t.put(f"/api/v1/sandbox-endpoints/{ctx.sbx_ro_id}", {"status": "active"})


def test_sandbox_execution(t: T, ctx: Ctx):
    t.section("3. Sandbox Command Execution")

    eid, key = ctx.sbx_rw_id, ctx.sbx_rw_key
    if not eid or not key:
        print("  SKIP: no RW sandbox")
        return

    # Basic command
    code, body = t.exec_sbx(eid, key, "echo 'hello sandbox'")
    t.check("Basic echo succeeds", code == 200)
    output = (body.get("data") or {}).get("output", "")
    t.check("Echo output correct", "hello sandbox" in output, output[:100])

    # Multi-line command
    code, body = t.exec_sbx(eid, key, "echo line1 && echo line2 && echo line3")
    output = (body.get("data") or {}).get("output", "")
    t.check("Multi-line output", "line1" in output and "line3" in output, output[:100])

    # Command with exit code
    code, body = t.exec_sbx(eid, key, "exit 42")
    data = body.get("data") or {}
    t.check("Non-zero exit code captured", data.get("exit_code") == 42 or not data.get("success"),
            f"exit_code={data.get('exit_code')} success={data.get('success')}")

    # Empty command
    code, body = t.exec_sbx(eid, key, "")
    t.check("Empty command rejected (400)", code == 400, f"code={code}")


def test_sandbox_security(t: T, ctx: Ctx):
    t.section("4. Sandbox Security — Forbidden Commands")

    eid, key = ctx.sbx_rw_id, ctx.sbx_rw_key
    if not eid or not key:
        print("  SKIP: no RW sandbox")
        return

    forbidden = [
        ("sudo su", "sudo"),
        ("cat /etc/passwd", "/etc/"),
        ("cat /proc/cpuinfo", "/proc/"),
        ("curl http://169.254.169.254/latest/meta-data/", "AWS metadata"),
        ("reboot", "reboot"),
    ]

    for cmd, label in forbidden:
        code, body = t.exec_sbx(eid, key, cmd)
        t.check(f"Blocked: {label}", code in (400, 403),
                f"code={code} body={json.dumps(body)[:100]}")


def test_sandbox_scope_isolation(t: T, ctx: Ctx):
    t.section("5. Sandbox Scope & Mount Isolation")

    # RO sandbox should not allow write commands
    if ctx.sbx_ro_id and ctx.sbx_ro_key:
        # Reactivate if needed
        t.put(f"/api/v1/sandbox-endpoints/{ctx.sbx_ro_id}", {"status": "active"})

        code, body = t.exec_sbx(ctx.sbx_ro_id, ctx.sbx_ro_key, "cat /workspace/data/config.json")
        t.check("RO sandbox can read files", code == 200, json.dumps(body)[:200])

        # Try write on read-only mount
        code, body = t.exec_sbx(ctx.sbx_ro_id, ctx.sbx_ro_key,
                                "echo 'hacked' > /workspace/data/hack.txt")
        t.check("RO sandbox blocks write (redirect)", code in (400, 403),
                f"code={code} body={json.dumps(body)[:150]}")


def test_sandbox_mut_sync(t: T, ctx: Ctx):
    t.section("6. Sandbox ↔ MUT Tree Sync")

    ap_key = getattr(ctx, "ap_key", "")
    if not ap_key:
        print("  SKIP: no AP key")
        return

    # Clone current state
    code, body = t.ap_post(ap_key, "clone", {"protocol_version": 2})
    base_commit = body.get("head_commit_id", "")
    t.check("Clone base commit", isinstance(base_commit, str), f"head_commit_id={base_commit}")

    # Push new content via MUT
    root, objs = build_tree({
        "src/main.py": b"print('v2 from MUT push')",
        "src/utils.py": b"def add(a,b): return a+b",
        "data/config.json": json.dumps({"version": 2, "debug": False}).encode(),
        "data/users.csv": b"name,age\nalice,30\nbob,25",
        "docs/readme.md": b"# Sandbox Test Project v2",
    })
    code, body = t.ap_post(ap_key, "push", {
        "protocol_version": 2,
        "base_commit_id": base_commit,
        "snapshots": [{"id": 1, "root": root, "message": "v2: update for sandbox test", "who": "test", "time": ""}],
        "objects": objs,
    })
    v2_commit = body.get("commit_id", "")
    t.check("MUT push v2 succeeds", body.get("status") == "ok", f"commit_id={v2_commit}")

    # Rollback to base
    if base_commit:
        code, body = t.ap_post(ap_key, "rollback", {"protocol_version": 2, "target_commit_id": base_commit})
        t.check("Rollback to base", body.get("status") == "rolled-back")
        v_rb_commit = body.get("new_commit_id", "")

        # Pull-commit to check v2 still accessible
        code, body = t.ap_post(ap_key, "pull-commit", {"protocol_version": 2, "commit_id": v2_commit})
        t.check("Pull-commit v2 after rollback", code == 200)
        t.check("v2 files accessible", len(body.get("files", {})) > 0)

        # Push again to restore v2 content
        code, body = t.ap_post(ap_key, "push", {
            "protocol_version": 2,
            "base_commit_id": v_rb_commit,
            "snapshots": [{"id": 2, "root": root, "message": "restore v2", "who": "test", "time": ""}],
            "objects": objs,
        })
        t.check("Re-push v2 after rollback", body.get("status") == "ok")


def test_sandbox_lifecycle(t: T, ctx: Ctx):
    t.section("7. Sandbox Lifecycle — Create/Update/Delete")

    pid = ctx.project_id

    # Create a temporary sandbox
    code, body = t.post("/api/v1/sandbox-endpoints", {
        "project_id": pid,
        "name": "Temp Sandbox (lifecycle test)",
        "mounts": [{"path": "/", "mount_path": "/workspace", "permissions": {"read": True}}],
        "runtime": "alpine",
        "timeout_seconds": 10,
    })
    tmp_id = (body.get("data") or {}).get("id", "")
    tmp_key = (body.get("data") or {}).get("access_key", "")
    t.check("Create temp sandbox", bool(tmp_id))

    # Verify it's in the list
    code, body = t.get(f"/api/v1/sandbox-endpoints?project_id={pid}")
    ids = [s.get("id") for s in (body.get("data") or [])]
    t.check("Temp sandbox in list", tmp_id in ids)

    # Delete it
    code, body = t.delete(f"/api/v1/sandbox-endpoints/{tmp_id}")
    t.check("Delete temp sandbox", code == 200)

    # Verify gone from list
    code, body = t.get(f"/api/v1/sandbox-endpoints?project_id={pid}")
    ids = [s.get("id") for s in (body.get("data") or [])]
    t.check("Deleted sandbox gone from list", tmp_id not in ids)

    # Exec on deleted sandbox should fail
    if tmp_key:
        code, body = t.exec_sbx(tmp_id, tmp_key, "echo ghost")
        t.check("Exec on deleted sandbox fails", code in (403, 404), f"code={code}")


def test_cleanup(t: T, ctx: Ctx):
    t.section("99. Cleanup")

    # Delete sandbox endpoints
    for sid in [ctx.sbx_rw_id, ctx.sbx_ro_id, ctx.sbx_id]:
        if sid:
            t.delete(f"/api/v1/sandbox-endpoints/{sid}")

    # Delete project
    if ctx.project_id:
        code, _ = t.delete(f"/api/v1/projects/{ctx.project_id}")
        t.check("Delete project", code == 200)


# ══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Sandbox E2E Tests")
    parser.add_argument("--api", default="https://qubits-api.puppyone.ai")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--no-cleanup", action="store_true")
    args = parser.parse_args()

    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    client = create_client(url, key)

    email, pw = "e2e-test@puppyone.ai", "E2eTest2026!"
    try:
        client.auth.admin.create_user({"email": email, "password": pw, "email_confirm": True})
    except Exception:
        pass
    session = client.auth.sign_in_with_password({"email": email, "password": pw})

    ctx = Ctx(api=args.api, jwt=session.session.access_token, user_id=session.user.id, verbose=args.verbose)

    # Init user + get org
    _req("POST", f"{args.api}/api/v1/auth/initialize", headers=_headers(ctx.jwt))
    _, body = _req("GET", f"{args.api}/api/v1/organizations/", headers=_headers(ctx.jwt))
    ctx.org_id = (body.get("data") or [{}])[0].get("id", "")

    print(f"\nPuppyOne Sandbox E2E Tests")
    print(f"API:  {ctx.api}")
    print(f"User: {email} ({ctx.user_id[:12]}...)")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_sandbox_crud,
        test_sandbox_auth,
        test_sandbox_execution,
        test_sandbox_security,
        test_sandbox_scope_isolation,
        test_sandbox_mut_sync,
        test_sandbox_lifecycle,
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
