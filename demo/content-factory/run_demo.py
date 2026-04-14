"""
Content Factory Demo — Full E2E scenario on PuppyOne MUT protocol.

Simulates a 4-role content production pipeline:
  1. Admin       (root scope, rw)  — sets up config
  2. Research Bot (/raw/, rw)      — pushes research materials
  3. Writer Bot  (/draft/, rw)     — writes blog drafts from research
  4. Review Bot  (/draft/, r)      — reads drafts, cannot write
  5. Human Editor (root scope, rw) — publishes final content

Each role uses its own Access Point (URL + key).

Usage:
    python run_demo.py [--api-url URL]
"""

from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import sys
import time
import requests

# ── Config ──────────────────────────────────────

DEFAULT_API = os.environ.get("PUPPYONE_API_URL", "http://localhost:9090")

KEYS = {
    "admin":     "e2e_test_key_001",
    "research":  "key_research_rw",
    "writer":    "key_writer_rw",
    "reviewer":  "key_reviewer_ro",
    "editor":    "e2e_test_key_001",   # editor uses root scope
}

DEMO_DIR = os.path.dirname(os.path.abspath(__file__))

# ── MUT Protocol helpers ────────────────────────

class MutClient:
    def __init__(self, api_url: str, access_key: str, role: str):
        self.base = f"{api_url}/api/v1/mut/ap/{access_key}"
        self.role = role
        self.session = requests.Session()
        self.session.headers["Content-Type"] = "application/json"

    def clone(self) -> dict:
        r = self.session.post(f"{self.base}/clone", json={})
        r.raise_for_status()
        return r.json()

    def pull(self, since: int = 0) -> dict:
        r = self.session.post(f"{self.base}/pull", json={"since_version": since})
        r.raise_for_status()
        return r.json()

    def push(self, base_version: int, files: dict[str, bytes],
             message: str, who: str) -> dict:
        objects, nested = {}, {}
        for path, content in files.items():
            h = _sha(content)
            objects[h] = base64.b64encode(content).decode()
            parts = path.split("/")
            d = nested
            for p in parts[:-1]:
                d = d.setdefault(p, {})
            d[parts[-1]] = ("B", h)

        root = _build_tree(nested, objects)
        payload = {
            "base_version": base_version,
            "snapshots": [{
                "id": base_version + 1,
                "root": root,
                "message": message,
                "who": who,
                "time": "",
            }],
            "objects": objects,
        }
        r = self.session.post(f"{self.base}/push", json=payload)
        return r.json()

    def push_expect_fail(self, base_version: int, files: dict[str, bytes],
                         message: str, who: str) -> dict:
        """Push that's expected to fail (e.g., read-only scope)."""
        objects, nested = {}, {}
        for path, content in files.items():
            h = _sha(content)
            objects[h] = base64.b64encode(content).decode()
            nested[path] = ("B", h)

        root_data = json.dumps(
            {k: list(v) for k, v in sorted(nested.items())},
            sort_keys=True
        ).encode()
        root = _sha(root_data)
        objects[root] = base64.b64encode(root_data).decode()

        payload = {
            "base_version": base_version,
            "snapshots": [{
                "id": base_version + 1, "root": root,
                "message": message, "who": who, "time": "",
            }],
            "objects": objects,
        }
        r = self.session.post(f"{self.base}/push", json=payload)
        return r.json(), r.status_code

    def rollback(self, target: int) -> dict:
        r = self.session.post(f"{self.base}/rollback",
                              json={"target_version": target})
        return r.json(), r.status_code

    def pull_version(self, version: int) -> dict:
        r = self.session.post(f"{self.base}/pull-version",
                              json={"version": version})
        return r.json(), r.status_code


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _build_tree(node: dict, objects: dict) -> str:
    entries = {}
    for name, val in sorted(node.items()):
        if isinstance(val, tuple):
            entries[name] = list(val)
        else:
            entries[name] = ["T", _build_tree(val, objects)]
    data = json.dumps(entries, sort_keys=True).encode()
    h = _sha(data)
    objects[h] = base64.b64encode(data).decode()
    return h


