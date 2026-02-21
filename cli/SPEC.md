# PuppyOne CLI — Interface Specification

> Version: 0.4.0 | 2026-02-21

## Quick Start (OpenClaw)

The fastest way to sync PuppyOne data with an OpenClaw agent workspace:

```bash
npm install -g puppyone
puppyone connect --key <access-key> ~/openclaw-workspace -u <api-url>
puppyone watch --key <access-key>
```

That's it. Three commands: install, connect, watch.

---

## Two Modes

The CLI supports two independent operating modes:

| Mode | Auth | Use Case | Endpoints |
|------|------|----------|-----------|
| **OpenClaw mode** (`--key`) | Access Key (`X-Access-Key`) | Distribute PuppyOne data to agent workspaces | `/api/v1/access/openclaw/*` |
| **Sync mode** (login) | JWT Bearer | Connect local folders as information sources | `/api/v1/sync/sources/*` |

OpenClaw mode is for **distribution** (PuppyOne → agent). Sync mode is for **collection** (local files → PuppyOne).

---

## OpenClaw Mode Commands

### `puppyone connect --key`

First-time connection: merge-sync the workspace folder with PuppyOne, then save the connection locally.

```bash
puppyone connect --key <access-key> <folder> [-u <api-url>] [--dir <subdir>]
```

| Arg/Flag | Required | Default | Description |
|----------|----------|---------|-------------|
| `--key` | Yes | | Access key (`cli_` prefix, from PuppyOne UI) |
| `<folder>` | Yes | | OpenClaw workspace folder path |
| `-u, --api-url` | First time only | `http://localhost:9090` | PuppyOne API URL (saved for reuse) |

#### Sync Strategy: Merge

On first connect, the CLI merges both sides so they end up identical:

| Cloud | Local | Action |
|-------|-------|--------|
| Has file | Missing | Cloud → write to local |
| Missing | Has file | Local → push to cloud (create new node) |
| Has file | Has file, same content | Skip |
| Has file | Has file, different content | **Cloud wins** → overwrite local, backup old local to `.puppyone/backups/` |

After merge, both sides have exactly the same files.

**What happens behind the scenes:**
1. `POST /api/v1/access/openclaw/connect { workspace_path }` — registers connection, returns cloud node list
2. Scans local folder recursively (excluding `.puppyone/`, `.git/`, `node_modules/`, etc.)
3. Compares cloud nodes vs local files by filename
4. Executes merge: pulls missing files from cloud, pushes missing files to cloud
5. For conflicts (same filename, different content): cloud wins, local backed up
6. Saves connection to `~/.puppyone/config.json` under `openclaw_connections[]`

**Example output:**
```
Connecting to PuppyOne...  ✓
  Agent:   My OpenClaw Bot
  Project: Marketing Context

Merging ~/openclaw-workspace ↔ PuppyOne...

  ↓ product_info.json        cloud → local (new)
  ↓ pricing.json             cloud → local (new)
  ↑ agent.md                 local → cloud (new node created)
  ↑ soul.md                  local → cloud (new node created)
  = faq.md                   identical, skip
  ↓ config.json              conflict → cloud wins, local backed up

✅ Synced. 2 pulled, 2 pushed, 1 conflict, 1 skipped.
```

---

### `puppyone pull --key`

One-time pull: download latest cloud data to local folder.

```bash
puppyone pull --key <access-key>
```

Pulls all nodes from cloud. Writes new files, overwrites changed files, skips unchanged. Does NOT push local changes.

---

### `puppyone watch --key`

Continuous bidirectional sync. Runs in foreground.

```bash
puppyone watch --key <access-key> [-i <interval>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-i, --interval` | `30` | Remote poll interval in seconds (min 5) |

#### How watch works

Two sync directions run simultaneously:

**Local → Cloud (file watcher):**
- chokidar monitors the workspace folder
- File modified → push to cloud (update existing node)
- File created → push to cloud (create new node)
- File deleted → notify cloud (archive/delete node)
- Debounced 500ms to avoid rapid-fire syncs

**Cloud → Local (polling):**
- Every `interval` seconds, pull latest node versions
- Node content changed → overwrite local file
- New node created → write new local file
- Node deleted → delete local file

