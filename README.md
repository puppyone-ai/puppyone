<p align="center">
  <img src="assets/title-puppyone.jpg" alt="PuppyOne — The context file system built for agents" width="100%" />
</p>

<p align="center">
  <b>The context file system for agents.</b><br>
  With agent-level auth, versioning, and collaboration.
</p>

<p align="center">
  <a href="https://www.puppyone.ai" target="_blank">
    <img src="https://img.shields.io/badge/Web-puppyone.ai-39BC66?style=flat&logo=google-chrome&logoColor=white" alt="Homepage" height="22" />
  </a>
  &nbsp;
  <a href="https://www.puppyone.ai/doc" target="_blank">
    <img src="https://img.shields.io/badge/Docs-puppyone.ai/doc-D7F3FF?style=flat&logo=readthedocs&logoColor=white" alt="Docs" height="22" />
  </a>
  &nbsp;
  <a href="https://x.com/puppyone_ai" target="_blank">
    <img src="https://img.shields.io/badge/X-@puppyone-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="22" />
  </a>
  &nbsp;
  <a href="https://discord.gg/zwJ9Y3Uvpd" target="_blank">
    <img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="22" />
  </a>
</p>

---


## Your agents need more than a file system for context

Most capable agents today are file-based: they read, write, and execute through Bash and local file systems. However, **traditional file systems were never built to be a context infra for agents.**

- **No connectors.** Your data lives in Notion, GitHub, Google Drive, and dozens of other tools. Your agent can't see any of it.
- **No backup and rollback.** A hallucinating agent overwrites a critical file. The previous version is gone.
- **No file-level auth for agents.** Controlling per-agent read/write access with chmod and SSH keys doesn't scale.

## Why PuppyOne? <a href="https://github.com/puppyone-ai/puppyone"><img src="https://img.shields.io/github/stars/puppyone-ai/puppyone?style=flat&logo=github&color=yellow" alt="GitHub Stars" /></a>

PuppyOne is a context file system built only for agents. It directly solves all of the above:

- **15+ Connectors** — Mount Notion, GitHub, Gmail, Google Drive, Airtable, and more into a single directory tree. All data is transformed into agent-friendly formats (Markdown, JSON, raw files).
- **Versioning & Rollback** — Every write is tracked. Diff any file against its history and rollback to a previous state in one click.
- **File-Level Security (FLS)** — Each agent gets its own view of the file tree based on its identity. Files it shouldn't access physically don't exist in its environment.
- **Multi-Channel Access** — Distribute your context via OpenClaw, MCP, Bash, SSH, REST API, or CLI. Agents access it however they work best.
- **Audit Logs** — Full traceability: which agent read, wrote, or deleted which file, and when.


<img src="assets/puppy-filesystem-demo.png" alt="puppyone file system" width="100%" />

---

## Get Started

### 1. Install / Deploy

#### Option A: Cloud (Hosted)

The fastest way — no infrastructure to manage.

