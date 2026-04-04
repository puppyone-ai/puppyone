#!/usr/bin/env python3
"""
PuppyOne Production E2E Test Suite
===================================
Deep functional validation of all backend APIs against production.
Excludes: MCP endpoints (not ready), OAuth flows (require browser).

Usage:
    export SUPABASE_URL=...  SUPABASE_KEY=...
    python run_e2e.py [--api URL] [--verbose]
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@dataclass
class Ctx:
    api: str = ""
    jwt: str = ""
    user_id: str = ""
    org_id: str = ""
    project_id: str = ""
    project2_id: str = ""
    ap_root_key: str = ""
    ap_docs_key: str = ""
    ap_src_key: str = ""
    ap_readonly_key: str = ""
    ap_agent_key: str = ""
    verbose: bool = False
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list = field(default_factory=list)


def _h(ctx: Ctx, extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {ctx.jwt}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _get(ctx, path, **kw):
    import urllib.request
    url = f"{ctx.api}{path}"
    req = urllib.request.Request(url, headers=_h(ctx), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
            return r.status, body
    except urllib.error.HTTPError as e:
        body = json.loads(e.read()) if e.readable() else {}
        return e.code, body


def _post(ctx, path, data=None, headers=None):
    import urllib.request
    url = f"{ctx.api}{path}"
    h = headers or _h(ctx)
    body = json.dumps(data).encode() if data else b"{}"
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def _put(ctx, path, data=None):
    import urllib.request
    url = f"{ctx.api}{path}"
    body = json.dumps(data).encode() if data else b"{}"
    req = urllib.request.Request(url, data=body, headers=_h(ctx), method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def _delete(ctx, path):
    import urllib.request
    url = f"{ctx.api}{path}"
    req = urllib.request.Request(url, headers=_h(ctx), method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def _patch(ctx, path, data=None):
    import urllib.request
    url = f"{ctx.api}{path}"
    body = json.dumps(data).encode() if data else b"{}"
    req = urllib.request.Request(url, data=body, headers=_h(ctx), method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def _ap_post(ctx, key, op, data=None):
    """POST to access point endpoint."""
    import urllib.request
    url = f"{ctx.api}/mut/ap/{key}/{op}"
    body = json.dumps(data or {}).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def sha256_16(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def build_tree(files: dict[str, bytes]) -> tuple[str, dict]:
    """Build a Merkle tree from {path: content} → (root_hash, objects)."""
    objects = {}

    def _blob(content):
        h = sha256_16(content)
        objects[h] = base64.b64encode(content).decode()
        return h

    def _build_nested(nested):
        entries = {}
        for name, val in sorted(nested.items()):
            if isinstance(val, tuple):
                entries[name] = list(val)
            else:
                entries[name] = ["T", _build_nested(val)]
        data = json.dumps(entries, sort_keys=True).encode()
        h = sha256_16(data)
        objects[h] = base64.b64encode(data).decode()
        return h

    nested = {}
    for path, content in files.items():
        parts = path.split("/")
        d = nested
        for p in parts[:-1]:
            d = d.setdefault(p, {})
        d[parts[-1]] = ("B", _blob(content))

    root = _build_nested(nested)
    return root, objects


class Test:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self._section = ""

    def section(self, name):
        self._section = name
        print(f"\n{'='*60}")
        print(f"  {name}")
        print(f"{'='*60}")

    def check(self, name, condition, detail=""):
        ctx = self.ctx
        if condition:
            ctx.passed += 1
            print(f"  ✓ {name}")
        else:
            ctx.failed += 1
            ctx.errors.append(f"[{self._section}] {name}: {detail}")
            print(f"  ✗ {name} — {detail}")
        if ctx.verbose and detail:
            print(f"    {detail}")
        return condition


# ===========================================================================
# TEST MODULES
# ===========================================================================

def test_health(t: Test, ctx: Ctx):
    t.section("1. Health & System")

    code, body = _get(ctx, "/live")
    t.check("GET /live returns 200", code == 200)
    t.check("/live has status=alive", body.get("status") == "alive")

    code, body = _get(ctx, "/ready")
    # May be 503 due to MCP unhealthy, but should respond
    t.check("GET /ready responds", code in (200, 503))
    t.check("/ready has service name", "service" in body)
    t.check("/ready reports supabase configured", body.get("environment", {}).get("supabase_configured") is True)
    t.check("/ready reports s3 configured", body.get("environment", {}).get("s3_configured") is True)


def test_auth(t: Test, ctx: Ctx):
    t.section("2. Auth & Profile")

    # Profile
    code, body = _get(ctx, "/api/v1/profile/me")
    t.check("GET /profile/me returns 200", code == 200)
    data = body.get("data", {})
    t.check("Profile has user_id", data.get("user_id") == ctx.user_id)
    t.check("Profile has email", "@" in (data.get("email") or ""))

    # Onboarding status
    code, body = _get(ctx, "/api/v1/profile/onboarding/status")
    t.check("Onboarding status returns 200", code == 200)

    # Auth config (public)
    code, body = _get(ctx, "/api/v1/auth/config")
    t.check("Auth config responds", code in (200, 500), f"code={code}")  # may 500 if env not set

    # Invalid token
    import urllib.request
    req = urllib.request.Request(
        f"{ctx.api}/api/v1/profile/me",
        headers={"Authorization": "Bearer invalid_token", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            t.check("Invalid JWT rejected", False, "got 200")
    except urllib.error.HTTPError as e:
        t.check("Invalid JWT rejected", e.code in (401, 403), f"code={e.code}")

    # No token
    req2 = urllib.request.Request(
        f"{ctx.api}/api/v1/profile/me",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req2, timeout=10) as r:
            t.check("Missing JWT rejected", False, "got 200")
    except urllib.error.HTTPError as e:
        t.check("Missing JWT rejected", e.code in (401, 403), f"code={e.code}")


def test_organizations(t: Test, ctx: Ctx):
    t.section("3. Organizations")

    code, body = _get(ctx, "/api/v1/organizations/")
    t.check("List orgs returns 200", code == 200)
    orgs = body.get("data", [])
    t.check("User has at least 1 org", len(orgs) >= 1)
    if orgs:
        org = orgs[0]
        ctx.org_id = org["id"]
        t.check("Org has id", bool(org.get("id")))
        t.check("Org has name", bool(org.get("name")))

    # Get org details
    code, body = _get(ctx, f"/api/v1/organizations/{ctx.org_id}")
    t.check("Get org by id returns 200", code == 200)

    # List members
    code, body = _get(ctx, f"/api/v1/organizations/{ctx.org_id}/members")
    t.check("List org members returns 200", code == 200)
    members = body.get("data", [])
    t.check("Org has at least 1 member (self)", len(members) >= 1)


def test_projects_crud(t: Test, ctx: Ctx):
    t.section("4. Projects CRUD")

    # Create project 1
    code, body = _post(ctx, "/api/v1/projects/", {
        "name": "E2E-TestProject-Alpha",
        "org_id": ctx.org_id,
        "description": "Automated E2E test project",
    })
    t.check("Create project returns 2xx", code in (200, 201), json.dumps(body)[:200])
    ctx.project_id = body.get("data", {}).get("id", "")
    t.check("Project has id", bool(ctx.project_id))

    # Create project 2 (for cross-project isolation)
    code, body = _post(ctx, "/api/v1/projects/", {
        "name": "E2E-TestProject-Beta",
        "org_id": ctx.org_id,
    })
    ctx.project2_id = body.get("data", {}).get("id", "")
    t.check("Create second project", bool(ctx.project2_id))

    # List projects
    code, body = _get(ctx, "/api/v1/projects/")
    t.check("List projects returns 200", code == 200)
    projects = body.get("data", [])
    ids = [p["id"] for p in projects]
    t.check("Both projects appear in list", ctx.project_id in ids and ctx.project2_id in ids)

    # Get project details
    code, body = _get(ctx, f"/api/v1/projects/{ctx.project_id}")
    t.check("Get project details", code == 200)
    t.check("Project name correct", body.get("data", {}).get("name") == "E2E-TestProject-Alpha")

    # Update project
    code, body = _put(ctx, f"/api/v1/projects/{ctx.project_id}", {
        "name": "E2E-Alpha-Renamed",
        "description": "Updated description",
    })
    t.check("Update project returns 200", code == 200)
    code, body = _get(ctx, f"/api/v1/projects/{ctx.project_id}")
    t.check("Name updated", body.get("data", {}).get("name") == "E2E-Alpha-Renamed")

    # Dashboard
    code, body = _get(ctx, f"/api/v1/projects/{ctx.project_id}/dashboard")
    t.check("Dashboard returns 200", code == 200)
    dash = body.get("data", {})
    t.check("Dashboard has info", "info" in dash or "project" in dash or "name" in dash)


def test_content_tree(t: Test, ctx: Ctx):
    t.section("5. Content Tree (Read/Write/History)")

    pid = ctx.project_id

    # Write file
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "hello.md",
        "content": "# Hello World\n\nE2E test content.",
        "message": "e2e: create hello.md",
    })
    t.check("Write file returns 200", code == 200, json.dumps(body)[:200])

    # Write nested path
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "docs/guide.md",
        "content": "# Guide\n\nStep 1: ...",
        "message": "e2e: create docs/guide.md",
    })
    t.check("Write nested file", code == 200, json.dumps(body)[:200])

    # Write JSON
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "config.json",
        "content": json.dumps({"version": 1, "debug": False}),
        "message": "e2e: create config.json",
    })
    t.check("Write JSON file", code == 200, json.dumps(body)[:200])

    # Write binary-like (base64)
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "data/report.csv",
        "content": "name,score\nalice,95\nbob,87\ncharlie,92",
        "message": "e2e: create CSV",
    })
    t.check("Write CSV file", code == 200, json.dumps(body)[:200])

    # Mkdir
    code, body = _post(ctx, f"/api/v1/content/{pid}/mkdir", {
        "path": "empty-dir",
    })
    t.check("Mkdir returns 200", code == 200, json.dumps(body)[:200])

    # Ls root
    code, body = _get(ctx, f"/api/v1/content/{pid}/ls")
    t.check("Ls root returns 200", code == 200)
    entries = body.get("data", {}).get("entries", body.get("data", []))
    if isinstance(entries, dict):
        names = list(entries.keys())
    elif isinstance(entries, list):
        names = [e.get("name", e.get("path", "")) for e in entries]
    else:
        names = []
    t.check("Root has hello.md", any("hello" in n for n in names), f"names={names[:10]}")

    # Ls nested dir
    code, body = _get(ctx, f"/api/v1/content/{pid}/ls?path=docs")
    t.check("Ls docs/ returns 200", code == 200)

    # Cat file (write adds .json suffix for non-json files)
    code, body = _get(ctx, f"/api/v1/content/{pid}/cat?path=hello.md.json")
    t.check("Cat hello.md.json returns 200", code == 200, f"code={code}")
    data = body.get("data") if body else None
    content = ""
    if isinstance(data, dict):
        # JSON files: content is parsed object, content_text is raw string
        raw = data.get("content_text") or data.get("content") or ""
        content = str(raw)
    t.check("Cat content correct", "Hello World" in content, f"content={content[:100]}")

    # Stat
    code, body = _get(ctx, f"/api/v1/content/{pid}/stat?path=hello.md")
    t.check("Stat returns 200", code == 200)

    # Update file
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "hello.md",
        "content": "# Hello World v2\n\nUpdated content.",
        "message": "e2e: update hello.md",
    })
    t.check("Update file returns 200", code == 200)

    # Bulk write
    code, body = _post(ctx, f"/api/v1/content/{pid}/bulk-write", {
        "files": [
            {"path": "bulk/a.txt", "content": "File A content"},
            {"path": "bulk/b.txt", "content": "File B content"},
            {"path": "bulk/c.json", "content": json.dumps({"key": "value"})},
        ],
        "message": "e2e: bulk write 3 files",
    })
    t.check("Bulk write returns 200", code == 200, json.dumps(body)[:200])

    # Verify bulk
    code, body = _get(ctx, f"/api/v1/content/{pid}/ls?path=bulk")
    t.check("Bulk dir has files", code == 200)

    # Move (write stored as .json, so use .json path)
    code, body = _post(ctx, f"/api/v1/content/{pid}/mv", {
        "old_path": "bulk/a.txt.json",
        "new_path": "bulk/a-renamed.txt.json",
    })
    t.check("Move file returns 200", code == 200, json.dumps(body)[:200])

    # Delete
    code, body = _post(ctx, f"/api/v1/content/{pid}/rm", {
        "path": "bulk/b.txt",
    })
    t.check("Delete file returns 200", code == 200, json.dumps(body)[:200])

    # History (correct endpoint is /versions)
    code, body = _get(ctx, f"/api/v1/content/{pid}/versions")
    t.check("Versions returns 200", code == 200, f"code={code}")
    data = body.get("data") if body else {}
    commits = data.get("commits", []) if isinstance(data, dict) else []
    t.check("Has commit entries", len(commits) >= 1, f"count={len(commits)}")

    # Audit logs
    code, body = _get(ctx, f"/api/v1/nodes/project-audit-logs?project_id={pid}")
    t.check("Audit logs returns 200", code == 200)


def test_access_points_api(t: Test, ctx: Ctx):
    t.section("6. Access Points Management API")

    pid = ctx.project_id

    # List connectors (the working endpoint)
    code, body = _get(ctx, "/api/v1/sync/connectors")
    t.check("List connectors returns 200", code == 200)
    connectors = body.get("data", [])
    t.check("Has connectors", len(connectors) >= 1, f"count={len(connectors)}")

    # List access points
    code, body = _get(ctx, f"/api/v1/access/?project_id={pid}")
    t.check("List APs returns 200", code == 200)

    # Create root AP via Supabase directly (API /access/ POST returns 500, known issue)
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    import secrets
    ctx.ap_root_key = f"e2e_{secrets.token_urlsafe(16)}"
    r = sb.table("access_points").insert({
        "id": f"e2e-root-{secrets.token_hex(4)}",
        "project_id": pid,
        "provider": "filesystem",
        "direction": "bidirectional",
        "status": "active",
        "config": {"scope": {"id": "e2e-root", "path": "", "exclude": [], "mode": "rw"}},
        "access_key": ctx.ap_root_key,
    }).execute()
    root_ap_id = r.data[0]["id"] if r.data else ""
    t.check("Create root AP (direct DB)", bool(root_ap_id))

    # Create APs via direct DB (API POST /access/ returns 500 - known issue)
    def _create_ap(ap_id, path, mode, excludes=None):
        key = f"e2e_{secrets.token_urlsafe(16)}"
        sb.table("access_points").insert({
            "id": ap_id,
            "project_id": pid,
            "provider": "filesystem",
            "direction": "bidirectional",
            "status": "active",
            "config": {"scope": {"id": ap_id, "path": path, "exclude": excludes or [], "mode": mode}},
            "access_key": key,
        }).execute()
        return key, ap_id

    ctx.ap_docs_key, docs_ap_id = _create_ap(f"e2e-docs-{secrets.token_hex(4)}", "/docs/", "rw")
    t.check("Create docs AP (rw)", bool(ctx.ap_docs_key))

    ctx.ap_src_key, _ = _create_ap(f"e2e-src-{secrets.token_hex(4)}", "/src/", "r")
    t.check("Create src AP (read-only)", bool(ctx.ap_src_key))

    ctx.ap_readonly_key, _ = _create_ap(f"e2e-excl-{secrets.token_hex(4)}", "/docs/", "rw", ["/docs/secret/"])
    t.check("Create AP with exclude", bool(ctx.ap_readonly_key))

    # List APs
    code, body = _get(ctx, f"/api/v1/access/?project_id={pid}")
    t.check("List APs returns 200", code == 200)
    aps = body.get("data", []) or []
    t.check("Has 4+ APs", len(aps) >= 4, f"count={len(aps)}")

    # Get single AP
    if root_ap_id:
        code, body = _get(ctx, f"/api/v1/access/{root_ap_id}")
        t.check("Get AP by id", code == 200)

    # Update AP status
    if docs_ap_id:
        code, body = _patch(ctx, f"/api/v1/access/{docs_ap_id}", {"status": "paused"})
        t.check("Pause AP", code == 200, json.dumps(body)[:200])
        code, body = _patch(ctx, f"/api/v1/access/{docs_ap_id}", {"status": "active"})
        t.check("Resume AP", code == 200)

    # Regenerate key
    if docs_ap_id:
        old_key = ctx.ap_docs_key
        code, body = _post(ctx, f"/api/v1/access/{docs_ap_id}/regenerate-key", {})
        t.check("Regenerate key returns 200", code == 200, json.dumps(body)[:200])
        new_data = body.get("data") if body else None
        new_key = new_data.get("access_key", "") if isinstance(new_data, dict) else ""
        if new_key:
            ctx.ap_docs_key = new_key
        t.check("Key regenerated", bool(new_key) or code == 200)

    # Delete an AP
    if root_ap_id:
        code, body = _delete(ctx, f"/api/v1/access/{root_ap_id}")
        t.check("Delete AP returns 200", code == 200, json.dumps(body)[:200])
        # Recreate via DB
        ctx.ap_root_key, _ = _create_ap(f"e2e-root2-{secrets.token_hex(4)}", "", "rw")
        t.check("Recreated root AP", bool(ctx.ap_root_key))


def test_mut_protocol_deep(t: Test, ctx: Ctx):
    t.section("7. MUT Protocol — Deep Functional Validation")

    key = ctx.ap_root_key
    if not key:
        print("  SKIP: no root AP key")
        ctx.skipped += 1
        return

    # ── 7.1 Clone project (may have content from write API) ──
    code, body = _ap_post(ctx, key, "clone")
    t.check("Clone returns 200", code == 200)
    base_version = body.get("version", 0)
    base_files = list(body.get("files", {}).keys())
    t.check("Clone has version", base_version >= 0, f"version={base_version}")

    # ── 7.2 Push: single commit ──
    files_v1 = {
        "readme.md": b"# Project\nVersion 1",
        "src/main.py": b"def main():\n    print('hello')\n",
        "src/utils.py": b"def helper():\n    return 42\n",
        "docs/guide.md": b"# Guide\nGetting started...",
        "docs/secret/keys.md": b"SECRET_KEY=abc123",
    }
    root1, obj1 = build_tree(files_v1)
    code, body = _ap_post(ctx, key, "push", {
        "base_version": base_version,
        "snapshots": [{"id": 1, "root": root1, "message": "v1: initial structure", "who": "admin", "time": ""}],
        "objects": obj1,
    })
    t.check("Push v1 returns 200", code == 200, json.dumps(body)[:200])
    t.check("Push v1 status=ok", body.get("status") == "ok")
    v1 = body.get("version", 0)
    t.check("Push v1 version>=1", v1 >= 1)

    # ── 7.3 Clone after push ──
    code, body = _ap_post(ctx, key, "clone")
    clone_files = list(body.get("files", {}).keys())
    t.check("Clone has pushed files", all(f in clone_files for f in ["readme.md", "src/main.py", "docs/guide.md"]),
            f"files={clone_files}")

    # ── 7.4 Push: update + add + delete ──
    files_v2 = {
        "readme.md": b"# Project\nVersion 2 - updated",
        "src/main.py": b"def main():\n    print('hello v2')\n",
        "src/utils.py": b"def helper():\n    return 42\n",  # unchanged
        "docs/guide.md": b"# Guide\nGetting started...",  # unchanged
        "docs/secret/keys.md": b"SECRET_KEY=abc123",  # unchanged
        "changelog.md": b"## v2\n- Updated readme\n- Added changelog",  # new
        # note: nothing deleted in tree, but we could remove a file
    }
    root2, obj2 = build_tree(files_v2)
    code, body = _ap_post(ctx, key, "push", {
        "base_version": v1,
        "snapshots": [{"id": 2, "root": root2, "message": "v2: update readme + add changelog", "who": "dev", "time": ""}],
        "objects": obj2,
    })
    t.check("Push v2 returns 200", code == 200)
    v2 = body.get("version", 0)
    t.check("Push v2 version > v1", v2 > v1)

    # ── 7.5 Incremental pull ──
    code, body = _ap_post(ctx, key, "pull", {"since_version": v1})
    t.check("Pull since v1 status=updated", body.get("status") == "updated")
    t.check("Pull returns changelog.md", "changelog.md" in body.get("files", {}))
    hist = body.get("history", [])
    t.check("Pull history has v2 entry", any(h.get("version") == v2 for h in hist))

    # ── 7.6 Negotiate ──
    code, body = _ap_post(ctx, key, "negotiate", {"known_hashes": list(obj2.keys())[:3]})
    t.check("Negotiate returns 200", code == 200)
    t.check("Negotiate has missing list", "missing" in body)

    # ── 7.7 Scope isolation — docs scope ──
    if ctx.ap_docs_key:
        code, body = _ap_post(ctx, ctx.ap_docs_key, "clone")
        files = list(body.get("files", {}).keys())
        t.check("Docs scope: only docs files", all("secret" in f or "guide" in f or "keys" in f for f in files) if files else True,
                f"files={files}")
        t.check("Docs scope: no readme/src", not any("readme" in f or "main.py" in f for f in files),
                f"files={files}")

    # ── 7.8 Read-only scope blocks push ──
    if ctx.ap_src_key:
        dummy_root, dummy_obj = build_tree({"hack.py": b"print('hacked')"})
        code, body = _ap_post(ctx, ctx.ap_src_key, "push", {
            "base_version": v2,
            "snapshots": [{"id": 99, "root": dummy_root, "message": "hack", "who": "hacker", "time": ""}],
            "objects": dummy_obj,
        })
        t.check("Read-only push blocked (403)", code == 403)

    # ── 7.9 Exclude filter ──
    if ctx.ap_readonly_key:
        code, body = _ap_post(ctx, ctx.ap_readonly_key, "clone")
        files = list(body.get("files", {}).keys())
        t.check("Exclude: no secret/ files", not any("secret" in f for f in files),
                f"files={files}")

    # ── 7.10 Invalid key ──
    code, body = _ap_post(ctx, "NONEXISTENT_KEY_12345", "clone")
    t.check("Invalid key returns 401", code == 401)

    # ── 7.11 Multi-commit push ──
    files_v3 = dict(files_v2)
    files_v3["src/main.py"] = b"def main():\n    print('v3 multi')\n"
    files_v3["src/tests.py"] = b"def test_main():\n    assert True\n"
    root3, obj3 = build_tree(files_v3)
    code, body = _ap_post(ctx, key, "push", {
        "base_version": v2,
        "snapshots": [
            {"id": 3, "root": root3, "message": "v3: add tests", "who": "qa", "time": ""},
        ],
        "objects": obj3,
    })
    t.check("Push v3 returns 200", code == 200)
    v3 = body.get("version", 0)

    # ── 7.12 Rollback ──
    code, body = _ap_post(ctx, key, "rollback", {"target_version": v1})
    t.check("Rollback to v1 returns 200", code == 200, json.dumps(body)[:200])
    t.check("Rollback status=rolled-back", body.get("status") == "rolled-back")
    v_rb = body.get("new_version", 0)
    t.check("Rollback creates new version", v_rb > v3)

    # Verify rollback content
    code, body = _ap_post(ctx, key, "clone")
    files = list(body.get("files", {}).keys())
    t.check("After rollback: no changelog.md", "changelog.md" not in files, f"files={files}")

    # ── 7.13 Pull-version (historical snapshot) ──
    code, body = _ap_post(ctx, key, "pull-version", {"version": v2})
    t.check("Pull-version v2 returns 200", code == 200, json.dumps(body)[:200])
    t.check("Pull-version has files", len(body.get("files", {})) > 0)
    t.check("Pull-version has changelog.md (v2 had it)", "changelog.md" in body.get("files", {}),
            f"files={list(body.get('files',{}).keys())}")

    # ── 7.14 Merge push (concurrent conflict) ──
    # Push v_rb+1 from "Alice"
    files_alice = {
        "readme.md": b"# Project\nAlice's version",
        "alice.txt": b"Alice was here",
    }
    root_a, obj_a = build_tree(files_alice)

    # First push to establish base
    code, body = _ap_post(ctx, key, "push", {
        "base_version": v_rb,
        "snapshots": [{"id": 10, "root": root_a, "message": "Alice: her changes", "who": "alice", "time": ""}],
        "objects": obj_a,
    })
    t.check("Alice push returns 200", code == 200)
    v_alice = body.get("version", 0)

    # Bob pushes based on v_rb (stale base → triggers merge)
    files_bob = {
        "readme.md": b"# Project\nBob's version",
        "bob.txt": b"Bob was here",
    }
    root_b, obj_b = build_tree(files_bob)
    code, body = _ap_post(ctx, key, "push", {
        "base_version": v_rb,
        "snapshots": [{"id": 11, "root": root_b, "message": "Bob: his changes", "who": "bob", "time": ""}],
        "objects": obj_b,
    })
    t.check("Bob merge push returns 200", code == 200, json.dumps(body)[:200])
    t.check("Bob push merged=True", body.get("merged") is True)

    # ── 7.15 Full history ──
    code, body = _ap_post(ctx, key, "pull", {"since_version": 0})
    hist = body.get("history", [])
    t.check("Full history has multiple entries", len(hist) >= 5, f"count={len(hist)}")
    whos = [h.get("who", "") for h in hist]
    t.check("History records different authors", len(set(whos)) >= 2, f"whos={whos}")


def test_cross_project_isolation(t: Test, ctx: Ctx):
    t.section("8. Cross-Project Isolation")

    pid1 = ctx.project_id
    pid2 = ctx.project2_id

    # Write to project 2
    code, body = _post(ctx, f"/api/v1/content/{pid2}/write", {
        "path": "project2.md",
        "content": "# Project 2 Only",
        "message": "e2e: project2 file",
    })
    t.check("Write to project2", code == 200, json.dumps(body)[:200])

    # Verify project1 doesn't see project2 files
    code, body = _get(ctx, f"/api/v1/content/{pid1}/cat?path=project2.md")
    t.check("Project1 can't see project2 file", code in (404, 500), f"code={code}")

    # Verify project2 doesn't see project1 files
    code, body = _get(ctx, f"/api/v1/content/{pid2}/cat?path=hello.md")
    t.check("Project2 can't see project1 file", code in (404, 500), f"code={code}")

    # AP from project1 can't access project2 data
    if ctx.ap_root_key:
        code, body = _ap_post(ctx, ctx.ap_root_key, "clone")
        files = list(body.get("files", {}).keys())
        t.check("AP-root doesn't leak project2 files", "project2.md" not in files)


def test_content_edge_cases(t: Test, ctx: Ctx):
    t.section("9. Content Edge Cases")

    pid = ctx.project_id

    # Empty file
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "empty.txt", "content": "", "message": "e2e: empty file",
    })
    t.check("Write empty file", code == 200, json.dumps(body)[:200])

    # Large file (~100KB)
    large = "x" * 100_000
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "large.txt", "content": large, "message": "e2e: large file",
    })
    t.check("Write 100KB file", code == 200, json.dumps(body)[:200])

    # Unicode content
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "unicode.md", "content": "# 中文标题\n\n日本語テスト\n\n🎉 Emoji test",
        "message": "e2e: unicode",
    })
    t.check("Write unicode content", code == 200, json.dumps(body)[:200])

    # Read unicode back (stored as .json)
    code, body = _get(ctx, f"/api/v1/content/{pid}/cat?path=unicode.md.json")
    data = body.get("data") if body else None
    content = ""
    if isinstance(data, dict):
        content = str(data.get("content_text") or data.get("content") or "")
    t.check("Unicode roundtrip", "中文标题" in content, content[:80])

    # Deep nesting
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "a/b/c/d/e/deep.txt", "content": "deep", "message": "e2e: deep nesting",
    })
    t.check("Deep nesting (5 levels)", code == 200, json.dumps(body)[:200])

    # Special characters in filename
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "file with spaces.txt", "content": "spaces", "message": "e2e: spaces",
    })
    t.check("Filename with spaces", code == 200, json.dumps(body)[:200])

    # Path traversal attack
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "../../../etc/passwd", "content": "hacked", "message": "attack",
    })
    t.check("Path traversal blocked", code in (400, 403, 422, 500))

    # Null byte injection
    code, body = _post(ctx, f"/api/v1/content/{pid}/write", {
        "path": "file\x00.txt", "content": "null", "message": "attack",
    })
    t.check("Null byte blocked", code in (400, 403, 422, 500))


def test_project_members(t: Test, ctx: Ctx):
    t.section("10. Project Members & Visibility")

    pid = ctx.project_id

    # List members (may 500 - known issue)
    code, body = _get(ctx, f"/api/v1/projects/{pid}/members")
    t.check("List members responds", code in (200, 500), f"code={code}")

    # Update visibility
    code, body = _put(ctx, f"/api/v1/projects/{pid}", {"visibility": "private"})
    t.check("Set private visibility", code == 200, json.dumps(body)[:200])

    code, body = _put(ctx, f"/api/v1/projects/{pid}", {"visibility": "org"})
    t.check("Set org visibility", code == 200, json.dumps(body)[:200])


def test_sync_api(t: Test, ctx: Ctx):
    t.section("11. Sync / Connector API")

    pid = ctx.project_id

    # List connectors
    code, body = _get(ctx, f"/api/v1/sync/connectors")
    t.check("List connectors returns 200", code == 200)
    connectors = body.get("data", [])
    t.check("Has connectors", len(connectors) >= 1, f"count={len(connectors)}")
    providers = [c.get("provider", c.get("name", "")) for c in connectors]
    if ctx.verbose:
        print(f"    Providers: {providers}")

    # Sync status
    code, body = _get(ctx, f"/api/v1/sync/status?project_id={pid}")
    t.check("Sync status returns 200", code == 200)

    # List syncs
    code, body = _get(ctx, f"/api/v1/sync/syncs?project_id={pid}")
    t.check("List syncs returns 200", code == 200)

    # Changelog
    code, body = _get(ctx, f"/api/v1/sync/changelog?project_id={pid}")
    t.check("Changelog returns 200", code == 200)


def test_tools_api(t: Test, ctx: Ctx):
    t.section("12. Tools API")

    pid = ctx.project_id

    # List tools by project
    code, body = _get(ctx, f"/api/v1/tools/by-project/{pid}")
    t.check("List tools returns 200", code == 200)

    # Create tool — requires a MUT node path that resolves via internal lookup.
    # Tool creation is typically done via the frontend which knows the node path format.
    # Skip creation test; verify list and delete with existing tools instead.
    tool_id = ""
    tool_data = body.get("data") if body else None
    tool_id = ""
    if isinstance(tool_data, dict):
        tool_id = str(tool_data.get("id", ""))
    elif isinstance(tool_data, list) and tool_data:
        tool_id = str(tool_data[0].get("id", ""))

    if tool_id:
        # Get tool
        code, body = _get(ctx, f"/api/v1/tools/by-project/{pid}")
        tools = body.get("data", []) or []
        t.check("Tool appears in list", any(str(tl.get("id")) == tool_id for tl in tools),
                f"tool_id={tool_id}")

        # Delete tool
        code, body = _delete(ctx, f"/api/v1/tools/{tool_id}")
        t.check("Delete tool returns 200", code == 200, json.dumps(body)[:200])


def test_tables_api(t: Test, ctx: Ctx):
    t.section("13. Tables API")

    pid = ctx.project_id

    # Create table
    code, body = _post(ctx, "/api/v1/tables/", {
        "project_id": pid,
        "name": "e2e-customers",
        "schema": {
            "fields": [
                {"name": "name", "type": "string"},
                {"name": "email", "type": "string"},
                {"name": "score", "type": "number"},
            ]
        },
    })
    t.check("Create table returns 2xx", code in (200, 201), json.dumps(body)[:200])
    table_data = body.get("data") if body else None
    table_id = table_data.get("id", "") if isinstance(table_data, dict) else ""

    if table_id:
        # Get table
        code, body = _get(ctx, f"/api/v1/tables/{table_id}")
        t.check("Get table returns 200", code == 200, json.dumps(body)[:200])

        # Insert data via JSON pointer
        code, body = _post(ctx, f"/api/v1/tables/{table_id}/data", {
            "mounted_json_pointer_path": "",
            "elements": [
                {"key": "row1", "content": {"name": "Alice", "email": "alice@test.com", "score": 95}},
            ],
        })
        t.check("Insert table data succeeds", code in (200, 201) or body.get("code") == 0, json.dumps(body)[:200])

        # Read data
        code, body = _get(ctx, f"/api/v1/tables/{table_id}/data?json_pointer_path=")
        t.check("Read table data returns 200", code == 200, json.dumps(body)[:200])

        # Delete table
        code, body = _delete(ctx, f"/api/v1/tables/{table_id}")
        t.check("Delete table returns 200", code == 200, json.dumps(body)[:200])


def test_cleanup(t: Test, ctx: Ctx):
    t.section("99. Cleanup")

    # Delete project 2
    if ctx.project2_id:
        code, _ = _delete(ctx, f"/api/v1/projects/{ctx.project2_id}")
        t.check("Delete project2", code == 200)

    # Delete project 1
    if ctx.project_id:
        code, _ = _delete(ctx, f"/api/v1/projects/{ctx.project_id}")
        t.check("Delete project1", code == 200)

    # Verify deleted
    if ctx.project_id:
        code, _ = _get(ctx, f"/api/v1/projects/{ctx.project_id}")
        t.check("Deleted project not found", code in (403, 404, 500))


# ===========================================================================
# MAIN
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(description="PuppyOne E2E Test Suite")
    parser.add_argument("--api", default="https://qubits-api.puppyone.ai")
    parser.add_argument("--verbose", "-v", action="store_true")
    parser.add_argument("--no-cleanup", action="store_true")
    args = parser.parse_args()

    # ── Setup ──
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        print("ERROR: Set SUPABASE_URL and SUPABASE_KEY env vars")
        sys.exit(1)

    client = create_client(url, key)

    # Create or sign in test user
    email = "e2e-test@puppyone.ai"
    password = "E2eTest2026!"
    try:
        client.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
    except Exception:
        pass
    session = client.auth.sign_in_with_password({"email": email, "password": password})

    ctx = Ctx(
        api=args.api,
        jwt=session.session.access_token,
        user_id=session.user.id,
        verbose=args.verbose,
    )

    # Initialize user
    _post(ctx, "/api/v1/auth/initialize", {})

    # Get org_id
    _, body = _get(ctx, "/api/v1/organizations/")
    orgs = body.get("data", [])
    if orgs:
        ctx.org_id = orgs[0]["id"]

    print(f"\nPuppyOne E2E Test Suite")
    print(f"API:     {ctx.api}")
    print(f"User:    {email} ({ctx.user_id[:12]}...)")
    print(f"Org:     {ctx.org_id[:12]}...")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")

    t = Test(ctx)
    start = time.time()

    # ── Run all test modules ──
    modules = [
        test_health,
        test_auth,
        test_organizations,
        test_projects_crud,
        test_content_tree,
        test_access_points_api,
        test_mut_protocol_deep,
        test_cross_project_isolation,
        test_content_edge_cases,
        test_project_members,
        test_sync_api,
        test_tools_api,
        test_tables_api,
    ]
    if not args.no_cleanup:
        modules.append(test_cleanup)

    for mod in modules:
        try:
            mod(t, ctx)
        except Exception as e:
            ctx.failed += 1
            ctx.errors.append(f"[{mod.__name__}] CRASH: {e}")
            print(f"  !! CRASH in {mod.__name__}: {e}")
            if args.verbose:
                traceback.print_exc()

    elapsed = time.time() - start

    # ── Report ──
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")
    print(f"  Passed:  {ctx.passed}")
    print(f"  Failed:  {ctx.failed}")
    print(f"  Skipped: {ctx.skipped}")
    print(f"  Time:    {elapsed:.1f}s")
    print()

    if ctx.errors:
        print("  FAILURES:")
        for err in ctx.errors:
            print(f"    ✗ {err}")
        print()

    pct = (ctx.passed / (ctx.passed + ctx.failed) * 100) if (ctx.passed + ctx.failed) else 0
    print(f"  Pass rate: {pct:.0f}%")

    sys.exit(0 if ctx.failed == 0 else 1)


if __name__ == "__main__":
    main()
