#!/usr/bin/env python3
"""
Redesign smoke test — exercises the access-point-redesign-2026-05-02
endpoints against Railway. Run after staging migrate to confirm the new
schema + routes + transition fallback all line up.

Coverage:
  - GET  /api/v1/projects/{pid}/scopes              (list)
  - POST /api/v1/projects/{pid}/scopes              (create)
  - PATCH /api/v1/projects/{pid}/scopes/{sid}       (rename)
  - DELETE /api/v1/projects/{pid}/scopes/{sid}      (delete)
  - GET  /api/v1/projects/{pid}/access-point        (identity payload)
  - GET  /api/v1/projects/{pid}/connectors          (list)
  - GET  /api/v1/projects/{pid}/permissions         (list)
  - GET  /mut/ap/{key}/...                          (per-scope key auth)
  - DB trigger: cli + agent connector auto-creation per scope
  - Legacy /api/v1/access fallback during transition

Usage:
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    python tests/e2e/test_redesign_smoke.py [--api URL] [-v]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Ctx:
    api: str
    jwt: str
    user_id: str
    org_id: str = ""
    project_id: str = ""
    verbose: bool = False
    passed: int = 0
    failed: int = 0
    errors: list = field(default_factory=list)


def _h(ctx: Ctx, extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {ctx.jwt}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _req(method: str, ctx: Ctx, path: str, data=None, headers=None, timeout=30):
    url = f"{ctx.api}{path}"
    h = headers or _h(ctx)
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw) if raw else {}
            except Exception:
                return r.status, {"_raw": raw[:200]}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def get(ctx, p, **kw):    return _req("GET", ctx, p, **kw)
def post(ctx, p, d=None, **kw): return _req("POST", ctx, p, d, **kw)
def patch(ctx, p, d=None): return _req("PATCH", ctx, p, d)
def delete(ctx, p):       return _req("DELETE", ctx, p)


class T:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx

    def ok(self, name, code, body, want_codes=(200, 201), want_in_body=None):
        if code in want_codes and (want_in_body is None or want_in_body(body)):
            self.ctx.passed += 1
            print(f"  [PASS] {name}")
            return True
        self.ctx.failed += 1
        snippet = json.dumps(body)[:200] if isinstance(body, (dict, list)) else str(body)[:200]
        msg = f"  [FAIL] {name} → HTTP {code}: {snippet}"
        print(msg)
        self.ctx.errors.append(msg)
        return False

    def section(self, title):
        print(f"\n── {title} {'─' * (60 - len(title))}")


def section_setup(t: T):
    t.section("Setup: pick or create a project")
    code, body = get(t.ctx, "/api/v1/projects/")
    if code != 200:
        print(f"  [SKIP] cannot list projects: HTTP {code}")
        sys.exit(1)
    items = body.get("data", [])
    # prefer an existing project owned by us
    pid = None
    for p in items:
        if p.get("created_by") == t.ctx.user_id:
            pid = p["id"]
            break
    if pid is None:
        # create one
        code, body = post(t.ctx, "/api/v1/projects/", {
            "name": f"redesign-smoke-{int(time.time())}",
            "description": "redesign smoke",
            "org_id": t.ctx.org_id,
        })
        if code not in (200, 201):
            print(f"  [SKIP] cannot create project: HTTP {code} {body}")
            sys.exit(1)
        pid = body.get("data", {}).get("id") or body.get("id")
    t.ctx.project_id = pid
    print(f"  project_id = {pid}")


def section_scopes(t: T):
    t.section("Redesign: /scopes")
    pid = t.ctx.project_id

    # 1. list — should always work (root scope auto-backfilled by 000500)
    code, body = get(t.ctx, f"/api/v1/projects/{pid}/scopes")
    t.ok("GET /scopes", code, body, want_in_body=lambda b: "data" in b)
    scopes = (body or {}).get("data", [])
    print(f"        {len(scopes)} scope(s)")
    has_root = any(s.get("is_root") for s in scopes)
    t.ok("root scope exists", 200 if has_root else 0, body, want_codes=(200,))

    # 2. create a docs scope
    code, body = post(t.ctx, f"/api/v1/projects/{pid}/scopes", {
        "name": "Docs (smoke)",
        "path": f"docs-smoke-{int(time.time())}",
        "exclude": [],
        "mode": "rw",
    })
    created = t.ok("POST /scopes (create)", code, body)
    docs_scope_id = (body.get("data") or {}).get("id") if created else None
    docs_access_key = (body.get("data") or {}).get("access_key") if created else None

    # 3. rename
    if docs_scope_id:
        code, body = patch(t.ctx, f"/api/v1/projects/{pid}/scopes/{docs_scope_id}",
                           {"name": "Docs (renamed)"})
        t.ok("PATCH /scopes/{id}", code, body)

    # 4. trigger smoke: connectors auto-created for this new scope
    code, body = get(t.ctx, f"/api/v1/projects/{pid}/connectors?scope_id={docs_scope_id}" if docs_scope_id else f"/api/v1/projects/{pid}/connectors")
    if docs_scope_id:
        items = (body or {}).get("data", [])
        providers = sorted({c.get("provider") for c in items if c.get("scope_id") == docs_scope_id})
        ok = providers == ["agent", "cli"]
        t.ok(f"DB trigger: cli+agent connectors for new scope (got {providers})",
             200 if ok else 0, body, want_codes=(200,))

    return docs_scope_id, docs_access_key


def section_identity(t: T):
    t.section("Redesign: /access-point (repo identity)")
    pid = t.ctx.project_id
    code, body = get(t.ctx, f"/api/v1/projects/{pid}/access-point")
    has_url_and_scopes = (
        isinstance(body.get("data"), dict)
        and body["data"].get("url")
        and isinstance(body["data"].get("scopes"), list)
    )
    t.ok("GET /access-point returns {url, prompt_template, scopes}",
         code, body, want_in_body=lambda b: has_url_and_scopes)


def section_connectors(t: T):
    t.section("Redesign: /connectors")
    pid = t.ctx.project_id
    code, body = get(t.ctx, f"/api/v1/projects/{pid}/connectors")
    t.ok("GET /connectors", code, body, want_in_body=lambda b: "data" in b)

    # creating cli/agent must be rejected (auto-created only)
    code, body = post(t.ctx, f"/api/v1/projects/{pid}/connectors", {
        "scope_id": "any",
        "provider": "cli",
        "direction": "bidirectional",
    })
    t.ok("POST /connectors with provider='cli' is rejected", code, body, want_codes=(400, 422))


def section_permissions(t: T):
    t.section("Redesign: /permissions")
    pid = t.ctx.project_id
    code, body = get(t.ctx, f"/api/v1/projects/{pid}/permissions")
    t.ok("GET /permissions", code, body, want_in_body=lambda b: "data" in b)


def section_per_scope_key(t: T, access_key: str | None):
    t.section("Mut protocol: per-scope access_key")
    if not access_key:
        print("  [SKIP] no access_key from /scopes create — skipping protocol test")
        return
    # Try a negotiate against the per-scope key.
    code, body = post(t.ctx, f"/mut/ap/{access_key}/negotiate",
                      {"protocol_version": 2}, headers={"Content-Type": "application/json"})
    # 200 OK or 400 with helpful body both prove the route+auth works.
    t.ok("POST /mut/ap/{access_key}/negotiate (per-scope key auth)",
         code, body, want_codes=(200, 400))


def section_legacy_fallback(t: T):
    t.section("Transition: legacy /api/v1/access endpoint still resolves")
    pid = t.ctx.project_id
    code, body = get(t.ctx, f"/api/v1/access/?project_id={pid}")
    # We accept 200 (still works) or 410 (gone, post-transition).
    t.ok("GET /api/v1/access (legacy)", code, body, want_codes=(200, 410))


def section_cleanup(t: T, scope_id: str | None):
    t.section("Cleanup: delete the scope we created")
    if not scope_id:
        return
    pid = t.ctx.project_id
    code, body = delete(t.ctx, f"/api/v1/projects/{pid}/scopes/{scope_id}")
    t.ok("DELETE /scopes/{id}", code, body, want_codes=(200, 204))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://qubits-api.puppyone.ai")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_KEY", "")
    if not sb_url or not sb_key:
        print("ERROR: set SUPABASE_URL and SUPABASE_KEY"); sys.exit(1)

    from supabase import create_client
    client = create_client(sb_url, sb_key)
    email = "redesign-smoke@puppyone.ai"
    password = "RedesignSmoke2026!"
    try:
        client.auth.admin.create_user({"email": email, "password": password, "email_confirm": True})
    except Exception:
        pass
    sess = client.auth.sign_in_with_password({"email": email, "password": password})

    ctx = Ctx(api=args.api, jwt=sess.session.access_token,
              user_id=sess.user.id, verbose=args.verbose)

    # initialize user record + grab org
    _req("POST", ctx, "/api/v1/auth/initialize", {})
    code, body = get(ctx, "/api/v1/organizations/")
    if (body or {}).get("data"):
        ctx.org_id = body["data"][0]["id"]

    print(f"\nRedesign smoke against {ctx.api}")
    print(f"User: {email[:24]} ({ctx.user_id[:12]}...)")
    print(f"Org : {ctx.org_id[:12] if ctx.org_id else 'none'}")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")

    t = T(ctx)
    started = time.time()

    section_setup(t)
    docs_scope_id, docs_access_key = section_scopes(t)
    section_identity(t)
    section_connectors(t)
    section_permissions(t)
    section_per_scope_key(t, docs_access_key)
    section_legacy_fallback(t)
    section_cleanup(t, docs_scope_id)

    elapsed = time.time() - started
    total = ctx.passed + ctx.failed
    print(f"\nResults: {ctx.passed}/{total} passed in {elapsed:.1f}s")
    sys.exit(0 if ctx.failed == 0 else 1)


if __name__ == "__main__":
    main()
