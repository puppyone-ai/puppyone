# Local end-to-end testing — `mut-git` branch

> Use this when you want to verify the GitHub Integration / WebSocket /
> bound-git-branch features without touching the shared `dev-qubits`
> Supabase. Everything runs on your laptop: Supabase locally via
> Docker, backend native, frontend native.

---

## 1. Prerequisites

| | |
|---|---|
| Docker Desktop running | required |
| `npx` (Node ≥ 18) | required |
| `uv` (Python package manager) | required (`curl -LsSf https://astral.sh/uv/install.sh \| sh`) |
| GitHub account | required for the GitHub Integration test |
| `cloudflared` or `ngrok` | **optional** — only if you want to test the webhook auto-import path |

---

## 2. Register a *separate* GitHub OAuth App for local dev

The shared dev-qubits OAuth app's callback URL is fixed to
`https://dev-qubits-try.puppyone.ai/oauth/github/callback`.  GitHub
OAuth Apps allow exactly one callback URL, so we register a brand-new
local-only app instead of clobbering the shared one.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** →
   **New OAuth App**.
2. Fill in:
   * **Application name**: `PuppyOne (local)`
   * **Homepage URL**: `http://localhost:3000`
   * **Authorization callback URL**:
     `http://localhost:3000/oauth/github/callback`
3. Click **Register application** → copy the **Client ID**.
4. Click **Generate a new client secret** → copy the secret immediately
   (it disappears on next page load).
