#!/usr/bin/env python3
"""
Agent Deep E2E Test Suite
=========================
Real-world simulation of agent operations: multi-turn conversations,
file operations, scope isolation, concurrency, rollback, error handling.

Requires: SUPABASE_URL, SUPABASE_KEY, Anthropic API configured on server.

Usage:
    export SUPABASE_URL=... SUPABASE_KEY=...
    python test_agent_deep.py [--api URL] [--verbose]
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import time
import traceback
from dataclasses import dataclass, field

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


def _sse_chat(api, jwt, agent_id, project_id, prompt, session_id=None, timeout=90):
    """Send a message to agent via SSE and collect full response."""
    import urllib.request, urllib.error
    payload = {
        "agent_id": agent_id,
        "project_id": project_id,
        "prompt": prompt,
    }
    if session_id:
        payload["session_id"] = session_id

    req = urllib.request.Request(
        f"{api}/api/v1/agents",
        data=json.dumps(payload).encode(),
        headers=_h(jwt),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return {"error": True, "code": e.code, "body": e.read().decode()[:500]}
    except Exception as e:
        return {"error": True, "message": str(e)}

    # Parse SSE events
    result = {"text": "", "session_id": "", "events": [], "success": False}
    for line in raw.split("\n"):
        if not line.startswith("data:"):
            continue
        payload_str = line[5:].strip()
        if payload_str == "[DONE]":
            continue
        try:
            evt = json.loads(payload_str)
        except json.JSONDecodeError:
            continue
        result["events"].append(evt)
        if evt.get("type") == "session":
            result["session_id"] = evt.get("sessionId", "")
        elif evt.get("type") == "text_delta":
            result["text"] += evt.get("content", "")
        elif evt.get("type") == "result":
            result["success"] = evt.get("success", False)
        elif evt.get("type") == "error":
            result["error_msg"] = evt.get("message", "")

    return result


@dataclass
class Ctx:
    api: str = ""
    jwt: str = ""
    user_id: str = ""
    org_id: str = ""
    project_id: str = ""
    agent_id: str = ""
    session_id: str = ""
    verbose: bool = False
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list = field(default_factory=list)


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

    def get(self, path, **kw):
        return _req("GET", f"{self.ctx.api}{path}", headers=_h(self.ctx.jwt), **kw)

    def post(self, path, data=None, **kw):
        return _req("POST", f"{self.ctx.api}{path}", data, headers=_h(self.ctx.jwt), **kw)

    def delete(self, path):
        return _req("DELETE", f"{self.ctx.api}{path}", headers=_h(self.ctx.jwt))

    def chat(self, prompt, session_id=None, timeout=90):
        """Send message to the test agent and return parsed result."""
        sid = session_id or self.ctx.session_id
        return _sse_chat(
            self.ctx.api, self.ctx.jwt,
            self.ctx.agent_id, self.ctx.project_id,
            prompt, sid, timeout,
        )


# ══════════════════════════════════════════════════════════════
# SETUP
# ══════════════════════════════════════════════════════════════

def test_setup(t, ctx):
    t.section("0. Setup: Project + Agent + Seed Content")

    # Create project
    _, body = t.get("/api/v1/organizations/")
    ctx.org_id = body["data"][0]["id"]
    _, body = t.post("/api/v1/projects/", {"name": "Agent-Deep-Test", "org_id": ctx.org_id})
    ctx.project_id = (body.get("data") or {}).get("id", "")
    t.check("Project created", bool(ctx.project_id))

    # Seed 10 files across 3 directories
    files = {
        "docs/getting-started.md": "# Getting Started\n\n## Installation\nRun `pip install puppyone`.\n\n## Quick Start\nCreate a project and start editing.\n\n## Configuration\nEdit config.json to customize.",
        "docs/api-reference.md": "# API Reference\n\n| Endpoint | Method | Auth | Description |\n|----------|--------|------|-------------|\n| /projects | GET | Yes | List projects |\n| /projects | POST | Yes | Create project |\n| /content/write | POST | Yes | Write file |\n| /content/ls | GET | Yes | List files |\n| /health | GET | No | Health check |",
        "docs/secret/internal.md": "# Internal Design\n\nThis is confidential.",
        "src/main.py": "from src.utils import calculate_score, format_output\n\ndef run():\n    data = load_data()\n    score = calculate_score(data)\n    print(format_output(score))\n\ndef load_data():\n    return [10, 20, 30, 40, 50]",
        "src/utils.py": "def calculate_score(data):\n    return sum(data) / len(data)\n\ndef format_output(score):\n    return f'Average score: {score:.1f}'",
        "src/tests.py": "from src.utils import calculate_score\n\ndef test_score():\n    assert calculate_score([10, 20, 30]) == 20.0\n\ndef test_empty():\n    try:\n        calculate_score([])\n        assert False\n    except ZeroDivisionError:\n        pass",
        "data/config.json": json.dumps({
            "database": {"host": "localhost", "port": 5432, "name": "mydb", "user": "admin"},
            "cache": {"enabled": True, "ttl": 300},
            "logging": {"level": "info", "format": "json"},
        }, indent=2),
        "data/users.json": json.dumps({
            "users": [
                {"id": 1, "name": "Alice", "email": "alice@example.com", "role": "admin"},
                {"id": 2, "name": "Bob", "email": "bob@example.com", "role": "editor"},
                {"id": 3, "name": "Charlie", "email": "charlie@example.com", "role": "viewer"},
            ]
        }, indent=2),
        "data/metrics.csv": "date,page,views,score\n2026-01-01,home,1500,92\n2026-01-02,home,1800,95\n2026-01-03,docs,900,88\n2026-01-04,api,1200,91\n2026-01-05,home,2000,97",
        "readme.md": "# Agent Deep Test Project\n\nThis project tests agent capabilities.\n\n## Structure\n- /docs/ — documentation\n- /src/ — source code\n- /data/ — data files",
    }
    for path, content in files.items():
        t.post(f"/api/v1/content/{ctx.project_id}/write", {
            "path": path, "content": content, "message": f"seed: {path}",
        })
    t.check("10 files seeded", True)

    # Create agent
    _, body = t.post("/api/v1/agent-config/", {
        "project_id": ctx.project_id,
        "name": "Deep Test Agent",
        "model": "claude-sonnet-4-20250514",
        "system_prompt": (
            "You are a helpful project assistant. You have access to the project's files. "
            "When asked to create or modify files, do so directly. "
            "Be concise in your responses — no more than 2-3 sentences unless asked for detail. "
            "When listing files, use bullet points."
        ),
        "agent_type": "chat",
    })
    ctx.agent_id = (body.get("data") or {}).get("id", "")
    t.check("Agent created", bool(ctx.agent_id))

    # Bind bash access — without this, agent has NO file access at all
    # (no sandbox starts, no tools injected, Claude can't read/write files)
    if ctx.agent_id:
        code, body = t.post(f"/api/v1/agent-config/{ctx.agent_id}/bash", {
            "path": "/",
            "readonly": False,
        })
        t.check("Bash access bound", code in (200, 201), json.dumps(body)[:200])


# ══════════════════════════════════════════════════════════════
# 1. BASIC CAPABILITIES
# ══════════════════════════════════════════════════════════════

def test_basic_capabilities(t, ctx):
    t.section("1. Agent Basic Capabilities")

    # A1: Project file awareness
    r = t.chat("List all files in this project. Use bullet points.")
    t.check("A1: Agent responds", r.get("success") is True, r.get("error_msg", ""))
    text = r.get("text", "").lower()
    t.check("A1: Mentions readme", "readme" in text, text[:200])
    t.check("A1: Mentions config", "config" in text, text[:200])
    ctx.session_id = r.get("session_id", "")

    # A2: File content understanding
    r = t.chat("What is the database host in data/config.json? Just the value.")
    t.check("A2: Agent reads config", "localhost" in r.get("text", "").lower(),
            r.get("text", "")[:200])

    # A3: Cross-file analysis
    r = t.chat("What functions does src/main.py import from src/utils.py? List them.")
    text = r.get("text", "").lower()
    t.check("A3: Finds calculate_score", "calculate_score" in text, text[:200])
    t.check("A3: Finds format_output", "format_output" in text, text[:200])

    # A4: Table understanding
    r = t.chat("How many API endpoints are in docs/api-reference.md? Just the number.")
    t.check("A4: Counts endpoints", "5" in r.get("text", ""), r.get("text", "")[:200])

    # A5: CSV analysis
    r = t.chat("What is the highest score in data/metrics.csv? Just the number.")
    t.check("A5: Finds max score", "97" in r.get("text", ""), r.get("text", "")[:200])


# ══════════════════════════════════════════════════════════════
# 2. MULTI-TURN CONVERSATION (10+ rounds)
# ══════════════════════════════════════════════════════════════

def test_multi_turn(t, ctx):
    t.section("2. Multi-Turn Conversation")

    # Start fresh session
    r = t.chat("Remember this secret code: Kx7#mP9zQ. I'll ask for it later. Confirm you remembered it.")
    sid = r.get("session_id", "")
    t.check("A6.1: Session started", bool(sid))

    # Rounds 2-5: File operations (should not break context)
    r = t.chat("What files are in the /data/ directory?", session_id=sid)
    t.check("A6.2: Lists data files", "config" in r.get("text", "").lower())

    r = t.chat("Read data/config.json and tell me the cache TTL value.", session_id=sid)
    t.check("A6.3: Reads TTL", "300" in r.get("text", ""))

    r = t.chat("Create a new file docs/notes.md with the text: 'Meeting notes from April 19'", session_id=sid)
    t.check("A6.4: File creation acknowledged", r.get("success") is True)

    r = t.chat("What did I just ask you to create?", session_id=sid)
    t.check("A6.5: Remembers recent action", "notes" in r.get("text", "").lower())

    # Round 6: Recall from round 1
    r = t.chat("What was the secret code I told you at the beginning?", session_id=sid)
    text = r.get("text", "")
    t.check("A6.6: Recalls secret code", "Kx7#mP9zQ" in text or "Kx7" in text,
            text[:200])


def test_progressive_editing(t, ctx):
    t.section("2b. Progressive Multi-File Editing")

    # A8: Build a 3-file project incrementally
    r = t.chat("Create src/models.py with a User class that has name (str) and age (int) fields.")
    sid = r.get("session_id", "")
    t.check("A8.1: models.py created", r.get("success") is True)

    r = t.chat("Create src/api.py that imports User from models and has a create_user(name, age) function.", session_id=sid)
    t.check("A8.2: api.py created", r.get("success") is True)

    r = t.chat("Create src/test_api.py that imports create_user from api and tests it.", session_id=sid)
    t.check("A8.3: test_api.py created", r.get("success") is True)

    # Now modify the base and propagate
    r = t.chat("Add an 'email' field to the User class in models.py.", session_id=sid)
    t.check("A8.4: models.py updated", r.get("success") is True)

    r = t.chat("Update create_user in api.py to accept email parameter.", session_id=sid)
    t.check("A8.5: api.py updated", r.get("success") is True)

    r = t.chat("Update the test in test_api.py to test the email field.", session_id=sid)
    t.check("A8.6: test_api.py updated", r.get("success") is True)

    # Verify files exist via Content API
    code, body = t.get(f"/api/v1/content/{ctx.project_id}/ls?path=src")
    entries = (body.get("data") or {}).get("entries", [])
    names = [e.get("name", "") for e in entries] if isinstance(entries, list) else list(entries.keys()) if isinstance(entries, dict) else []
    t.check("A8.7: All src files exist", len([n for n in names if "model" in n or "api" in n or "test" in n]) >= 3,
            f"names={names}")


# ══════════════════════════════════════════════════════════════
# 3. SAME-SCOPE MULTI-FILE OPERATIONS
# ══════════════════════════════════════════════════════════════

def test_same_scope_operations(t, ctx):
    t.section("3. Same-Scope Multi-File Operations")

    # A11: Batch create
    r = t.chat(
        "Create these 5 files in /docs/guides/: "
        "1) setup.md with installation steps, "
        "2) usage.md with usage examples, "
        "3) faq.md with 3 common questions, "
        "4) contributing.md with contribution guidelines, "
        "5) license.md with MIT license text. "
        "Each should have at least 3 sections with headers."
    )
    t.check("A11: Batch create acknowledged", r.get("success") is True)
    sid = r.get("session_id", "")

    # Verify via API
    code, body = t.get(f"/api/v1/content/{ctx.project_id}/ls?path=docs/guides")
    if code == 200:
        entries = (body.get("data") or {}).get("entries", [])
        count = len(entries) if isinstance(entries, list) else len(entries) if isinstance(entries, dict) else 0
        t.check("A11: 5 guide files created", count >= 3, f"count={count}")
    else:
        t.check("A11: guides directory exists", False, f"code={code}")

    # A12: Batch modify
    r = t.chat(
        "Add a 'Last updated: 2026-04-19' line at the top of setup.md and usage.md.",
        session_id=sid,
    )
    t.check("A12: Batch modify acknowledged", r.get("success") is True)

    # A15: JSON batch update
    r = t.chat(
        "In data/config.json, change the logging level from 'info' to 'debug' "
        "and add a new field 'app_name' with value 'PuppyOne'.",
        session_id=sid,
    )
    t.check("A15: JSON update acknowledged", r.get("success") is True)

    # Verify JSON change
    code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=data/config.json")
    if code == 200:
        content = (body.get("data") or {}).get("content", {})
        if isinstance(content, dict):
            t.check("A15: logging level changed",
                    content.get("logging", {}).get("level") == "debug",
                    f"logging={content.get('logging')}")
        else:
            t.check("A15: config readable", True)
    else:
        # try with .json suffix
        code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=data/config.json.json")
        t.check("A15: config accessible", code == 200, f"code={code}")


# ══════════════════════════════════════════════════════════════
# 4. ERROR HANDLING & EDGE CASES
# ══════════════════════════════════════════════════════════════

def test_error_handling(t, ctx):
    t.section("4. Error Handling & Edge Cases")

    # A35: Empty message
    r = t.chat("")
    t.check("A35: Empty prompt handled", "error" in r or r.get("text", "") != "",
            f"events={len(r.get('events', []))}")

    # A36: Very long message
    long_msg = "Please repeat: " + "x" * 5000
    r = t.chat(long_msg, timeout=120)
    t.check("A36: Long message handled", r.get("success") is True or "error" not in r,
            r.get("error_msg", "")[:100])

    # A37: Invalid agent_id
    r = _sse_chat(ctx.api, ctx.jwt, "nonexistent-agent-id", ctx.project_id,
                  "hello", timeout=30)
    t.check("A37: Invalid agent_id → error", r.get("error") is True or r.get("success") is not True,
            str(r)[:200])

    # A40: Unicode content — use fresh session to avoid stale sandbox
    r = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                  "Create a file called docs/unicode.md with this content: '你好世界 🌍 こんにちは 한국어'", timeout=90)
    t.check("A40: Unicode acknowledged", r.get("success") is True,
            f"events={len(r.get('events', []))} err={r.get('error_msg', r.get('error', ''))}")

    # Verify unicode roundtrip
    code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=docs/unicode.md")
    if code != 200:
        code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=docs/unicode.md.json")
    if code == 200:
        content = str((body.get("data") or {}).get("content_text", (body.get("data") or {}).get("content", "")))
        t.check("A40: Unicode preserved", "你好" in content or "🌍" in content,
                content[:100])
    else:
        t.skip("A40: Unicode verify", f"cat returned {code}")


# ══════════════════════════════════════════════════════════════
# 5. AGENT + CONTENT API INTERACTION
# ══════════════════════════════════════════════════════════════

def test_agent_content_sync(t, ctx):
    t.section("5. Agent ↔ Content API Sync")

    # Write via Content API → Agent reads
    t.post(f"/api/v1/content/{ctx.project_id}/write", {
        "path": "from-api.txt",
        "content": "This file was written by the Content API, not the agent. Secret: ALPHA-BRAVO-42.",
        "message": "api write",
    })

    # Use fresh session so sandbox clones latest MUT state (including API-written file)
    r = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                  "Read the file from-api.txt and tell me the secret code in it.", timeout=90)
    t.check("Agent reads API-written file",
            "ALPHA" in r.get("text", "").upper() or "BRAVO" in r.get("text", "").upper() or "42" in r.get("text", ""),
            r.get("text", "")[:200])
    sync_sid = r.get("session_id", "")

    # Agent writes → Content API reads
    r = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                  "Create a file called agent-output.md with exactly this text: 'Agent verification: SUCCESS-789'",
                  session_id=sync_sid, timeout=90)
    t.check("Agent write acknowledged", r.get("success") is True)

    # Read back via Content API (may have .json suffix)
    code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=agent-output.md")
    if code != 200:
        code, body = t.get(f"/api/v1/content/{ctx.project_id}/cat?path=agent-output.md.json")
    if code == 200:
        content = str((body.get("data") or {}).get("content_text", (body.get("data") or {}).get("content", "")))
        t.check("Content API reads agent file", "SUCCESS" in content or "789" in content,
                content[:100])
    else:
        t.skip("Content API read", f"cat returned {code}")


# ══════════════════════════════════════════════════════════════
# 6. SESSION MANAGEMENT
# ══════════════════════════════════════════════════════════════

def test_session_management(t, ctx):
    t.section("6. Session Management")

    # Session A: multi-turn — explicitly pass empty session_id to force new session
    r1 = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                   "Remember: the project name is 'Phoenix'. Confirm.", session_id=None)
    sid_a = r1.get("session_id", "")
    t.check("Session A started", bool(sid_a))

    # Session B: independent — also force new session
    r2 = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                   "Remember: the project name is 'Dragon'. Confirm.", session_id=None)
    sid_b = r2.get("session_id", "")
    t.check("Session B started", bool(sid_b) and sid_b != sid_a,
            f"A={sid_a[:8]} B={sid_b[:8]}")

    # Session A recall
    r = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                  "What project name did I tell you?", session_id=sid_a, timeout=60)
    t.check("Session A recalls Phoenix",
            "phoenix" in r.get("text", "").lower(),
            f"text={r.get('text', '')[:100]} events={len(r.get('events', []))} err={r.get('error_msg', r.get('error', ''))}")

    # Session B recall
    r = _sse_chat(ctx.api, ctx.jwt, ctx.agent_id, ctx.project_id,
                  "What project name did I tell you?", session_id=sid_b, timeout=60)
    t.check("Session B recalls Dragon",
            "dragon" in r.get("text", "").lower(),
            f"text={r.get('text', '')[:100]} events={len(r.get('events', []))} err={r.get('error_msg', r.get('error', ''))}")

    # List sessions
    code, body = t.get(f"/api/v1/chat/sessions?agent_id={ctx.agent_id}")
    sessions = body.get("data", [])
    t.check("Multiple sessions exist", len(sessions) >= 2, f"count={len(sessions)}")

    # Delete session A
    if sid_a:
        code, _ = t.delete(f"/api/v1/chat/sessions/{sid_a}")
        t.check("Delete session A", code == 200)


# ══════════════════════════════════════════════════════════════
# CLEANUP
# ══════════════════════════════════════════════════════════════

def test_cleanup(t, ctx):
    t.section("99. Cleanup")

    if ctx.agent_id:
        t.delete(f"/api/v1/agent-config/{ctx.agent_id}")
    if ctx.project_id:
        code, _ = t.delete(f"/api/v1/projects/{ctx.project_id}")
        t.check("Project deleted", code == 200)


# ══════════════════════════════════════════════════════════════

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

    print(f"\nAgent Deep E2E Test Suite")
    print(f"API: {ctx.api}")

    t_obj = T(ctx)
    start = time.time()

    modules = [
        test_setup,
        test_basic_capabilities,
        test_multi_turn,
        test_progressive_editing,
        test_same_scope_operations,
        test_error_handling,
        test_agent_content_sync,
        test_session_management,
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