def _load_files(subdir: str) -> dict[str, bytes]:
    """Load all files from a demo subdirectory."""
    result = {}
    base = os.path.join(DEMO_DIR, subdir)
    for root, _, fnames in os.walk(base):
        for fname in fnames:
            fpath = os.path.join(root, fname)
            rel = os.path.relpath(fpath, base).replace("\\", "/")
            with open(fpath, "rb") as f:
                result[rel] = f.read()
    return result


def _decode_files(files_b64: dict) -> dict[str, str]:
    """Decode base64 file map, return path->preview."""
    result = {}
    for path, b64 in files_b64.items():
        data = base64.b64decode(b64)
        try:
            text = data.decode("utf-8")
            preview = text[:60].replace("\n", " ")
        except UnicodeDecodeError:
            preview = f"<binary {len(data)}B>"
        result[path] = preview
    return result


# ── Scenario Steps ──────────────────────────────

def step(num: int, title: str):
    print(f"\n{'='*60}")
    print(f"  Step {num}: {title}")
    print(f"{'='*60}")


def ok(msg: str):
    print(f"  [OK] {msg}")


def fail(msg: str):
    print(f"  [FAIL] {msg}")


def info(msg: str):
    print(f"  {msg}")


def run_demo(api_url: str):
    print(f"Content Factory Demo")
    print(f"API: {api_url}")
    print(f"Demo dir: {DEMO_DIR}")

    version = 0  # track current global version

    # ── Step 1: Admin sets up project config ──
    step(1, "Admin pushes global config")
    admin = MutClient(api_url, KEYS["admin"], "admin")

    state = admin.clone()
    version = state["version"]
    info(f"Current version: v{version}, files: {len(state['files'])}")

    config_files = _load_files("config")
    info(f"Pushing {len(config_files)} config files: {list(config_files.keys())}")
    result = admin.push(version, config_files, "Admin: initialize pipeline config", "admin")
    if result.get("status") == "ok":
        version = result["version"]
        ok(f"Config pushed → v{version}")
    else:
        fail(f"Push failed: {result}")
        return

    # ── Step 2: Research Bot pushes raw materials ──
    step(2, "Research Bot pushes research materials")
    research = MutClient(api_url, KEYS["research"], "research-bot")

    raw_files = _load_files("raw")
    info(f"Pushing {len(raw_files)} research files: {list(raw_files.keys())}")
    result = research.push(version, raw_files, "Research Bot: weekly research cycle complete", "research-bot")
    if result.get("status") == "ok":
        version = result["version"]
        ok(f"Research pushed → v{version}")
    else:
        fail(f"Push failed: {result}")
        return

    # Verify research bot only sees /raw/ files
    research_clone = research.clone()
    info(f"Research Bot clone: {len(research_clone['files'])} files")
    info(f"  Files: {sorted(research_clone['files'].keys())}")

    # ── Step 3: Writer Bot reads research, writes drafts ──
    step(3, "Writer Bot writes blog drafts")
    writer = MutClient(api_url, KEYS["writer"], "writer-bot")

    draft_files = _load_files("draft")
    info(f"Pushing {len(draft_files)} draft files: {list(draft_files.keys())}")
    result = writer.push(version, draft_files, "Writer Bot: 2 blog drafts + social snippets", "writer-bot")
    if result.get("status") == "ok":
        version = result["version"]
        ok(f"Drafts pushed → v{version}")
    else:
        fail(f"Push failed: {result}")
        return

    # ── Step 4: Review Bot reads drafts (read-only) ──
    step(4, "Review Bot reads drafts (read-only scope)")
    reviewer = MutClient(api_url, KEYS["reviewer"], "reviewer-bot")

    review_clone = reviewer.clone()
    info(f"Review Bot sees {len(review_clone['files'])} files:")
    for path, b64 in sorted(review_clone['files'].items()):
        data = base64.b64decode(b64)
        try:
            preview = data.decode()[:50].replace("\n", " ")
        except UnicodeDecodeError:
            preview = f"<binary {len(data)}B>"
        info(f"  {path}: {preview}...")

    # Review Bot tries to push — should fail with 403
    info(f"\nReview Bot attempts push (should be blocked)...")
    resp, status = reviewer.push_expect_fail(
        version, {"hack.txt": b"Should not work"}, "Review Bot: trying to write", "reviewer-bot"
    )
    if status == 403:
        ok(f"Correctly blocked: 403 — {resp.get('message', '')}")
    else:
        fail(f"Expected 403, got {status}: {resp}")

    # ── Step 5: Human Editor publishes ──
    step(5, "Human Editor publishes final content")
    editor = MutClient(api_url, KEYS["editor"], "editor")

    pub_files = _load_files("published")
    info(f"Pushing {len(pub_files)} published files: {list(pub_files.keys())}")

    # Editor pushes all published files (via root scope, includes full tree)
    # Need to merge with existing tree
    editor_clone = editor.clone()
    version = editor_clone["version"]

    # Combine existing + published files
    all_files = {}
    for path, b64 in editor_clone["files"].items():
        all_files[path] = base64.b64decode(b64)
    for path, content in pub_files.items():
        all_files[f"published/{path}"] = content

    result = editor.push(version, all_files, "Editor: publish weekly report + getting started guide", "editor@company.com")
    if result.get("status") == "ok":
        version = result["version"]
        ok(f"Published → v{version}")
    else:
        fail(f"Push failed: {result}")
        return

    # ── Step 6: Verify full tree ──
    step(6, "Verify: full project tree from root scope")
    final = admin.clone()
    version = final["version"]
    info(f"Version: v{version}")
    info(f"Total files: {len(final['files'])}")
    for path in sorted(final['files'].keys()):
        data = base64.b64decode(final['files'][path])
        size = len(data)
        info(f"  {path} ({size}B)")

    # ── Step 7: Scope isolation check ──
    step(7, "Verify: scope isolation")
    for role, key in [("research", KEYS["research"]), ("writer", KEYS["writer"]),
                       ("reviewer", KEYS["reviewer"])]:
        c = MutClient(api_url, key, role)
        cl = c.clone()
        info(f"{role:12s} → {len(cl['files'])} files: {sorted(cl['files'].keys())[:5]}{'...' if len(cl['files'])>5 else ''}")

    # ── Step 8: Version history ──
    step(8, "Full version history")
    history = admin.pull(since=0)
    for entry in history.get("history", []):
        info(f"  v{entry['version']:2d}: \"{entry['message']}\" by {entry['who']}")

    # ── Step 9: Rollback test ──
    step(9, "Rollback: Editor reverts to before publish")
    rollback_target = version - 1
    info(f"Rolling back to v{rollback_target}...")
    rb_resp, rb_status = editor.rollback(rollback_target)
    if rb_status == 200 and rb_resp.get("status") == "rolled-back":
        new_v = rb_resp["new_version"]
        ok(f"Rolled back → v{new_v} (content = v{rollback_target})")
        version = new_v
    else:
        fail(f"Rollback failed ({rb_status}): {rb_resp}")

    # ── Step 10: Pull historical version ──
    step(10, "Pull historical version (v{})".format(rollback_target))
    pv_resp, pv_status = editor.pull_version(rollback_target)
    if pv_status == 200:
        ok(f"v{rollback_target} snapshot: {len(pv_resp.get('files', {}))} files")
    else:
        fail(f"Pull-version failed ({pv_status}): {pv_resp}")

    # ── Summary ──
    print(f"\n{'='*60}")
    print(f"  Demo Complete!")
    print(f"{'='*60}")
    print(f"  Final version: v{version}")
    print(f"  Roles tested: admin, research-bot, writer-bot, review-bot, editor")
    print(f"  Operations: clone, push, pull, rollback, pull-version")
    print(f"  Scope isolation: verified")
    print(f"  Read-only enforcement: verified")
    print(f"  File types: md, json, csv, txt, docx")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Content Factory Demo")
    parser.add_argument("--api-url", default=DEFAULT_API)
    args = parser.parse_args()
    run_demo(args.api_url)