5. Save these into `backend/.env` (the auto-generated file from
   `scripts/setup.sh`) replacing the dev-qubits values:

   ```env
   GITHUB_CLIENT_ID=<paste from step 3>
   GITHUB_CLIENT_SECRET=<paste from step 4>
   GITHUB_REDIRECT_URI=http://localhost:3000/oauth/github/callback
   ```

   ⚠️ **Trap**: the backend only reads `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
   ([`backend/src/config.py`](../backend/src/config.py)). If you've stashed
   the values under `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` (a name that
   appears in some legacy notes), the backend ignores them and falls back
   to whatever is on the canonical names — almost always the dev-qubits
   prod app, whose callback URL is `dev-qubits-try.puppyone.ai` and will
   reject the localhost redirect with "redirect_uri is not associated
   with this application."

—— That's it. PuppyOne's `/api/v1/oauth/github/*` endpoints will use these
to do the OAuth dance directly with `github.com`. **No Supabase Auth is
involved in the GitHub Integration flow.**

> The Supabase Auth that *is* needed is the user-login flow into PuppyOne
> itself (i.e. signing in to `localhost:3000`). Local Supabase ships
> GoTrue with `MAILER_AUTOCONFIRM=true`, so any email/password signup
> works without an SMTP server.

---

## 3. Boot the stack

```bash
cd puppyone

# 3.1  Local Supabase (Postgres + GoTrue + Storage + Studio)
npx supabase start

# 3.2  Redis + MinIO
docker compose up -d redis minio

# 3.3  Generate / refresh local env files
./scripts/setup.sh   # auto-extracts keys from `supabase status` and writes both .env files
```

After step 3.3, **manually edit `backend/.env`** with the GitHub OAuth
values from §2 above, then:

```bash
# 3.4  Install backend deps + override `mutai` with the local mut/ editable
cd backend
uv sync
uv pip install -e ../../mut   # NEW — the mut-git branch isn't on PyPI yet

# 3.5  Run backend
uv run uvicorn src.main:app --port 9090 --reload

# 3.6  In a SECOND terminal, run frontend
cd frontend
npm install
npm run dev
```

The backend already accepts:
* `http://localhost:9090/health` → 200
* All 9 GitHub Integration endpoints under `/api/v1/projects/{pid}/github/*`
* WebSocket commit_update at `/api/v1/mut/{pid}/ws`

---

## 4. End-to-end test script

### 4.1  Sign in

1. Open `http://localhost:3000`
2. **Sign up** with any email + password (GoTrue auto-confirms).
3. Create an organization + a project — call it `mut-git-test`.

### 4.2  Verify WebSocket commit_update

1. Open the **Context** tab on the project. Drop a couple of files in.
2. Open browser DevTools → Network → WS. Confirm the WebSocket to
   `ws://localhost:9090/api/v1/mut/{pid}/ws` is **101 Switching
   Protocols** with subprotocol `mut.v1`.
3. In a separate browser tab, push a change to the same project. The
   first tab's sidebar should refresh **without manual reload** —
   that's the §6 "侧栏永不刷新" bug fix landing.

### 4.3  GitHub Integration — connect a repo

1. Click **Integrations** in the left rail. ("两个连环" icon, between
   Monitor and Settings.)
2. The page should say "Connect a GitHub account first" → click
   **Connect GitHub account**. You'll land on github.com → authorise
   → bounce back to `localhost:3000/oauth/github/callback` → back to
   the Integrations page.
3. Now the page should say "Connected as `<your-username>`" and show a
   repo picker. Pick a small repo of yours (a few files, a
   `README.md`).
4. Set **Branch** to `main` (or whatever the picker auto-fills from the
   repo's GitHub default).
5. Leave **Auto-import** off for now.
6. Click **Connect repository**.

   ✓ Backend hits `POST /api/v1/projects/{pid}/github/connect`,
   inserts a row into `github_integrations`. The page swaps to the
   **bound** view with `last_imported / last_exported` both showing
   "Never".

### 4.4  Manual import

1. Click **Import now** → backend pulls the branch HEAD's tree +
   blobs → applies as one MUT commit → 200 with
   `{status: "success", git_sha, mut_commit_id, files_changed}`.
2. **Sync history** table at the bottom shows one ✓ green "Import"
   row.
3. Switch to the **Context** tab — the imported files appear in the
   sidebar (the same WebSocket fan-out as §4.2).
4. Switch to **History** tab — the new commit shows up at the top with
   `who = github:<owner>/<repo>` and message
   `github import: <owner>/<repo>@<branch> (<git_sha>)`.

### 4.5  Manual export

1. In **Context**, edit a file (e.g. add a line to README.md).
2. Back to **Integrations** → **Export now** → backend uploads new
   blobs to GitHub, creates a tree+commit, fast-forwards the branch.
3. Sync history: a new ✓ green "Export" row.
4. Verify on `github.com/<owner>/<repo>/commits/<branch>` that the
   new commit landed, authored by the user (PuppyOne identity).

### 4.6  Disconnect

Click **Disconnect** → confirm → page swaps back to the connect form.
Row deleted from `github_integrations`; sync log rows cascade-deleted.

### 4.7  Optional: webhook auto-import

Only if you want to test `auto_import = true`:

1. Run a tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:9090
   ```

   Copy the printed `https://<random>.trycloudflare.com` URL.

2. In **Integrations** → **Connect** form, this time toggle
   **Auto-import on push** and paste a freshly-generated random
   string into **Webhook secret**.
3. After connecting, the page shows the **Webhook URL** — but
   replace `localhost:9090` with the cloudflared URL when pasting
   into GitHub.
4. On `github.com/<owner>/<repo>/settings/hooks` → **Add webhook**:
   * Payload URL: `https://<cloudflared>.trycloudflare.com/api/v1/integrations/github/webhook`
   * Content type: `application/json`
   * Secret: same secret as above
   * Events: just `push`
5. Push a commit to the bound branch on GitHub. Within ~5s the
   PuppyOne sidebar refreshes (commit_update WebSocket) and a new
   "Import" row with `triggered_by=webhook` lands in the sync log.

---

## 5. Tear-down

```bash
# Backend, frontend: Ctrl-C in their terminals
docker compose down            # redis + minio
npx supabase stop              # supabase containers
```

`supabase stop` keeps the volume around, so the next `supabase start`
boots in seconds with all your test data still there. Add `--no-backup`
to nuke it.

---

## 6. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Backend `ModuleNotFoundError: mut.foundation.git_format` | venv has the PyPI `mutai` not the local one | re-run `uv pip install -e ../../mut` after every `uv sync` |
| GitHub OAuth callback → "redirect_uri mismatch" | OAuth app's callback URL ≠ `GITHUB_REDIRECT_URI` | both must be `http://localhost:3000/oauth/github/callback` exactly |
| Webhook returns 401 "signature mismatch" | secret in `github_integrations.webhook_secret` ≠ what GitHub sent | re-generate, paste the same value into both PuppyOne and GitHub |
| Sidebar doesn't auto-refresh on push | WebSocket failed to connect | DevTools Network → WS — check the upgrade headers; ensure backend's `ws_router.py` accept-subprotocol logic is on the deployed branch |
| `next build` fails on missing translation key | i18n string added to `en.json` but not `zh.json` | only `en.json` exists today; if/when `zh.json` is added, mirror the `integrations.*` block |
