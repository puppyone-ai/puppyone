# PuppyOne (ContextBase)

## Overview

PuppyOne is a **cloud file system built for AI Agents**, centered around two core pillars: **Connect** and **Collaborate**.

It aggregates information scattered across various sources into a unified Context Space, while providing a complete infrastructure for multi-party collaboration between humans and agents — authentication, access control, version history, audit logging, and backup/rollback. Through the file system, bash, and the MCP protocol, any agent can read and write this ContextBase just like a local file system.

### Connect

- **Multi-source data connectors** — OAuth connectors for 15+ platforms including Notion, GitHub, Gmail, Google Drive, Linear, Airtable, and more; also supports URL scraping, database connections, and custom scripts
- **Bidirectional local folder sync** — Real-time sync between local directories and the cloud Context Space (OpenClaw protocol), powered by a background daemon
- **MCP protocol exposure** — Generates standard MCP interfaces for each agent or endpoint; any MCP-compatible client (Claude Desktop, Cursor, etc.) can connect directly
- **Code sandbox** — Securely execute code in isolated Docker/E2B containers; agents can invoke sandbox endpoints remotely

### Collaborate

- **Authentication & access control** — JWT for human users + Access Key for machine authentication; agent-level node access permissions
- **Version history & rollback** — File-level version management, arbitrary version diff comparison, one-click rollback; folder-level snapshots
- **Audit logging** — Records all operations (who did what to which node, and when), fully traceable
- **Collaborative editing** — Checkout/commit workflow, locking mechanism, conflict detection and resolution
- **Structured data management** — Cloud file system (folders/JSON/Markdown/files), JSON Pointer table operations

### Platform

- **Agent management** — Create agents, bind tools, control access scope, SSE streaming chat
- **Full CLI coverage** — Every operation available via command line, enabling AI coding tools like Claude Code to drive the platform directly
- **Unified connection management** — All connection types (sync/agent/MCP/sandbox/filesystem) consolidated into a single `connections` table with a single entry point

## Active Development Directories

- **`backend/`** — Python (FastAPI) backend service
- **`frontend/`** — Next.js frontend application
- **`cli/`** — Node.js command-line tool (Commander.js)
- **`sandbox/`** — Docker sandbox environment (JSON editing / code execution)

## Deprecated Directories (do not modify)

- `PuppyEngine`, `PuppyFlow`, `PuppyStorage`, `tools`

---

## Backend

- **Language**: Python 3.12+
- **Framework**: FastAPI + Uvicorn (ASGI)
- **Package manager**: uv (`pyproject.toml`)
- **Database**: Supabase (PostgreSQL)
- **Storage**: AWS S3 / LocalStack
- **LLM gateway**: LiteLLM
- **Task queue**: ARQ (Redis)
- **Logging**: Loguru

### Directory Structure

```
backend/
├── src/
│   ├── main.py                # App entrypoint & lifespan
│   ├── config.py              # Global config (Pydantic Settings)
│   ├── auth/                  # JWT auth (Supabase Auth)
│   ├── organization/          # Org management & member invitations
│   ├── project/               # Project CRUD & members & dashboard
│   ├── content_node/          # Content node tree (folder/JSON/MD/file) & versions
│   ├── table/                 # Structured data tables (JSON Pointer)
│   ├── tool/                  # Tool registration & search index
│   ├── connectors/            # All connection types (peer-level)
│   │   ├── manager/           # Unified connection CRUD (connections table)
│   │   ├── datasource/        # SaaS data source providers (Gmail/GitHub/Notion/...)
│   │   │   ├── gmail/         #   Gmail connector
│   │   │   ├── github/        #   GitHub connector
│   │   │   ├── google_drive/  #   Google Drive connector
│   │   │   ├── google_docs/   #   Google Docs connector
│   │   │   ├── google_sheets/ #   Google Sheets connector
│   │   │   ├── google_calendar/ # Google Calendar connector
│   │   │   ├── google_search_console/ # GSC connector
│   │   │   ├── url/           #   URL/web page connector
│   │   │   └── _base.py       #   BaseConnector & ConnectorSpec
│   │   ├── filesystem/        # Bidirectional local folder sync (OpenClaw)
│   │   │   └── io/            #   Pure file I/O engine (scan/diff/write/watch)
│   │   ├── mcp/               # MCP protocol endpoints
│   │   ├── sandbox/           # Code sandbox endpoints
│   │   └── agent/             # AI agents (config, chat, MCP tool binding)
│   │       ├── config/        #   Agent CRUD & access permissions
│   │       └── mcp/           #   MCP v3 tool binding & proxy
│   ├── mcp/                   # Legacy MCP instance management (health checks only)
│   ├── upload/                # File ingestion ETL (MineRU + LLM)
│   ├── collaboration/         # Mut compat layer & audit logs (version history via mut_core)
│   ├── search/                # Vector search (Turbopuffer + RRF)
│   ├── chunking/              # Text chunking
│   ├── llm/                   # LLM service (generation + embedding)
│   ├── oauth/                 # OAuth integration (9+ platforms)
│   ├── s3/                    # S3 storage service
│   ├── db_connector/          # External database connector
│   ├── context_publish/       # Public JSON publishing (short links)
│   ├── analytics/             # Usage analytics
│   ├── profile/               # User profile & onboarding status
│   ├── scheduler/             # Scheduled tasks (APScheduler)
│   ├── security/              # Security module (AES-256-GCM)
│   ├── internal/              # Internal API (X-Internal-Secret)
│   ├── supabase/              # Supabase client & repository
│   ├── turbopuffer/           # Turbopuffer vector DB client
│   ├── workspace/             # Workspace management
│   └── utils/                 # Utilities (logging/middleware)
├── mcp_service/               # Standalone MCP Server service (FastMCP)
├── sql/                       # Database DDL & migrations
├── tests/                     # Tests
├── scripts/                   # Scripts
└── docs/                      # Feature documentation
```

