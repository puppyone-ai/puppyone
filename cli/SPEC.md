# PuppyOne CLI — Interface Spec v1.0.0

PuppyOne CLI provides complete access to the PuppyOne cloud file system for LLM agents, including organization/project management, file operations, data source sync, ingestion, structured tables, tools, agents, MCP servers, sandboxes, and context publishing.

## Quick Start

```bash
# Install
npm install -g puppyone

# Login
puppyone auth login -e user@example.com -p password

# Set active org & project
puppyone org use "My Organization"
puppyone project use "My Project"

# Browse cloud file system
puppyone fs ls
puppyone fs tree
puppyone fs cat /docs/readme.md

# Sync a data source
puppyone sync auth notion
puppyone sync add notion https://notion.so/my-database --folder /docs

# Local folder sync
puppyone access up ~/workspace --key <access-key>

# Chat with an agent
puppyone agent chat -m "Summarize the project docs"
```

## Global Options

```
-V, --version        Show version
-u, --api-url <url>  PuppyOne API URL (overrides config)
-k, --api-key <key>  API key / token (overrides config)
--json               Output as JSON (for AI / scripts)
-v, --verbose        Verbose output
-p, --project <id>   Project ID (overrides active project)
-o, --org <id>       Organization ID (overrides active org)
```

## Command Reference

### `auth` — Authentication

```
puppyone auth login [-e email] [-p password]   Sign in (interactive or flags)
puppyone auth login -k <token>                 Sign in with token
puppyone auth logout                           Clear credentials
puppyone auth whoami                           Show identity & status
```

### `org` — Organization Management

```
puppyone org ls                      List organizations
puppyone org create <name>           Create organization
puppyone org use <id-or-name>        Set active organization
puppyone org current                 Show active organization
puppyone org info [id]               Organization details
puppyone org members [id]            List members
puppyone org invite <email> [id]     Invite member (-r role)
puppyone org update [id]             Update org (--name)
puppyone org set-role <uid> <role>   Change member role
puppyone org remove-member <uid>     Remove member
puppyone org leave [id]              Leave organization
puppyone org rm <id>                 Delete organization
```

### `project` (alias: `p`) — Project Management

```
puppyone project ls                  List projects in active org
puppyone project create <name>       Create project (-d description)
puppyone project use <id-or-name>    Set active project
puppyone project current             Show active project
puppyone project info [id]           Project details
puppyone project update [id]         Update project (--name, -d)
puppyone project rm <id>             Delete project
```

### `fs` — Cloud File System

POSIX-like interface to the content node tree backed by Supabase + S3.

```
puppyone fs ls [path]                List files/folders (-l for details)
puppyone fs tree [path]              Tree view (-d depth)
puppyone fs cat <path>               Read file content
puppyone fs mkdir <path>             Create folder
puppyone fs touch <path>             Create empty file (-t json|markdown)
puppyone fs write <path>             Write content (-d data, -f file, or stdin)
puppyone fs mv <src> <dst>           Move or rename
puppyone fs rm <path>                Soft delete
puppyone fs info <path>              Detailed node info
puppyone fs upload <local> [remote]  Upload local file
puppyone fs download <remote> [local] Download to local
puppyone fs versions <path>          Version history
puppyone fs diff <path> <v1> <v2>    Compare two versions
puppyone fs rollback <path> <ver>    Rollback to previous version
puppyone fs audit <path>             Audit log
```

### `sync` — Data Source Sync

Sync external data sources into your project. Each sync defines a **source → destination** binding with a trigger policy.

```
puppyone sync providers              List all supported providers
puppyone sync auth <provider>        Authorize an OAuth provider
puppyone sync auth-status <provider> Check OAuth status
puppyone sync add <provider> [src]   Add sync (--folder, --mode, --api-key, --config)
puppyone sync ls                     List active syncs (--provider)
puppyone sync info <id>              Sync details (source → destination)
puppyone sync rm <id>                Remove sync
puppyone sync refresh <id>           Manual pull
puppyone sync pause <id>             Pause sync
puppyone sync resume <id>            Resume sync
puppyone sync trigger <id> <mode>    Update trigger mode
puppyone sync log                    Sync changelog (-n limit)
```