**Conflict resolution (both sides changed same file):**
- Cloud wins → overwrite local
- Local version backed up to `.puppyone/backups/<filename>.<timestamp>`

**Startup reconciliation:**
- On every `watch` start, a full merge runs first (same logic as `connect`)
- Ensures nothing was missed while watch was not running

**Example output:**
```
Watching ~/openclaw-workspace ↔ PuppyOne
  API: https://api.puppyone.com
  Poll: 30s

  ↑ soul.md → v4
  ↓ product_info.json v3 → v4
  ↑ new_report.md → v1 (created)
  ↓ config.json v5 → v6 (conflict, cloud wins, backed up)

Ctrl+C to stop.
```

---

### `puppyone disconnect --key`

Remove the connection. Deletes server-side sync source + local config. Does NOT delete local files.

```bash
puppyone disconnect --key <access-key>
```

---

## Sync Mode Commands

These commands use JWT authentication (from `puppyone login`) and the `/api/v1/sync/sources/*` endpoints. Used for **collecting** data from local folders into PuppyOne — a different use case from OpenClaw distribution.

### `puppyone login`

```bash
puppyone login [-e <email>] [-p <password>] [-u <api-url>]
```

Signs in via email/password. Saves JWT to `~/.puppyone/config.json`.

For CI/scripts, provide token directly: `puppyone login -k <token>`

### `puppyone logout`

```bash
puppyone logout
```

Clears saved credentials.

### `puppyone whoami`

```bash
puppyone whoami
```

Shows login status and checks server connectivity.

### `puppyone sync`

```bash
puppyone sync [-s <source-id>] [-d <direction>]
```

One-time sync for JWT-based connections. Direction: `push` | `pull` | `both` (default: `both`).

### `puppyone status`

```bash
puppyone status [-s <source-id>]
```

Shows status of all connections.

---

## Ignored Files

The CLI never syncs these:

```
.puppyone/          CLI working directory
.git/
node_modules/
__pycache__/
.DS_Store
.env
*.log
```

Supported file types: `.json`, `.md`, `.markdown`, `.txt`, `.yaml`, `.yml`

---

## Local Working Directory

The CLI creates a `.puppyone/` directory inside the workspace:

```
~/openclaw-workspace/
├── .puppyone/                  ← CLI internal (add to .gitignore)
│   ├── state.json              ← filename ↔ node_id mapping + versions
│   └── backups/                ← conflict backups
│       └── config.json.1708412345
├── agent.md                    ← synced
├── soul.md                     ← synced
├── product_info.json           ← synced
└── ...
```

`state.json` tracks which local files map to which cloud nodes:

```json
{
  "files": {
    "agent.md": { "node_id": "abc-123", "version": 4, "hash": "sha256..." },
    "product_info.json": { "node_id": "def-456", "version": 3, "hash": "sha256..." }
  },
  "connection": {
    "access_key": "cli_xxxxx",
    "api_url": "https://api.puppyone.com",
    "source_id": "...",
    "agent_id": "...",
    "project_id": "..."
  }
}
```

---

## Config File

Path: `~/.puppyone/config.json`

```json
{
  "api_url": "https://api.puppyone.dev",
  "api_key": "eyJhbGciOi...",
  "refresh_token": "...",
  "user_email": "user@example.com",
  "openclaw_connections": [
    {
      "access_key": "cli_xxxxx",
      "api_url": "https://api.puppyone.com",
      "folder": "/home/user/openclaw-workspace"
    }
  ],
  "connections": [
    {
      "source_id": 1,
      "folder": "/Users/me/my-workspace",
      "project_id": "abc-123",
      "sync_mode": "bidirectional"
    }
  ]
}
```

---

## Backend API Dependencies

### OpenClaw Mode Endpoints

