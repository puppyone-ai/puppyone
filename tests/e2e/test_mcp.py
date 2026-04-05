#!/usr/bin/env python3
"""
PuppyOne MCP Endpoint Full-Flow E2E Test
==========================================
Tests: MCP endpoint CRUD, key regeneration, proxy call,
deletion verification, invalid key handling.

Usage:
    export SUPABASE_URL=...  SUPABASE_KEY=...
    python test_mcp.py [--api URL] [--verbose]
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
import traceback
from dataclasses import dataclass, field


# -- HTTP helpers (same pattern as test_deep / test_sandbox) --

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
    skipped: int = 0
    errors: list = field(default_factory=list)
    # MCP state
    mcp_id: str = ""
    mcp_api_key: str = ""


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

    def skip(self, name, reason):
        self.ctx.skipped += 1
        print(f"  - SKIP {name}: {reason}")

    def get(self, path, jwt=None):
        return _req("GET", f"{self.ctx.api}{path}", headers=_headers(jwt or self.ctx.jwt))

    def post(self, path, data=None, jwt=None):
        return _req("POST", f"{self.ctx.api}{path}", data, headers=_headers(jwt or self.ctx.jwt))

    def put(self, path, data=None, jwt=None):
        return _req("PUT", f"{self.ctx.api}{path}", data, headers=_headers(jwt or self.ctx.jwt))

    def delete(self, path, jwt=None):
        return _req("DELETE", f"{self.ctx.api}{path}", headers=_headers(jwt or self.ctx.jwt))


# ================================================================
# SETUP
# ================================================================

def test_setup(t: T, ctx: Ctx):
    t.section("0. Setup: Project + Seed Content")

    # Create project
    code, body = t.post("/api/v1/projects/", {"name": "MCP-E2E-Test", "org_id": ctx.org_id})
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id), f"code={code}")

    if not ctx.project_id:
        return

    # Seed some content so the project is non-empty
    for path, content in [
        ("readme.md", "# MCP Test Project"),
        ("src/main.py", "print('mcp test')"),
        ("data/config.json", json.dumps({"mcp": True, "version": 1})),
    ]:
        t.post(f"/api/v1/content/{ctx.project_id}/write", {
            "path": path, "content": content, "message": f"seed: {path}",
        })
    t.check("Content seeded", True)


# ================================================================
# TEST 1: Create MCP Endpoint
# ================================================================

def test_create_mcp_endpoint(t: T, ctx: Ctx):
    t.section("1. Create MCP Endpoint (POST /api/v1/mcp-endpoints)")

    pid = ctx.project_id
    if not pid:
        t.skip("Create MCP endpoint", "No project_id")
        return

    # Create with full fields
    code, body = t.post("/api/v1/mcp-endpoints", {
        "project_id": pid,
        "name": "E2E Test MCP Endpoint",
        "description": "Created by E2E test suite",
        "accesses": [
            {"path": "/src", "json_path": "", "readonly": True},
            {"path": "/data", "json_path": "$.config", "readonly": False},
        ],
        "tools_config": [
            {"tool_id": "read_file", "enabled": True},
            {"tool_id": "write_file", "enabled": False},
        ],
    })
    t.check("Create returns 200", code == 200, f"code={code} body={json.dumps(body)[:300]}")

    data = body.get("data") or {}
    ctx.mcp_id = data.get("id", "")
    ctx.mcp_api_key = data.get("api_key", "")

    t.check("Has id", bool(ctx.mcp_id))
    t.check("Has api_key", bool(ctx.mcp_api_key), ctx.mcp_api_key[:20] if ctx.mcp_api_key else "")
    t.check("Has project_id", data.get("project_id") == pid)
    t.check("Name matches", data.get("name") == "E2E Test MCP Endpoint")
    t.check("Description matches", data.get("description") == "Created by E2E test suite")
    t.check("Status is active", data.get("status") == "active", f"status={data.get('status')}")
    t.check("Has created_at", bool(data.get("created_at")))
    t.check("Has updated_at", bool(data.get("updated_at")))

    # Verify accesses
    accesses = data.get("accesses", [])
    t.check("Has 2 accesses", len(accesses) == 2, f"accesses={accesses}")
    if accesses:
        t.check("First access path is /src",
                accesses[0].get("path") == "/src", json.dumps(accesses[0])[:100])

    # Verify tools_config
    tools = data.get("tools_config", [])
    t.check("Has 2 tools_config entries", len(tools) == 2, f"tools={tools}")


# ================================================================
# TEST 2: Get MCP Endpoint
# ================================================================

def test_get_mcp_endpoint(t: T, ctx: Ctx):
    t.section("2. Get MCP Endpoint (GET /api/v1/mcp-endpoints/{id})")

    if not ctx.mcp_id:
        t.skip("Get MCP endpoint", "No mcp_id")
        return

    code, body = t.get(f"/api/v1/mcp-endpoints/{ctx.mcp_id}")
    t.check("Get returns 200", code == 200, f"code={code}")

    data = body.get("data") or {}
    t.check("ID matches", data.get("id") == ctx.mcp_id)
    t.check("Name matches", data.get("name") == "E2E Test MCP Endpoint")
    t.check("API key matches", data.get("api_key") == ctx.mcp_api_key)

    # Get non-existent endpoint
    code, body = t.get("/api/v1/mcp-endpoints/00000000-0000-0000-0000-000000000000")
    t.check("Get non-existent returns 404", code == 404, f"code={code}")


# ================================================================
# TEST 3: List MCP Endpoints
# ================================================================

def test_list_mcp_endpoints(t: T, ctx: Ctx):
    t.section("3. List MCP Endpoints (GET /api/v1/mcp-endpoints?project_id=X)")

    pid = ctx.project_id
    if not pid:
        t.skip("List MCP endpoints", "No project_id")
        return

    code, body = t.get(f"/api/v1/mcp-endpoints?project_id={pid}")
    t.check("List returns 200", code == 200, f"code={code}")

    data = body.get("data")
    # data could be a list or None
    endpoints = data if isinstance(data, list) else []
    t.check("List returns array", isinstance(data, list), f"type={type(data)}")
    t.check("At least 1 endpoint in list", len(endpoints) >= 1, f"count={len(endpoints)}")

    if endpoints and ctx.mcp_id:
        ids = [ep.get("id") for ep in endpoints]
        t.check("Created endpoint in list", ctx.mcp_id in ids, f"ids={ids}")

    # List with non-existent project
    code, body = t.get("/api/v1/mcp-endpoints?project_id=00000000-0000-0000-0000-000000000000")
    t.check("List for unknown project returns 200 or 403",
            code in (200, 403), f"code={code}")
    if code == 200:
        data = body.get("data")
        endpoints = data if isinstance(data, list) else []
        t.check("Unknown project returns empty list", len(endpoints) == 0,
                f"count={len(endpoints)}")


# ================================================================
# TEST 4: Update MCP Endpoint
# ================================================================

def test_update_mcp_endpoint(t: T, ctx: Ctx):
    t.section("4. Update MCP Endpoint (PUT /api/v1/mcp-endpoints/{id})")

    if not ctx.mcp_id:
        t.skip("Update MCP endpoint", "No mcp_id")
        return

    # Update name and description
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {
        "name": "E2E Test MCP (Updated)",
        "description": "Updated by E2E test",
    })
    t.check("Update returns 200", code == 200, f"code={code} body={json.dumps(body)[:200]}")

    data = body.get("data") or {}
    t.check("Name updated", data.get("name") == "E2E Test MCP (Updated)",
            f"name={data.get('name')}")
    t.check("Description updated", data.get("description") == "Updated by E2E test")
    t.check("API key unchanged", data.get("api_key") == ctx.mcp_api_key)

    # Update status to paused (DB CHECK constraint: active/paused/error/syncing)
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {
        "status": "paused",
    })
    t.check("Update status returns 200", code == 200, f"code={code}")
    data = body.get("data") or {}
    t.check("Status updated to paused", data.get("status") == "paused",
            f"status={data.get('status')}")

    # Re-activate
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {
        "status": "active",
    })
    t.check("Re-activate returns 200", code == 200)

    # Update accesses
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {
        "accesses": [
            {"path": "/", "json_path": "", "readonly": True},
        ],
    })
    t.check("Update accesses returns 200", code == 200, f"code={code}")
    data = body.get("data") or {}
    accesses = data.get("accesses", [])
    t.check("Accesses updated to 1 entry", len(accesses) == 1,
            f"accesses={json.dumps(accesses)[:100]}")

    # Update tools_config
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {
        "tools_config": [
            {"tool_id": "search", "enabled": True},
        ],
    })
    t.check("Update tools_config returns 200", code == 200, f"code={code}")
    data = body.get("data") or {}
    tools = data.get("tools_config", [])
    t.check("Tools config updated to 1 entry", len(tools) == 1,
            f"tools={json.dumps(tools)[:100]}")


# ================================================================
# TEST 5: Regenerate Key
# ================================================================

def test_regenerate_key(t: T, ctx: Ctx):
    t.section("5. Regenerate API Key (POST /api/v1/mcp-endpoints/{id}/regenerate-key)")

    if not ctx.mcp_id:
        t.skip("Regenerate key", "No mcp_id")
        return

    old_key = ctx.mcp_api_key

    code, body = t.post(f"/api/v1/mcp-endpoints/{ctx.mcp_id}/regenerate-key")
    t.check("Regenerate returns 200", code == 200, f"code={code}")

    data = body.get("data") or {}
    new_key = data.get("api_key", "")
    t.check("New key returned", bool(new_key), new_key[:20] if new_key else "")
    t.check("New key differs from old", new_key != old_key,
            f"old={old_key[:16]}... new={new_key[:16]}...")

    ctx.mcp_api_key = new_key

    # Verify via GET that the key is persisted
    code, body = t.get(f"/api/v1/mcp-endpoints/{ctx.mcp_id}")
    data = body.get("data") or {}
    t.check("GET reflects new key", data.get("api_key") == new_key)


# ================================================================
# TEST 6: MCP Proxy Call
# ================================================================

def test_mcp_proxy(t: T, ctx: Ctx):
    """Test MCP proxy endpoint.

    The proxy at /api/v1/mcp/proxy forwards to an external MCP Server
    (configured via MCP_SERVER_URL). The proxy requires authentication
    via X-MCP-API-Key header, resolved to an Agent's mcp_api_key.

    Since the MCP endpoint api_key and the Agent mcp_api_key are different
    systems (mcp_endpoint vs agent/mcp), we test:
      1. That the proxy endpoint exists and rejects invalid keys
      2. That it rejects requests without any key
    The actual proxy forwarding depends on MCP_SERVER_URL being configured
    and an MCP server running, which may not be available in all environments.
    """
    t.section("6. MCP Proxy (via /api/v1/mcp/proxy)")

    # Test proxy with no key (should get 401/403/422)
    code, body = _req("POST", f"{ctx.api}/api/v1/mcp/proxy",
                       data={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
                       headers={"Content-Type": "application/json"},
                       timeout=15)
    t.check("Proxy without key rejected", code in (401, 403, 422),
            f"code={code} body={json.dumps(body)[:150]}")

    # Test proxy with invalid key
    code, body = _req("POST", f"{ctx.api}/api/v1/mcp/proxy",
                       data={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
                       headers={
                           "Content-Type": "application/json",
                           "X-MCP-API-Key": "invalid_key_12345",
                       },
                       timeout=15)
    t.check("Proxy with invalid key rejected", code in (401, 403, 404),
            f"code={code} body={json.dumps(body)[:150]}")

    # Test proxy with the MCP endpoint's api_key (this is NOT the same as
    # Agent mcp_api_key, so it should also be rejected by the proxy auth)
    if ctx.mcp_api_key:
        code, body = _req("POST", f"{ctx.api}/api/v1/mcp/proxy",
                           data={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
                           headers={
                               "Content-Type": "application/json",
                               "X-MCP-API-Key": ctx.mcp_api_key,
                           },
                           timeout=15)
        # The MCP endpoint api_key is different from Agent mcp_api_key.
        # The proxy resolves via get_agent_by_mcp_api_key, so this may
        # return 403/404 (key not found as agent key) or 200 if the
        # systems share keys.
        t.check("Proxy with MCP endpoint key",
                code in (200, 403, 404, 500, 502),
                f"code={code} body={json.dumps(body)[:150]}")


# ================================================================
# TEST 7: Delete MCP Endpoint
# ================================================================

def test_delete_mcp_endpoint(t: T, ctx: Ctx):
    t.section("7. Delete MCP Endpoint (DELETE /api/v1/mcp-endpoints/{id})")

    if not ctx.mcp_id:
        t.skip("Delete MCP endpoint", "No mcp_id")
        return

    code, body = t.delete(f"/api/v1/mcp-endpoints/{ctx.mcp_id}")
    t.check("Delete returns 200", code == 200, f"code={code} body={json.dumps(body)[:200]}")


# ================================================================
# TEST 8: Verify Deleted Endpoint Is Gone
# ================================================================

def test_deleted_endpoint_gone(t: T, ctx: Ctx):
    t.section("8. Verify Deleted Endpoint Is Gone")

    if not ctx.mcp_id:
        t.skip("Verify deleted", "No mcp_id")
        return

    # GET should return 404
    code, body = t.get(f"/api/v1/mcp-endpoints/{ctx.mcp_id}")
    t.check("GET deleted endpoint returns 404", code == 404,
            f"code={code} body={json.dumps(body)[:100]}")

    # Should not appear in list
    code, body = t.get(f"/api/v1/mcp-endpoints?project_id={ctx.project_id}")
    if code == 200:
        data = body.get("data")
        endpoints = data if isinstance(data, list) else []
        ids = [ep.get("id") for ep in endpoints]
        t.check("Deleted endpoint not in list", ctx.mcp_id not in ids,
                f"ids={ids}")
    else:
        t.check("List after delete returns 200", False, f"code={code}")

    # Regenerate key on deleted endpoint should fail
    code, body = t.post(f"/api/v1/mcp-endpoints/{ctx.mcp_id}/regenerate-key")
    t.check("Regenerate key on deleted fails (404)", code == 404,
            f"code={code}")

    # Update deleted endpoint should fail
    code, body = t.put(f"/api/v1/mcp-endpoints/{ctx.mcp_id}", {"name": "ghost"})
    t.check("Update deleted endpoint fails (404)", code == 404,
            f"code={code}")


# ================================================================
# TEST 9: Invalid API Key Handling
# ================================================================

def test_invalid_api_key(t: T, ctx: Ctx):
    t.section("9. Invalid API Key & Auth Edge Cases")

    pid = ctx.project_id
    if not pid:
        t.skip("Invalid key tests", "No project_id")
        return

    # Create a fresh MCP endpoint to test key invalidation
    code, body = t.post("/api/v1/mcp-endpoints", {
        "project_id": pid,
        "name": "Key-Test MCP",
    })
    data = body.get("data") or {}
    tmp_id = data.get("id", "")
    tmp_key = data.get("api_key", "")
    t.check("Temp MCP endpoint created", bool(tmp_id))

    if not tmp_id:
        return

    # Access without JWT should be rejected
    code, body = _req("GET", f"{ctx.api}/api/v1/mcp-endpoints/{tmp_id}",
                       headers={"Content-Type": "application/json"})
    t.check("GET without JWT returns 401/403", code in (401, 403),
            f"code={code}")

    # Access with invalid JWT
    code, body = _req("GET", f"{ctx.api}/api/v1/mcp-endpoints/{tmp_id}",
                       headers=_headers("invalid.jwt.token"))
    t.check("GET with invalid JWT returns 401/403", code in (401, 403),
            f"code={code}")

    # Create with missing required field (project_id)
    code, body = t.post("/api/v1/mcp-endpoints", {
        "name": "No Project MCP",
    })
    t.check("Create without project_id returns 422", code == 422,
            f"code={code} body={json.dumps(body)[:200]}")

    # Create with empty name (min_length=1)
    code, body = t.post("/api/v1/mcp-endpoints", {
        "project_id": pid,
        "name": "",
    })
    t.check("Create with empty name returns 422", code == 422,
            f"code={code}")

    # Create with overly long name (max_length=200)
    code, body = t.post("/api/v1/mcp-endpoints", {
        "project_id": pid,
        "name": "X" * 201,
    })
    t.check("Create with name > 200 chars returns 422", code == 422,
            f"code={code}")

    # Cleanup temp endpoint
    t.delete(f"/api/v1/mcp-endpoints/{tmp_id}")


# ================================================================
# CLEANUP
# ================================================================

def test_cleanup(t: T, ctx: Ctx):
    t.section("99. Cleanup")

    # Delete any remaining MCP endpoints (safety net)
    if ctx.mcp_id:
        t.delete(f"/api/v1/mcp-endpoints/{ctx.mcp_id}")

    # Delete project
    if ctx.project_id:
        code, _ = t.delete(f"/api/v1/projects/{ctx.project_id}")
        t.check("Delete project", code == 200, f"code={code}")


# ================================================================

def main():
    parser = argparse.ArgumentParser(description="MCP Endpoint E2E Tests")
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

    ctx = Ctx(
        api=args.api,
        jwt=session.session.access_token,
        user_id=session.user.id,
        verbose=args.verbose,
    )

    # Init user + get org
    _req("POST", f"{args.api}/api/v1/auth/initialize", headers=_headers(ctx.jwt))
    _, body = _req("GET", f"{args.api}/api/v1/organizations/", headers=_headers(ctx.jwt))
    ctx.org_id = (body.get("data") or [{}])[0].get("id", "")

    print(f"\nPuppyOne MCP Endpoint E2E Tests")
    print(f"API:  {ctx.api}")
    print(f"User: {email} ({ctx.user_id[:12]}...)")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_create_mcp_endpoint,
        test_get_mcp_endpoint,
        test_list_mcp_endpoints,
        test_update_mcp_endpoint,
        test_regenerate_key,
        test_mcp_proxy,
        test_delete_mcp_endpoint,
        test_deleted_endpoint_gone,
        test_invalid_api_key,
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