**Supported providers (15):**

| Provider | Auth | CLI aliases | Example |
|----------|------|-------------|---------|
| Notion | OAuth | `notion` | `sync add notion https://notion.so/db-id` |
| GitHub | OAuth | `github`, `gh` | `sync add github https://github.com/org/repo` |
| Google Drive | OAuth | `gdrive`, `google-drive` | `sync add gdrive https://drive.google.com/...` |
| Google Docs | OAuth | `gdocs`, `google-docs` | `sync add gdocs https://docs.google.com/...` |
| Google Sheets | OAuth | `gsheets`, `google-sheets` | `sync add gsheets https://docs.google.com/spreadsheets/...` |
| Gmail | OAuth | `gmail` | `sync add gmail` |
| Google Calendar | OAuth | `gcal`, `google-calendar` | `sync add gcal` |
| Linear | OAuth | `linear` | `sync add linear` |
| Airtable | OAuth | `airtable` | `sync add airtable https://airtable.com/...` |
| Google Search Console | OAuth | `gsc`, `google-search-console` | `sync add gsc --config '{"site_url":"..."}'` |
| URL / Web | None | `url`, `web` | `sync add url https://example.com/data` |
| Hacker News | None | `hn`, `hackernews` | `sync add hn topstories` |
| PostHog | API Key | `posthog`, `ph` | `sync add posthog --api-key phx_... --config '{...}'` |
| Custom Script | None | `script` | `sync add script --runtime python --script ./fetch.py` |
| Local Folder | Access Key | (use `access` commands) | `access up ~/folder --key <key>` |

**Sync modes:** `import_once` (default), `manual`, `scheduled`
**Directions:** `inbound` (default), `outbound`, `bidirectional`

### `ingest` — Data Ingestion

One-off file/URL import (vs `sync` which is persistent).

```
puppyone ingest file <path>          Ingest local file (--mode raw|ocr_parse, --folder)
puppyone ingest url <url>            Ingest from URL (--folder, --name)
puppyone ingest status <task-id>     Check task status
puppyone ingest tasks                List recent tasks
puppyone ingest cancel <task-id>     Cancel a task
```

### `table` (alias: `t`) — Structured Data Tables

JSON Pointer-based CRUD for structured data.

```
puppyone table ls                    List tables
puppyone table create <name>         Create table (-d data, --node)
puppyone table get <id>              Get table (--pointer for subpath)
puppyone table update <id>           Update metadata (--name, --description, -d data)
puppyone table set <id> <ptr> <k> <v> Set data at JSON Pointer
puppyone table add <id> <ptr> <k> <v> Add data at mount path
puppyone table del <id> <ptr> <keys..> Delete keys at pointer
puppyone table rm <id>               Delete table
```

### `tool` — Tool Management

Tools are callable capabilities exposed to agents via MCP. The most common type is `search` — vector search over content nodes.

```
puppyone tool ls                     List tools (--project)
puppyone tool create <name>          Create tool (--type, --node, --description)
puppyone tool info <id>              Tool details + search index status
puppyone tool update <id>            Update tool (--name, --description)
puppyone tool rm <id>                Delete tool
```

### `agent` — Agent Management

```
puppyone agent ls                    List agents
puppyone agent create <name>         Create agent (--type, --model, --system-prompt)
puppyone agent info <id>             Agent details
puppyone agent update <id>           Update agent (--name, --model, --system-prompt)
puppyone agent rm <id>               Delete agent
puppyone agent chat [id]             Interactive chat (-m for single message)
```

### `mcp` — MCP Server Management

```
puppyone mcp ls                      List MCP endpoints
puppyone mcp create <name>           Create endpoint (--url)
puppyone mcp info <id>               Endpoint details
puppyone mcp update <id>             Update endpoint (--name, --url)
puppyone mcp rm <id>                 Delete endpoint
puppyone mcp key <id>                Regenerate API key
puppyone mcp tools <agent-id>        List bound tools
puppyone mcp bind <agent> <tool>     Bind tool to agent
puppyone mcp unbind <agent> <tool>   Unbind tool from agent
```