| CLI Command | HTTP Method | Endpoint | Auth | Status |
|-------------|-------------|----------|------|--------|
| `connect --key` | POST | `/api/v1/access/openclaw/connect` | X-Access-Key | ✅ Done |
| `pull --key` | GET | `/api/v1/access/openclaw/pull` | X-Access-Key | ✅ Done |
| `watch --key` (push) | POST | `/api/v1/access/openclaw/push` | X-Access-Key | ✅ Done |
| `watch --key` (push new) | POST | `/api/v1/access/openclaw/push` | X-Access-Key | 🔧 Needs: create-node support |
| `watch --key` (pull) | GET | `/api/v1/access/openclaw/pull` | X-Access-Key | ✅ Done |
| `disconnect --key` | DELETE | `/api/v1/access/openclaw/disconnect` | X-Access-Key | ✅ Done |
| `connect --key` (status) | GET | `/api/v1/access/openclaw/status` | X-Access-Key | ✅ Done |

### Sync Mode Endpoints

| CLI Command | HTTP Method | Endpoint | Auth | Status |
|-------------|-------------|----------|------|--------|
| `login` | POST | `/api/v1/auth/login` | None | ✅ Done |
| `whoami` | GET | `/health` | Bearer | ✅ Done |
| `connect` | POST | `/api/v1/sync/sources` | Bearer | ✅ Done |
| `disconnect` | DELETE | `/api/v1/sync/sources/{id}` | Bearer | ✅ Done |
| `sync` (push) | POST | `/api/v1/sync/sources/{id}/push-file` | Bearer | ✅ Done |
| `sync` (pull) | GET | `/api/v1/sync/sources/{id}/pull-files` | Bearer | ✅ Done |
| `sync` (ack) | POST | `/api/v1/sync/sources/{id}/ack-pull` | Bearer | ✅ Done |
| `status` | GET | `/api/v1/sync/sources` | Bearer | ✅ Done |

### Backend Changes Needed for Full OpenClaw Merge

1. **`POST /access/openclaw/push`**: Support `node_id: null` to create new content nodes from local files
2. **`GET /access/openclaw/pull`**: Return ALL nodes (including those created via push), not just agent_bash pre-bound ones
3. **`DELETE /access/openclaw/push`** or flag: Support marking nodes as deleted when local file is removed

---

## Sync Mechanism Detail

### Core Principle

**Cloud is the source of truth.** When both sides change the same file, cloud wins.

### First Connect (Merge)

```
┌─────────────┐         ┌─────────────┐
│  PuppyOne   │         │   Local     │
│  Cloud      │         │   Folder    │
│             │         │             │
│  A.json v3  │───↓────▶│  A.json     │  Cloud → Local (new)
│  B.md   v1  │───↓────▶│  B.md       │  Cloud → Local (new)
│             │◀──↑─────│  agent.md   │  Local → Cloud (new node)
│             │◀──↑─────│  soul.md    │  Local → Cloud (new node)
│  C.json v2  │──=══════│  C.json     │  Same content, skip
│  D.md   v5  │───↓────▶│  D.md       │  Conflict: cloud wins, backup local
└─────────────┘         └─────────────┘

Result: Both sides identical.
```

### Watch (Continuous Sync)

```
Local file changed
  → read file, compute hash
  → compare with state.json hash
  → if different: POST /access/openclaw/push { node_id, content, base_version }
  → update state.json with new version

Cloud poll (every 30s)
  → GET /access/openclaw/pull
  → for each node: compare version with state.json
  → if cloud version > local version: overwrite file, update state.json
  → if cloud version == local version: skip
```

### Conflict Resolution

```
Local changes file X (base_version = 5)
Cloud also changed file X (now version = 6)

CLI tries to push:
  POST /push { node_id: X, content: ..., base_version: 5 }
  Backend returns: 409 Conflict (current version is 6)

CLI handles conflict:
  1. Backup local file → .puppyone/backups/X.1708412345
  2. Pull cloud version 6 → overwrite local file
  3. Update state.json with version 6
  4. Log: "⚠ X: conflict, cloud wins, local backed up"
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Authentication failed |
| 4 | Network error |
| 5 | Resource not found |

## Error Format

**Human mode:**
```
Error: <message>
Hint: <suggestion>
```

**JSON mode (`--json`):**
```json
{
  "success": false,
  "error": { "code": "ERROR_CODE", "message": "..." },
  "hint": "..."
}
```