### Development Conventions

- **Layered architecture**: `Router → Service → Repository (Supabase)` three-tier separation
- **Dependency injection**: Use FastAPI `Depends` to inject Service and Repository
- **Fully async**: All I/O operations use `async/await`
- **Pydantic models**: All request/response defined with Pydantic schemas
- **Naming conventions**: Files `snake_case.py`, classes `PascalCase`, functions/variables `snake_case`
- **DB table naming**: All table names use **plural snake_case** (e.g. `projects`, `content_nodes`, `connections`)
- **Route prefix**: Business APIs under `/api/v1`, internal APIs under `/internal`
- **Module structure**: Each module typically contains `router.py`, `service.py`, `repository.py`, `schemas.py`

### Database Tables

All tables use plural snake_case names. The "unified connections" architecture stores agents, MCP endpoints, sandbox endpoints, and sync connections in a single `connections` table differentiated by `provider`/`direction`.

| Table | Repository | Description |
|-------|-----------|-------------|
| `projects` | `supabase/projects/repository.py` | Projects |
| `project_members` | `project/repository.py`, `project/service.py` | Project membership |
| `organizations` | `organization/repository.py` | Organizations |
| `org_members` | `organization/repository.py` | Organization membership |
| `org_invitations` | `organization/repository.py` | Organization invitations |
| `profiles` | `profile/repository.py` | User profiles |
| `connections` | `connectors/manager/router.py`, `connectors/agent/config/repository.py` | Unified connections (agents/MCP/sandbox/sync) |
| `connection_accesses` | `connectors/agent/config/repository.py` | Agent ↔ content node access bindings |
| `connection_tools` | `connectors/agent/config/repository.py`, `tool/service.py` | Agent ↔ tool bindings |
| `content_nodes` | `content_node/repository.py` | Content tree (folder/JSON/MD/file) |
| `tools` | `supabase/tools/repository.py` | Registered tools |
| `mcps` | `supabase/mcps/repository.py`, `supabase/mcp_v2/repository.py` | MCP server instances |
| `mcp_bindings` | `supabase/mcp_binding/repository.py` | MCP ↔ tool bindings |
| `chunks` | `chunking/repository.py` | Text chunks for search |
| `uploads` | `upload/file/tasks/repository.py` | File upload/ingest tasks |
| `etl_rules` | `upload/file/rules/repository_supabase.py` | ETL transformation rules |
| `context_publishes` | `supabase/context_publish/repository.py` | Public JSON short links |
| `oauth_connections` | `oauth/repository.py` | OAuth integrations |
| `chat_sessions` | `agent/chat/repository.py` | Agent chat sessions |
| `chat_messages` | `agent/chat/repository.py` | Agent chat messages |
| `agent_execution_logs` | `agent/config/repository.py`, `scheduler/jobs/agent_job.py` | Scheduled agent execution logs |
| `file_versions` | _(deprecated — no longer used in code)_ | Legacy file version history |
| `folder_snapshots` | _(deprecated — no longer used in code)_ | Legacy folder snapshots |
| `mut_commits` | `mut_core/backends/supabase_history.py` | Mut version history (per-project commits) |
| `audit_logs` | `collaboration/audit_repository.py`, `mut_core/backends/supabase_audit.py` | Audit trail |
| `search_index_tasks` | `project/dashboard_router.py` | Search indexing tasks |
| `ingest_tasks` | `project/dashboard_router.py` | Ingestion tasks |
| `agent_logs` | `analytics/service.py` | Agent usage analytics |
| `access_logs` | `analytics/service.py`, `analytics/router.py` | API access analytics |