### `publish` — Context Publishing

Create public JSON endpoints for sharing data.

```
puppyone publish ls                  List published endpoints
puppyone publish create <node-id>    Create publish (--key)
puppyone publish rm <id>             Delete publish
puppyone publish url <key>           Fetch public data
```

### `db` — Database Connector

Connect external databases, browse tables, and import into the project.

```
puppyone db connect <conn-string>    Create DB connection (--name, --type)
puppyone db ls                       List connections
puppyone db rm <id>                  Remove connection
puppyone db tables <id>              List tables
puppyone db preview <id> <table>     Preview table data
puppyone db save <id>                Save table as content node
```

### `sandbox` (alias: `sbx`) — Code Sandbox

Manage sandbox execution environments.

```
puppyone sandbox ls                  List sandbox endpoints
puppyone sandbox create <name>       Create endpoint (--type)
puppyone sandbox info <id>           Endpoint details
puppyone sandbox rm <id>             Delete endpoint
puppyone sandbox key <id>            Regenerate API key
```

### `config` — CLI Configuration

```
puppyone config show                 Show current config
puppyone config set <key> <value>    Set config value
puppyone config path                 Show config file paths
puppyone config reset                Reset to defaults
```

### `access` (aliases: `openclaw`, `oc`) — Local Folder Sync

Bidirectional sync between a local folder and PuppyOne via a background daemon.

```
puppyone access up <path>            Start sync daemon (--key on first run)
puppyone access down <path>          Stop sync daemon
puppyone access connect <path>       First-time connect
puppyone access disconnect <path>    Stop and disconnect
puppyone access remove <path>        Same as disconnect
puppyone access ls                   List connections
puppyone access ps                   List running daemons
puppyone access status [path]        Connection status
puppyone access logs <path>          Show daemon logs (-f follow, -n lines)
puppyone access trigger <path>       Force immediate sync
```

Top-level shortcuts: `puppyone ps` = `access ps`

### `status` — Project Dashboard

When run without arguments (or with `-p <project-id>`), shows an aggregated project dashboard including node counts, all connections, tools, and active uploads. When a local workspace path is given, falls back to access daemon status.

```
puppyone status                      Project dashboard (requires active project)
puppyone status ~/workspace          Local workspace daemon status (fallback)
```

### `connection` (alias: `conn`) — Unified Connection Management

**The single entry point for creating and managing ALL connections** — syncs, agents, MCP endpoints, sandbox environments, and filesystem mounts. Everything flows through the unified `connections` table.

```
puppyone conn add <type> [source]    Create any connection (see types below)
puppyone conn ls                     List all connections (--provider, --status)
puppyone conn info <id>              Detailed info + type-specific guidance
puppyone conn pause <id>             Pause a connection
puppyone conn resume <id>            Resume a paused connection
puppyone conn rm <id>                Delete any connection
puppyone conn key <id>               Show access key (--regenerate to rotate)
puppyone conn refresh <id>           Trigger a manual sync refresh
puppyone conn trigger <id> <mode>    Set trigger mode (manual|import_once|scheduled|realtime)
```

**`conn add` types:**

| Type | Aliases | Example |
|------|---------|---------|
| `notion` | — | `conn add notion https://notion.so/db-id --folder /docs` |
| `github` | `gh` | `conn add github https://github.com/org/repo` |
| `gmail` | — | `conn add gmail` |
| `gdrive` | `google-drive` | `conn add gdrive https://drive.google.com/...` |
| `url` | `web` | `conn add url https://example.com/feed` |
| `agent` | — | `conn add agent "My Bot" --model gpt-4o` |
| `mcp` | — | `conn add mcp "My Endpoint"` |
| `sandbox` | — | `conn add sandbox "My Sandbox" --type e2b` |
| `folder` | `filesystem`, `local` | `conn add folder ~/workspace --name "Dev Sync"` |
| `posthog` | `ph` | `conn add posthog --api-key phx_... --config '{...}'` |
| ... | | All 15+ sync providers supported |

**Options for `conn add`:**