Create an account at [puppyone.ai](https://www.puppyone.ai).

#### Option B: Self-Hosted (Docker)

Run the full stack locally with Docker. The only prerequisite is [Docker](https://www.docker.com/).

```bash
git clone https://github.com/puppyone-ai/puppyone.git
cd puppyone/docker
cp .env.example .env
docker compose up -d
```

This starts everything — PostgreSQL, Auth, API gateway, Redis, MinIO, backend, and frontend — in a single command. The database schema is applied automatically on first run.

The Docker defaults already separate browser-facing URLs (`localhost`) from container-internal service URLs (`api`, `kong`), so the same setup works for both client-side and Next.js server-side requests.

The backend container also mounts the host Docker socket and a dedicated sandbox temp directory, so agent bash and sandbox endpoints work out of the box in the local Compose stack without changing the backend's global temp directory behavior.

| Service | URL |
|---------|-----|
| Frontend | `http://localhost:3000` |
| Backend API | `http://localhost:9090` |
| Supabase API | `http://localhost:8000` |
| MinIO Console | `http://localhost:9001` |

> **Security note:** The local Docker stack enables Docker-backed sandboxes by sharing the host Docker daemon with the backend container. This is convenient for local self-hosting, but for remote or multi-tenant deployments you should prefer `SANDBOX_TYPE=e2b` with an `E2B_API_KEY`.

The first startup may take 1-2 minutes. Then open `http://localhost:3000`. If the web app is not reachable yet, run `docker compose ps`.

Optional: to enable agent chat in the self-hosted stack, add your `ANTHROPIC_API_KEY` to `docker/.env` and restart:

```bash
cd docker
docker compose up -d
```

Optional: OAuth connectors such as GitHub, Gmail, and Google Drive require provider credentials in `docker/.env` (for example `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).

### 2. First Run (for both cloud and self-host)

The product flow is the same for Cloud and self-hosted once the stack is running. Start by opening the web app and signing in:

- Cloud: [puppyone.ai](https://www.puppyone.ai)
- Self-Hosted: `http://localhost:3000`

If you want to manage your workspace from the CLI, install it and sign in:

```bash
npm install -g puppyone
puppyone auth login          # first run asks: Cloud / Local / Custom URL
```

For self-hosted, choose `Local` at the prompt or pass `-u http://localhost:9090`.

The CLI stores sessions per target, so you can switch between Cloud and self-hosted without re-entering credentials (`puppyone auth targets switch <url>`).

**1. Create your first Context Space**

```bash
puppyone init "My Project"
```

This creates a project with starter guides and sets it as active. You can also create your first project directly from the web app.

**2. Add your first content**

Start with something that works immediately in both Cloud and self-hosted:

| Source | Command |
|--------|---------|
| Webpage | `puppyone conn add url https://example.com --folder /refs` |
| Local folder | `puppyone conn add folder ./my-docs --folder /docs` |

You can also upload files directly from the web app. Use `--folder` to organize synced content into any path in your Context Space.

### 3. Optional: Enable More Features

- **Agent chat** — In self-hosted deployments, add `ANTHROPIC_API_KEY` to `docker/.env` and restart the stack.
- **OAuth connectors** — In self-hosted deployments, configure provider credentials before using GitHub, Gmail, Google Drive, and other OAuth-based connectors.
- **Distribute via MCP** — Create an MCP endpoint when you want agents in Cursor, Claude Desktop, or other MCP clients to read your Context Space:

```bash
puppyone conn add mcp "My Context"
# → outputs MCP endpoint URL and API key
```

See the [full connector guide](https://www.puppyone.ai/doc) for all 15+ supported platforms and advanced setup details.

---

## Features

### Connected

Connect context from SaaS tools, databases, and the web into agent-friendly files.

PuppyOne provides OAuth connectors for **15+ platforms** — including Notion, GitHub, Gmail, Google Drive, Linear, Airtable, Google Sheets, Google Calendar, and more. It also supports URL scraping, database connections, local folder sync, and custom scripts.

All data is transformed into agent-friendly formats (Markdown, JSON, raw files) and stored in your **Context Space** — a cloud file system that any agent can browse like a local directory.

<img src="assets/connect-demo.gif" alt="Connect data sources" width="100%" />

### Collaborative

Agent-level auth, versioning, audit, and collaboration — built for agents, not humans.

- **File Level Security (FLS)** — Per-agent file permissions enforced at the filesystem layer. If an agent doesn't have access, the file physically doesn't exist in its environment. Think Row Level Security (RLS), but for files.
- **Version history & rollback** — File-level versioning with diff comparison and one-click rollback. Folder-level snapshots for bulk recovery.
- **Audit logs** — Every read and write operation is recorded: who did what, to which file, and when.
- **Checkout / commit workflow** — Locking, conflict detection, and resolution for concurrent agent edits.

<img src="assets/auth-demo.gif" alt="File Level Security" width="100%" />

### Accessible

One Context Space, many ways in. Your agents access it however they work best:

- **MCP (Model Context Protocol)** — Auto-generated MCP endpoints for each agent. Connect Cursor, Claude Desktop, Windsurf, Cline, or any MCP-compatible client in seconds.
- **Sandbox** — Isolated Docker/E2B containers with only the authorized files mounted. Agents execute code securely without seeing anything they shouldn't.
- **REST API** — Full programmatic access. Read, write, query, and manage everything.
- **CLI** — Every operation available via `puppyone` command line, so AI coding tools like Claude Code can drive the platform directly.
- **Local folder sync** — Real-time bidirectional sync between local directories and the cloud Context Space via the OpenClaw protocol.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | [Python 3.12+](https://www.python.org/) / [FastAPI](https://fastapi.tiangolo.com/) |
| Frontend | [Next.js 15](https://nextjs.org/) / React 18 / TypeScript / Tailwind CSS |
| CLI | Node.js / [Commander.js](https://github.com/tj/commander.js) |
| Database | [Supabase](https://supabase.com/) (PostgreSQL) |
| Auth | Supabase Auth (JWT + Access Key) |
| Storage | AWS S3 / MinIO / LocalStack |
| Task Queue | [ARQ](https://github.com/samuelcolvin/arq) (Redis) |
| Sandbox | Docker / [E2B](https://e2b.dev/) |

---

## Contributing

We welcome issues, feature requests, and pull requests.

- For small fixes, open a PR directly.
- For larger changes, [file an issue](https://github.com/puppyone-ai/puppyone/issues/new/choose) first to discuss the design.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

---

## License

This repository uses the PuppyOne Sustainable Use License (SUL).

| Use case | Allowed |
|----------|---------|
| Personal use (individual) | Yes, free |
| Internal business use (single-tenant) | Yes, free |
| Self-hosted multi-tenant | No |
| Commercial redistribution | No |

See [`LICENSE`](LICENSE) for full terms.