### API Routes

| Route Prefix | Module | Description |
|-------------|--------|-------------|
| `/api/v1/organizations` | organization | Org CRUD & members & invitations |
| `/api/v1/projects` | project | Project CRUD & members & dashboard |
| `/api/v1/nodes` | content_node | Content nodes (folder/JSON/MD/file) & versions |
| `/api/v1/tables` | table | Data tables & JSON Pointer operations |
| `/api/v1/tools` | tool | Tool registration & search index |
| `/api/v1/agents` | connectors/agent | Agent SSE streaming chat |
| `/api/v1/agent-config` | connectors/agent/config | Agent CRUD & access permissions |
| `/api/v1/mcp` | connectors/agent/mcp | MCP v3 tool binding & proxy |
| `/api/v1/mcp-endpoints` | connectors/mcp | MCP endpoint CRUD & API key |
| `/api/v1/sandbox-endpoints` | connectors/sandbox | Sandbox endpoint CRUD & exec |
| `/api/v1/connections` | connectors/manager | Unified connection management (all types) |
| `/api/v1/sync` | connectors/datasource | Data source sync & OpenClaw & folder push/pull |
| `/api/v1/ingest` | upload | File/URL ingestion ETL |
| `/api/v1/collab` | collaboration | Collaborative editing & versions & audit |
| `/api/v1/workspace` | workspace | Workspace management |
| `/api/v1/db-connector` | db_connector | External database connections |
| `/api/v1/publishes` | context_publish | Public JSON short links |
| `/api/v1/oauth` | oauth | OAuth authorization (9+ platforms) |
| `/api/v1/auth` | auth | Authentication (login/refresh) |
| `/api/v1/analytics` | analytics | Usage statistics |
| `/api/v1/profile` | profile | User profile & onboarding |
| `/api/v1/s3` | s3 | File upload/download/presigned URLs |
| `/internal` | internal | Internal service API |
| `/p/{key}` | context_publish | Public JSON access (no auth required) |
| `/health` | main | Health check |

### Common Commands

```bash
# Install dependencies
uv sync

# Start dev server
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info --no-access-log

# Run tests
uv run pytest
uv run pytest -m "not e2e"      # Exclude e2e tests

# Start file worker (ETL / OCR)
uv run arq src.upload.file.jobs.worker.WorkerSettings
```

### Deployment

Railway multi-service deployment (shared codebase, differentiated by `SERVICE_ROLE`):

- **api** (default): Main API service
- **file_worker**: File ETL Worker (ARQ)
- **mcp_server**: MCP protocol service (FastMCP)

---

## Frontend

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **UI**: React 18 + Tailwind CSS
- **Auth**: Supabase Auth
- **State management**: Zustand + React Context
- **Data fetching**: SWR

### Directory Structure

```
frontend/
├── app/                          # Next.js App Router pages
│   ├── (main)/                   # Route group (shared AppSidebar layout)
│   │   ├── projects/             # Projects module
│   │   │   └── [projectId]/      # Project detail pages
│   │   │       ├── data/         # Data explorer
│   │   │       ├── connections/  # Connection management
│   │   │       ├── toolkit/      # Agent toolkit
│   │   │       ├── monitor/      # Monitoring
│   │   │       └── settings/     # Project settings
│   │   ├── settings/             # Global settings
│   │   ├── tools-and-server/     # Tools & MCP server management
│   │   ├── home/                 # Home / dashboard
│   │   ├── billing/              # Billing
│   │   └── team/                 # Team management
│   ├── api/                      # API routes (agent, sandbox)
│   ├── auth/                     # Auth callbacks
│   ├── login/                    # Login page
│   ├── onboarding/               # Onboarding flow
│   └── oauth/                    # OAuth callbacks (multi-platform)
├── components/                    # React components
│   ├── agent/                    # Agent components
│   ├── chat/                     # Chat interface
│   ├── dashboard/                # Dashboard components
│   ├── editors/                  # Editors (JSON/Markdown/Code)
│   │   ├── code/                 # Monaco / CodeMirror
│   │   ├── markdown/             # Milkdown Markdown editor
│   │   ├── table/                # Tabular JSON editor
│   │   ├── tree/                 # Tree JSON editor
│   │   └── vanilla/              # Vanilla JSON editor
│   ├── sidebar/                  # Sidebar
│   ├── views/                    # Shared view components
│   ├── onboarding/               # Onboarding components
│   └── RightAuxiliaryPanel/      # Right auxiliary panel
├── lib/                          # Utilities & API clients
│   ├── hooks/                    # Custom React hooks
│   ├── apiClient.ts              # Base API client
│   ├── chatApi.ts                # Chat API
│   ├── contentNodesApi.ts        # Content nodes API
│   ├── mcpApi.ts                 # MCP API
│   ├── mcpEndpointsApi.ts        # MCP endpoints API
│   ├── sandboxEndpointsApi.ts    # Sandbox endpoints API
│   ├── projectsApi.ts            # Projects API
│   ├── organizationsApi.ts       # Organizations API
│   ├── oauthApi.ts               # OAuth API
│   ├── ingestApi.ts              # Ingestion API
│   ├── dbConnectorApi.ts         # Database connector API
│   └── profileApi.ts             # User profile API
├── contexts/                     # React Context
│   ├── AgentContext.tsx           # Agent state management
│   └── WorkspaceContext.tsx       # Workspace state management
├── middleware.ts                  # Next.js middleware (auth & routing)
└── next.config.ts                # Next.js config
```