```
--name <name>             Connection name
--folder <folder>         Target folder in project (for syncs)
--mode <mode>             Sync mode: import_once | manual | scheduled
--model <model>           LLM model (for agent type)
--system-prompt <prompt>  System prompt (for agent type)
--type <subtype>          Sub-type: chat|devbox (agent), e2b|docker (sandbox)
--api-key <key>           Provider API key (for posthog, etc.)
--config <json>           Provider-specific config as JSON
```

## Configuration

### Global: `~/.puppyone/config.json`

```json
{
  "api_url": "http://localhost:9090",
  "api_key": "<jwt-token>",
  "refresh_token": "<refresh-token>",
  "user_email": "user@example.com",
  "token_expires_at": 1735689600,
  "active_org": { "id": "uuid", "name": "My Org" },
  "active_project": { "id": "uuid", "name": "My Project" }
}
```

### Per-Workspace: `<workspace>/.puppyone/`

`state.json`, `daemon.pid`, `daemon.log`, `stats.json`, `backups/`

### Registry: `~/.puppyone/registry.json`

Maps workspace paths to connection info for `access` commands.

## JSON Output

All commands support `--json` for machine-readable output:

```bash
puppyone project ls --json | jq '.projects[].name'
puppyone fs ls /docs --json | jq '.nodes[] | .name'
puppyone sync ls --json | jq '.syncs[] | {id, provider, status}'
```

## Typical Workflows

### Setup project with multiple data sources (unified via `conn add`)

```bash
puppyone auth login
puppyone org use "My Company"
puppyone project create "Knowledge Base" && puppyone project use "Knowledge Base"
puppyone fs mkdir /docs

# OAuth sources (auth first, then add)
puppyone sync auth notion
puppyone conn add notion https://notion.so/db-id --folder /docs
puppyone sync auth github
puppyone conn add github https://github.com/org/repo --folder /code

# No-auth sources
puppyone conn add url https://example.com/api/feed --folder /imports
puppyone conn add hn topstories --folder /news --mode scheduled

# API-key source
puppyone conn add posthog --api-key phx_xxx --config '{"project_id":"123","mode":"events"}'

# View everything
puppyone conn ls
puppyone status
```

### Mount a local folder

```bash
# Option 1: one-step — auto-creates agent + starts daemon
puppyone conn add folder ~/workspace --name "My Dev Folder"
puppyone access up ~/workspace

# Option 2: zero-friction — just start syncing (auto-creates agent)
puppyone access up ~/workspace
```

### Create an MCP endpoint

```bash
# Create the endpoint — shows API key + connection instructions
puppyone conn add mcp "Context API"
# Output includes:
#   npx -y mcp-remote https://api.puppyone.com/mcp?api_key=<key>
#   .mcp.json snippet for Claude / Cursor

# Manage later
puppyone conn ls --provider mcp
puppyone conn key <id>
puppyone conn rm <id>
```

### Create a sandbox environment

```bash
# Create — shows access key + exec instructions
puppyone conn add sandbox "Python Runner" --type e2b

# Execute commands
puppyone sandbox exec <id> "pip install pandas && python script.py"

# Manage later
puppyone conn ls --provider sandbox
puppyone conn pause <id>
puppyone conn rm <id>
```

### Agent + tools workflow

```bash
puppyone conn add agent "Research Bot" --model gpt-4o --system-prompt "Research assistant"
puppyone tool create "docs-search" --type search --node <folder-id>
puppyone mcp bind <agent-id> <tool-id>
puppyone agent chat <agent-id>
```

### File system operations

```bash
puppyone fs tree
puppyone fs touch /notes/meeting.md
puppyone fs write /notes/meeting.md -f ~/meeting-notes.md
puppyone fs upload ~/report.pdf /reports
puppyone fs versions /notes/meeting.md
puppyone fs rollback /notes/meeting.md 2
puppyone fs download /exports/data.json ./
```

### Manage all connections from one place

```bash
puppyone conn ls                           # see everything
puppyone conn ls --provider notion         # filter by type
puppyone conn ls --status error            # find broken ones
puppyone conn info <id>                    # details + guidance
puppyone conn pause <id>                   # pause any connection
puppyone conn key <id> --regenerate        # rotate access key
puppyone conn rm <id>                      # delete any connection
```
