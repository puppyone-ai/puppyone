"""End-to-end test harness for the GitHub Integration.

Drives every endpoint in ``/api/v1/projects/{pid}/github/*`` plus the
public webhook receiver, inspecting DB state directly between calls to
verify side-effects.

Prereqs
-------
* Local Supabase + backend running with ``backend/.env`` and ``frontend/.env``.
* ``backend/.env`` points at local Supabase (``http://127.0.0.1:54321``).
* GitHub OAuth completed once (an ``oauth_connections`` row exists for
  the test user).
* The constants below match the running session — adjust if your local
  test user / project IDs differ.

Run
---
    cd backend
    .venv/Scripts/python.exe scripts/e2e_github_integration.py
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import sys
import time
from hashlib import sha256
from pathlib import Path
from typing import Any

import httpx
import jwt as pyjwt

# ── Constants — adjust for your local session ────────────────────────────
TEST_USER_ID = "c6bba419-6e7e-419a-97b9-a2bf2f4248a9"
TEST_PROJECT_ID = "019e11bb-ad4e-7af6-a175-5cc69d795c2e"
TEST_OAUTH_CONNECTION_ID = 1
TEST_REPO_OWNER = "LiagyuChen"
TEST_REPO_NAME = "AnalytiXpress"
TEST_BRANCH = "main"
TEST_WEBHOOK_SECRET = "harness-webhook-secret-do-not-reuse"
BASE_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:9090")

# ── Globals ───────────────────────────────────────────────────────────────
PASS = []
FAIL = []
JWT_SECRET = os.environ["JWT_SECRET"]


# ── Helpers ───────────────────────────────────────────────────────────────


def step(name: str, ok: bool, detail: str = "") -> bool:
    bucket = PASS if ok else FAIL
    bucket.append((name, detail))
    glyph = "✓" if ok else "✗"
    color = "\033[32m" if ok else "\033[31m"
    print(f"{color}{glyph}\033[0m {name}{(' — ' + detail) if detail else ''}")
    return ok


def mint_jwt(user_id: str, expires_in_seconds: int = 3600) -> str:
    """Sign a JWT the backend's ``_verify_token_local`` will accept.

    Mirrors what GoTrue mints on signup; the backend's local-fast-path
    verifier expects ``aud='authenticated'`` plus the standard claims.
    """
    now = int(time.time())
    return pyjwt.encode(
        {
            "iss": "supabase-demo",
            "sub": user_id,
            "aud": "authenticated",
            "role": "authenticated",
            "iat": now,
            "exp": now + expires_in_seconds,
            "email": "harness@local.test",
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def http() -> httpx.Client:
    token = mint_jwt(TEST_USER_ID)
    return httpx.Client(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=60,
    )


def http_anon() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10)


def envelope(r: httpx.Response) -> Any:
    """Unwrap PuppyOne's ``{code, message, data}`` envelope on success
    or raise on failure with a diagnostic message that includes the body."""
    body = r.json()
    if r.status_code >= 400:
        raise AssertionError(f"HTTP {r.status_code}: {body}")
    if "code" in body:
        if body.get("code") != 0:
            raise AssertionError(f"Envelope failure: {body}")
        return body.get("data")
    return body  # raw payload (e.g. webhook receiver)


def db_query(table: str, filters: dict[str, Any], select: str = "*") -> list[dict]:
    """Hit Supabase REST directly with the service-role key.

    Avoids round-tripping through PuppyOne's Repository wrappers so we
    can verify state independently of the code path under test.
    """
    sup_url = os.environ["SUPABASE_URL"].rstrip("/")
    sup_key = os.environ["SUPABASE_KEY"]
    qs = "&".join(f"{k}=eq.{v}" for k, v in filters.items())
    url = f"{sup_url}/rest/v1/{table}?select={select}&{qs}"
    r = httpx.get(
        url,
        headers={"apikey": sup_key, "Authorization": f"Bearer {sup_key}"},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def db_count(table: str, filters: dict[str, Any]) -> int:
    rows = db_query(table, filters, select="id")
    return len(rows)


# ── Phases ────────────────────────────────────────────────────────────────


def phase_setup() -> None:
    print("\n=== PHASE 0: setup + sanity ===")
    with http_anon() as c:
        r = c.get("/health")
        step("backend /health 200", r.status_code == 200, f"status={r.status_code}")

    # Sanity: required tables exist.
    for tbl in ("github_integrations", "github_sync_log", "oauth_connections"):
        try:
            db_query(tbl, {}, select="id")
            step(f"DB table public.{tbl} reachable", True)
        except Exception as e:
            step(f"DB table public.{tbl} reachable", False, str(e)[:120])

    # Sanity: oauth_connection_id=1 exists for the test user.
    rows = db_query("oauth_connections", {"id": TEST_OAUTH_CONNECTION_ID})
    step(
        f"oauth_connections id={TEST_OAUTH_CONNECTION_ID} exists",
        bool(rows),
        f"workspace={rows[0].get('workspace_name') if rows else '∅'}",
    )

    # Wipe any lingering integration row from a previous run so each
    # harness invocation starts clean.
    with http() as c:
        r = c.delete(f"/api/v1/projects/{TEST_PROJECT_ID}/github")
        # 200 or 204 (envelope-wrapped) or no-binding 404 are all fine.
    step("pre-test cleanup: DELETE /github (idempotent)", True)


def phase_auth_gates() -> None:
    print("\n=== PHASE 1: auth gates ===")
    with http_anon() as c:
        for method, path in [
            ("GET", f"/api/v1/projects/{TEST_PROJECT_ID}/github/status"),
            ("POST", f"/api/v1/projects/{TEST_PROJECT_ID}/github/connect"),
            ("PATCH", f"/api/v1/projects/{TEST_PROJECT_ID}/github"),
            ("DELETE", f"/api/v1/projects/{TEST_PROJECT_ID}/github"),
            ("GET", f"/api/v1/projects/{TEST_PROJECT_ID}/github/repos?oauth_connection_id=1"),
            ("GET", f"/api/v1/projects/{TEST_PROJECT_ID}/github/branches?oauth_connection_id=1&repo_owner=a&repo_name=b"),
            ("POST", f"/api/v1/projects/{TEST_PROJECT_ID}/github/import"),
            ("POST", f"/api/v1/projects/{TEST_PROJECT_ID}/github/export"),
            ("GET", f"/api/v1/projects/{TEST_PROJECT_ID}/github/sync-log"),
        ]:
            r = c.request(method, path, json={} if method in ("POST", "PATCH") else None)
            step(
                f"{method} {path.split('/projects/')[1][:60]} → 401 (no token)",
                r.status_code == 401,
                f"got {r.status_code}",
            )


def phase_status_no_binding() -> None:
    print("\n=== PHASE 2: status with no binding ===")
    with http() as c:
        r = c.get(f"/api/v1/projects/{TEST_PROJECT_ID}/github/status")
        body = envelope(r)
        step(
            "GET /github/status with no binding → data: null",
            body is None,
            f"data={body!r}",
        )


def phase_list_repos() -> str:
    print("\n=== PHASE 3: list repos via OAuth connection ===")
    with http() as c:
        r = c.get(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/repos",
            params={"oauth_connection_id": TEST_OAUTH_CONNECTION_ID},
        )
        body = envelope(r)
    repos = body.get("repos", []) if isinstance(body, dict) else []
    step("GET /github/repos returns at least one repo", len(repos) > 0, f"count={len(repos)}")
    target = next(
        (r for r in repos if r["owner"] == TEST_REPO_OWNER and r["name"] == TEST_REPO_NAME),
        None,
    )
    step(
        f"target repo {TEST_REPO_OWNER}/{TEST_REPO_NAME} present",
        target is not None,
        f"default_branch={target['default_branch'] if target else '∅'}",
    )
    return target["default_branch"] if target else TEST_BRANCH


def phase_list_branches(default_branch: str) -> None:
    """Verify the new ``/branches`` endpoint returns a usable list."""
    print("\n=== PHASE 3b: list branches for the target repo ===")
    with http() as c:
        r = c.get(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/branches",
            params={
                "oauth_connection_id": TEST_OAUTH_CONNECTION_ID,
                "repo_owner": TEST_REPO_OWNER,
                "repo_name": TEST_REPO_NAME,
            },
        )
        body = envelope(r)
    branches = body.get("branches", []) if isinstance(body, dict) else []
    step(
        "GET /github/branches returns at least one branch",
        len(branches) > 0,
        f"count={len(branches)}",
    )
    # Each entry must have name + sha + booleans.
    step(
        "each branch has name + sha + flags",
        all(
            isinstance(b.get("name"), str)
            and isinstance(b.get("sha"), str)
            and isinstance(b.get("protected"), bool)
            and isinstance(b.get("is_default"), bool)
            for b in branches
        ),
        f"first={branches[0] if branches else '∅'}",
    )
    # Exactly one branch should be flagged ``is_default`` and it
    # should match the repo's default_branch from the picker.
    defaults = [b for b in branches if b.get("is_default")]
    step(
        "exactly one branch is_default and matches repo's default",
        len(defaults) == 1 and defaults[0].get("name") == default_branch,
        f"defaults={[b.get('name') for b in defaults]} expected={default_branch}",
    )
    # Bad-input should produce 502 (GitHub returns 404 → we wrap as 502).
    with http() as c:
        r = c.get(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/branches",
            params={
                "oauth_connection_id": TEST_OAUTH_CONNECTION_ID,
                "repo_owner": "definitely-not-a-real-user-zz",
                "repo_name": "definitely-not-a-real-repo-zz",
            },
        )
    step(
        "GET /github/branches for nonexistent repo → 502",
        r.status_code == 502,
        f"got {r.status_code}: {r.text[:100]}",
    )


def phase_connect(branch: str) -> str:
    print("\n=== PHASE 4: connect (bind project ↔ repo) ===")
    with http() as c:
        r = c.post(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/connect",
            json={
                "oauth_connection_id": TEST_OAUTH_CONNECTION_ID,
                "github_repo_owner": TEST_REPO_OWNER,
                "github_repo_name": TEST_REPO_NAME,
                "default_branch": branch,
                "auto_import": False,
            },
        )
        body = envelope(r)
    integration_id = body.get("id") if isinstance(body, dict) else None
    step(
        "POST /github/connect → 200 + integration_id",
        bool(integration_id),
        f"id={integration_id}",
    )

    # Verify DB row exists with correct shape.
    rows = db_query("github_integrations", {"project_id": TEST_PROJECT_ID})
    step(
        "DB github_integrations row exists for project",
        len(rows) == 1
        and rows[0]["github_repo_owner"] == TEST_REPO_OWNER
        and rows[0]["github_repo_name"] == TEST_REPO_NAME
        and rows[0]["default_branch"] == branch,
        f"row={rows[0] if rows else '∅'}",
    )

    # Status should now reflect the binding.
    with http() as c:
        r = c.get(f"/api/v1/projects/{TEST_PROJECT_ID}/github/status")
        body = envelope(r)
    step(
        "GET /github/status reflects binding",
        body is not None and body.get("github_repo_name") == TEST_REPO_NAME,
        f"data.repo={body.get('github_repo_name') if body else '∅'}",
    )

    # Auto-import without webhook_secret should be rejected by the
    # service layer (CHECK in DB + Pydantic guard).
    with http() as c:
        r = c.post(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/connect",
            json={
                "oauth_connection_id": TEST_OAUTH_CONNECTION_ID,
                "github_repo_owner": TEST_REPO_OWNER,
                "github_repo_name": TEST_REPO_NAME,
                "default_branch": branch,
                "auto_import": True,
                # webhook_secret intentionally omitted
            },
        )
    step(
        "POST /github/connect with auto_import=True but no webhook_secret → 400",
        r.status_code == 400,
        f"got {r.status_code}: {r.text[:120]}",
    )

    return integration_id


def phase_import(integration_id: str) -> tuple[str, str]:
    """Returns (git_sha, version_commit_id) for downstream phases."""
    print("\n=== PHASE 5: manual import ===")
    pre_count = db_count("github_sync_log", {"integration_id": integration_id})
    pre_commit_count = len(
        db_query("mut_commits", {"project_id": TEST_PROJECT_ID}, select="commit_id")
    )

    with http() as c:
        # The repo already has prior commits but the project's version scope
        # is empty (no exports yet), so force=True isn't strictly needed
        # — but pass it to exercise that code path.
        r = c.post(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/import",
            json={"force": True},
        )
        body = envelope(r)

    status_ = body.get("status")
    step(
        "POST /github/import → status='success'",
        status_ == "success",
        f"status={status_}, msg={body.get('error_message')}",
    )
    git_sha = body.get("git_sha") or ""
    version_commit_id = body.get("mut_commit_id")
    # version_commit_id is None when the importer detected a no-op (the
    # current project tree already matches the GitHub tree, e.g. running
    # the harness twice on the same project). Both shapes are valid:
    #   - first-time import → 40-hex SHA-1
    #   - repeat / no-op    → None
    is_first_import = version_commit_id is not None
    step(
        "import returned 40-hex git_sha",
        len(git_sha) == 40,
        f"git_sha={git_sha[:12]}",
    )
    if is_first_import:
        step(
            "import returned 40-hex version commit id",
            len(version_commit_id) == 40,
            f"version_commit_id={version_commit_id[:12]}",
        )
    else:
        step(
            "no-op import — version commit id is None (project already up-to-date)",
            True,
            "tree was already in sync; no new version commit produced",
        )

    # github_sync_log: one new ``import`` row, status=success.
    post_count = db_count("github_sync_log", {"integration_id": integration_id})
    step(
        "github_sync_log got +1 row",
        post_count == pre_count + 1,
        f"{pre_count} → {post_count}",
    )
    rows = db_query(
        "github_sync_log",
        {"integration_id": integration_id, "git_sha": git_sha},
    )
    step(
        "sync_log row has direction=import, status=success",
        bool(rows)
        and rows[0]["direction"] == "import"
        and rows[0]["status"] == "success",
        f"row={rows[0] if rows else '∅'}",
    )

    # The version history table gains a commit only on first-time imports; no-op
    # imports skip apply_mutation's commit step entirely.
    post_commit_count = len(
        db_query("mut_commits", {"project_id": TEST_PROJECT_ID}, select="commit_id")
    )
    if is_first_import:
        step(
            "first-import: version history gained ≥1 commit",
            post_commit_count > pre_commit_count,
            f"{pre_commit_count} → {post_commit_count}",
        )
    else:
        step(
            "no-op import: version history unchanged",
            post_commit_count == pre_commit_count,
            f"{pre_commit_count} → {post_commit_count}",
        )

    # Watermark on integration row.
    integ = db_query("github_integrations", {"id": integration_id})[0]
    step(
        "github_integrations.last_imported_sha matches",
        integ.get("last_imported_sha") == git_sha,
        f"sha={(integ.get('last_imported_sha') or '')[:12]}",
    )
    step(
        "github_integrations.last_imported_at populated",
        bool(integ.get("last_imported_at")),
        f"at={integ.get('last_imported_at')}",
    )
    return git_sha, version_commit_id or ""


def phase_idempotency(integration_id: str, git_sha: str) -> None:
    print("\n=== PHASE 6: webhook-style idempotency ===")
    pre_count = db_count("github_sync_log", {"integration_id": integration_id})
    with http() as c:
        r = c.post(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/import",
            json={"force": True},
        )
        body = envelope(r)
    # Either success (skipped silently, no new sync_log row) or success
    # with a fresh row — both are tolerable, but we want to see no
    # *failures* and the count to remain ≤ pre_count + 1 (one new row
    # at most for a successful no-op).
    post_count = db_count("github_sync_log", {"integration_id": integration_id})
    step(
        "second import is idempotent (no new failed sync_log rows)",
        body.get("status") == "success" and post_count <= pre_count + 1,
        f"sync_log {pre_count} → {post_count}, status={body.get('status')}",
    )

    # The dedupe lookup should find the prior successful row.
    rows = db_query(
        "github_sync_log",
        {
            "integration_id": integration_id,
            "git_sha": git_sha,
            "direction": "import",
            "status": "success",
        },
    )
    step("dedupe row findable by (integ, direction, sha)", len(rows) >= 1, f"count={len(rows)}")


def phase_sync_log(integration_id: str) -> None:
    print("\n=== PHASE 7: sync log read + pagination ===")
    with http() as c:
        r = c.get(
            f"/api/v1/projects/{TEST_PROJECT_ID}/github/sync-log",
            params={"limit": 5, "offset": 0},
        )
        body = envelope(r)
    entries = body.get("entries", []) if isinstance(body, dict) else []
    total = body.get("total", 0) if isinstance(body, dict) else 0
    step("GET /github/sync-log returns entries", len(entries) > 0, f"count={len(entries)} total={total}")
    step(
        "every entry shaped correctly",
        all(
            "id" in e
            and "direction" in e
            and "status" in e
            and "created_at" in e
            for e in entries
        ),
        f"keys={set(entries[0].keys()) if entries else '∅'}",
    )


def phase_webhook_hmac(integration_id: str) -> None:
    print("\n=== PHASE 8: webhook HMAC ===")

    # First, set a webhook_secret on the integration (in DB) so we can
    # prove signature verification. We can't go through PATCH because
    # that requires a running ``request.user`` with auth and the webhook
    # contract is "secret never echoed back" — direct DB write is the
    # legitimate ops path here.
    sup_url = os.environ["SUPABASE_URL"].rstrip("/")
    sup_key = os.environ["SUPABASE_KEY"]
    httpx.patch(
        f"{sup_url}/rest/v1/github_integrations?id=eq.{integration_id}",
        json={"webhook_secret": TEST_WEBHOOK_SECRET, "auto_import": False},
        headers={
            "apikey": sup_key,
            "Authorization": f"Bearer {sup_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        timeout=15,
    ).raise_for_status()

    body_bytes = json.dumps(
        {
            "repository": {
                "name": TEST_REPO_NAME,
                "owner": {"login": TEST_REPO_OWNER},
            },
            "ref": f"refs/heads/{TEST_BRANCH}",
            "after": "f" * 40,
        },
        separators=(",", ":"),
    ).encode()

    valid_sig = "sha256=" + hmac.new(TEST_WEBHOOK_SECRET.encode(), body_bytes, sha256).hexdigest()
    bad_sig = "sha256=" + ("0" * 64)

    with http_anon() as c:
        # 1. Wrong signature → 401
        r = c.post(
            "/api/v1/integrations/github/webhook",
            content=body_bytes,
            headers={
                "X-GitHub-Event": "push",
                "X-GitHub-Delivery": "harness-1",
                "X-Hub-Signature-256": bad_sig,
                "Content-Type": "application/json",
            },
        )
        step(
            "POST /webhook bad-sig push → 401",
            r.status_code == 401,
            f"got {r.status_code}: {r.text[:120]}",
        )

        # 2. Valid signature, auto_import=False → 200 + skipped
        r = c.post(
            "/api/v1/integrations/github/webhook",
            content=body_bytes,
            headers={
                "X-GitHub-Event": "push",
                "X-GitHub-Delivery": "harness-2",
                "X-Hub-Signature-256": valid_sig,
                "Content-Type": "application/json",
            },
        )
        step(
            "POST /webhook valid-sig + auto_import=False → 200, status=skipped",
            r.status_code == 200
            and isinstance(r.json(), dict)
            and any(
                res.get("status") == "skipped" and "auto_import_disabled" in (res.get("reason") or "")
                for res in (r.json().get("results") or [])
            ),
            f"body={r.text[:200]}",
        )

        # 3. Valid signature, ping event → 200 + status=ok event=ping
        r = c.post(
            "/api/v1/integrations/github/webhook",
            content=b"{}",
            headers={
                "X-GitHub-Event": "ping",
                "X-GitHub-Delivery": "harness-3",
                "Content-Type": "application/json",
            },
        )
        step(
            "POST /webhook ping → 200 + status=ok",
            r.status_code == 200 and r.json().get("status") == "ok",
            f"body={r.text[:120]}",
        )


def phase_disconnect(integration_id: str) -> None:
    print("\n=== PHASE 9: disconnect + cascade ===")
    pre_log_count = db_count("github_sync_log", {"integration_id": integration_id})

    with http() as c:
        r = c.delete(f"/api/v1/projects/{TEST_PROJECT_ID}/github")
    step(
        "DELETE /github → 200",
        r.status_code == 200,
        f"got {r.status_code}: {r.text[:120]}",
    )

    rows = db_query("github_integrations", {"project_id": TEST_PROJECT_ID})
    step("github_integrations row gone", len(rows) == 0, f"remaining={len(rows)}")

    rows = db_query("github_sync_log", {"integration_id": integration_id})
    step(
        "github_sync_log rows cascade-deleted",
        len(rows) == 0,
        f"had {pre_log_count}, now {len(rows)}",
    )

    with http() as c:
        r = c.get(f"/api/v1/projects/{TEST_PROJECT_ID}/github/status")
        body = envelope(r)
    step("GET /github/status post-disconnect → null", body is None, f"data={body!r}")


# ── Driver ────────────────────────────────────────────────────────────────


def main() -> int:
    # Required env: JWT_SECRET, SUPABASE_URL, SUPABASE_KEY (service role).
    # ``backend/.env`` already has them; load before invocation.
    print("=" * 64)
    print(f" GitHub Integration E2E harness")
    print(f"  base_url = {BASE_URL}")
    print(f"  user_id  = {TEST_USER_ID}")
    print(f"  project  = {TEST_PROJECT_ID}")
    print(f"  repo     = {TEST_REPO_OWNER}/{TEST_REPO_NAME}")
    print("=" * 64)

    try:
        phase_setup()
        phase_auth_gates()
        phase_status_no_binding()
        branch = phase_list_repos()
        phase_list_branches(branch)
        integ_id = phase_connect(branch)
        if integ_id:
            git_sha, version_commit_id = phase_import(integ_id)
            phase_idempotency(integ_id, git_sha)
            phase_sync_log(integ_id)
            phase_webhook_hmac(integ_id)
            phase_disconnect(integ_id)
    except AssertionError as e:
        FAIL.append(("FATAL", str(e)))
    except Exception as e:
        FAIL.append(("UNEXPECTED", f"{type(e).__name__}: {e}"))

    print("\n" + "=" * 64)
    print(f" Summary: \033[32m{len(PASS)} passed\033[0m, \033[31m{len(FAIL)} failed\033[0m")
    print("=" * 64)
    if FAIL:
        for name, detail in FAIL:
            print(f"  ✗ {name}: {detail}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