### Common Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build
```

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Supabase URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Supabase anon key
NEXT_PUBLIC_API_URL             # Backend API URL (default http://localhost:9090)
NEXT_PUBLIC_DEV_MODE            # Dev mode flag
```

---

## CLI

- **Language**: JavaScript (ESM)
- **Framework**: Commander.js
- **Install**: `npm install -g puppyone`

### Directory Structure

```
cli/
├── bin/puppyone.js             # Entrypoint & command registration
├── src/
│   ├── commands/               # Command implementations
│   │   ├── auth.js             # Auth (login/logout/whoami)
│   │   ├── org.js              # Organization management
│   │   ├── project.js          # Project management
│   │   ├── fs.js               # Cloud file system (POSIX-like)
│   │   ├── connection.js       # Unified connection management (add/ls/info/rm/...)
│   │   ├── sync.js             # Data source sync
│   │   ├── access.js           # Local folder sync (daemon)
│   │   ├── agent-cmd.js        # Agent CRUD & chat
│   │   ├── mcp.js              # MCP endpoint management
│   │   ├── sandbox.js          # Sandbox management & exec
│   │   ├── tool.js             # Tool management
│   │   ├── table.js            # Data table operations
│   │   ├── ingest.js           # File/URL ingestion
│   │   ├── publish.js          # Public publishing
│   │   ├── db.js               # Database connector
│   │   ├── config-cmd.js       # CLI configuration
│   │   ├── global.js           # Global commands (status/ps/ls)
│   │   └── openclaw.js         # Folder sync core logic
│   ├── api.js                  # HTTP client
│   ├── config.js               # Config file read/write
│   ├── daemon.js               # Background daemon management
│   ├── registry.js             # Local connection registry
│   ├── output.js               # Output formatting (human/JSON)
│   ├── helpers.js              # Shared utilities
│   └── state.js                # Sync state management
├── SPEC.md                     # CLI interface spec
└── DESIGN.md                   # CLI design doc
```

### Key Commands

```bash
puppyone auth login              # Sign in
puppyone project use "My Project" # Set active project
puppyone fs ls                   # Browse cloud files
puppyone conn add notion <url>   # Connect a data source (unified entry)
puppyone conn add folder ~/path  # Mount a local folder
puppyone conn add mcp "name"     # Create an MCP endpoint
puppyone conn add sandbox "name" # Create a sandbox
puppyone conn ls                 # List all connections
puppyone status                  # Project dashboard
puppyone agent chat              # Chat with an agent
```

See `cli/SPEC.md` for full reference.

---

## Sandbox

Lightweight Docker sandbox environment for securely executing CLI commands (e.g. `jq` for JSON editing) in isolated containers.

```
sandbox/
├── README.md          # Usage docs
├── Dockerfile         # Alpine + jq/bash/coreutils
└── test-data.json     # Sample test data
```

Both the frontend (`app/api/sandbox/route.ts`) and backend (`src/sandbox/`) integrate with sandboxes; the backend also supports E2B cloud sandboxes.

---

## Other Directories

| Directory | Description |
|-----------|-------------|
| `docs/` | Project-level documentation |
| `assert/` | Static assets |
| `puppydoc/` | Documentation resources |
| `scripts/` | Utility scripts |
| `todo/` | Todo items |
| `.github/` | GitHub Actions & CI |
