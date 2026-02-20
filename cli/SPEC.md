# PuppyOne CLI — Interface Specification

> Version: 0.3.0 | 2026-02-19

## Design Principles

- **Deployment agnostic**: Works the same whether PuppyOne is cloud-hosted, self-hosted, or local
- **User controls data**: `connect` only creates a binding; `sync` / `watch` transfer data — CLI never reads files without explicit action
- **Separation of concerns**: Binding, syncing, and watching are three independent actions

## Install

```bash
npm install -g puppyone
```

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--api-url <url>` | `-u` | PuppyOne API URL (overrides config) |
| `--api-key <key>` | `-k` | API Key (overrides config) |
| `--json` | | JSON output for AI / scripts |
| `--verbose` | `-v` | Verbose output |
| `--version` | `-V` | Print version |
| `--help` | `-h` | Print help |

---

## Commands

### `puppyone login`

Sign in to PuppyOne with email and password.

```
puppyone login [-e <email>] [-p <password>] [-u <api-url>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `-e, --email` | No* | Interactive prompt | Email address |
| `-p, --password` | No* | Interactive prompt | Password |
| `-u, --api-url` | No | `http://localhost:9090` | API URL |
| `-k, --api-key` | No | | Provide token directly (skip login, for CI/scripts) |

\* Prompts interactively if not provided.

**What happens behind the scenes:**
1. `POST /api/v1/auth/login { email, password }` → backend calls Supabase Auth → returns access_token
2. Saves `access_token`, `refresh_token`, `user_email`, `api_url` to `~/.puppyone/config.json`

---

### `puppyone logout`

Clear saved credentials from `~/.puppyone/config.json`.

```
puppyone logout
```

**What happens behind the scenes:**
1. Resets `api_key` to null in config

---

### `puppyone whoami`

Show current login status and check server connectivity.

```
puppyone whoami
```

**What happens behind the scenes:**
1. Reads `~/.puppyone/config.json`
2. `GET /health` to check if server is reachable

---

### `puppyone connect`

Bind a local folder to a PuppyOne project. **Only creates the link — does NOT read or upload any files.**

```
puppyone connect <folder> -p <project-id> [flags]
```

| Arg/Flag | Required | Default | Description |
|----------|----------|---------|-------------|
| `<folder>` | Yes | | Local folder path |
| `-p, --project` | Yes | | Project ID |
| `-f, --folder-id` | No | Project root | Target folder node ID inside the project |
| `-m, --mode` | No | `bidirectional` | `bidirectional` \| `pull` \| `push` |
| `-c, --conflict` | No | `merge` | `merge` \| `external` \| `puppyone` \| `manual` |
| `-n, --name` | No | Folder name | Connection name |

Use `--folder-id` to bind to a specific folder inside the project tree. Omit to bind to the project root.

**What happens behind the scenes:**
1. Validates local folder path exists and is a directory
2. `POST /api/v1/sync/sources` creates a source record on server with `config: { path, target_folder_id }`
3. Appends connection info to `~/.puppyone/config.json` `connections[]`

**What it does NOT do:** No folder scanning, no file reading, no data upload

---

### `puppyone sync`

Manually trigger a one-time sync. CLI reads local files and pushes to the cloud, or downloads cloud content and writes locally.

```
puppyone sync [-s <source-id>] [-d <direction>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `-s, --source` | No | All connections | Specify source ID |
| `-d, --direction` | No | `both` | `pull` \| `push` \| `both` |

**Direction:**
- **push**: Local → Cloud (CLI reads local files → uploads to PuppyOne nodes)
- **pull**: Cloud → Local (CLI downloads from PuppyOne → writes to local files)

**Supported file types:** `.json`, `.md`, `.markdown`, `.txt`, `.yaml`, `.yml`

**What happens behind the scenes (push):**
1. Reads connection info from `~/.puppyone/config.json` to get source_id and folder path
2. CLI scans local folder recursively (ignoring dotfiles, `node_modules`, `__pycache__`, `.git`)
3. For each supported file:
   - Computes local file SHA-256
   - `POST /api/v1/sync/sources/{id}/push-file` with content + hash
   - Backend handles create-or-update and sync point tracking
   - Response: `{ action: "created" | "updated" | "skipped", node_id, version }`

**What happens behind the scenes (pull):**
1. `GET /api/v1/sync/sources/{id}/pull-files` — returns files whose server version > last sync version
2. CLI writes each file to the local folder (creates directories as needed)
3. `POST /api/v1/sync/sources/{id}/ack-pull` — acknowledges written files with version + hash

**What happens behind the scenes (both):**
1. Push first, then pull

**Example output:**
```
Syncing source #1: /Users/me/workspace
  PUSH: 5 local files found
    created: config.json → node abc123 v1
    updated: README.md → node def456 v3
  PULL: 1 files to download
    pulled: notes.md v2

Done: 2 pushed, 1 pulled, 3 skipped, 0 errors
```

---

### `puppyone watch`

Start a local file watcher that continuously monitors for changes and syncs automatically. Runs in foreground, Ctrl+C to stop.

```
puppyone watch [-s <source-id>] [-i <interval>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `-s, --source` | No | All connections | Specify source ID |
| `-i, --interval` | No | `30` | Remote change check interval (seconds, min 5) |

**What happens behind the scenes:**
1. Reads connection info, starts chokidar watcher on local folder(s)
2. **Local file change** (chokidar event, debounced 500ms):
   - Reads changed file, computes SHA-256
   - `POST /api/v1/sync/sources/{id}/push-file` with content + hash
   - Backend skips if hash matches (no change)
3. **Periodic remote change check** (every `interval` seconds):
   - `GET /api/v1/sync/sources/{id}/pull-files` to get changed files
   - Writes changed files to local folder
   - `POST /api/v1/sync/sources/{id}/ack-pull` to acknowledge
4. Ctrl+C stops all watchers and exits gracefully

**Example output:**
```
Watching source #1: /Users/me/workspace

Watching for changes (remote poll every 30s). Press Ctrl+C to stop.

  ↑ updated: config.json → v4
  ↓ pulled: notes.md v5
  ↑ created: new-file.md → v1
```

---

### `puppyone disconnect`

Remove a connection binding. Deletes server-side source record + removes local config entry. Does NOT delete any files.

```
puppyone disconnect [source-id] [-f]
```

| Arg/Flag | Required | Description |
|----------|----------|-------------|
| `[source-id]` | No | If omitted, lists all connections for selection |
| `-f, --force` | No | Skip confirmation |

**What happens behind the scenes:**
1. `DELETE /api/v1/sync/sources/{id}` deletes server-side source and unbinds all nodes
2. Removes connection from `~/.puppyone/config.json` `connections[]`

---

### `puppyone status`

Show status of all connected bindings.

```
puppyone status [-s <source-id>]
```

**What happens behind the scenes:**
1. Reads `~/.puppyone/config.json` `connections[]`
2. For each connection, `GET /api/v1/sync/sources/{id}` to get server-side status
3. Displays summary

---

### Advanced: Resource Management

For AI agents and power users.

#### `puppyone source`

```
puppyone source list [-p <project-id>]     # GET /api/v1/sync/sources?project_id=
puppyone source get <source-id>            # GET /api/v1/sync/sources/{id}  (TODO)
puppyone source pause <source-id>          # POST /api/v1/sync/sources/{id}/pause
puppyone source resume <source-id>         # POST /api/v1/sync/sources/{id}/resume
puppyone source delete <source-id> [-f]    # DELETE /api/v1/sync/sources/{id}
```

#### `puppyone project`

```
puppyone project list                      # GET /api/v1/projects
puppyone project get <project-id>          # GET /api/v1/projects/{id}
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
  "default_project": "abc-123",
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

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Authentication failed |
| 4 | Network error (API unreachable) |
| 5 | Resource not found |

---

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

| Code | Meaning |
|------|---------|
| `NOT_AUTHENTICATED` | Not logged in |
| `FOLDER_NOT_FOUND` | Folder does not exist |
| `PROJECT_NOT_FOUND` | Project does not exist |
| `SOURCE_NOT_FOUND` | Source does not exist |
| `ALREADY_CONNECTED` | Folder is already connected (not an error, returns existing connection) |
| `API_UNREACHABLE` | Cannot reach API server |
| `SYNC_FAILED` | Sync operation failed |
| `PERMISSION_DENIED` | Insufficient permissions |

---

## Backend API Dependencies

All backend endpoints the CLI calls:

| CLI Command | HTTP Method | Endpoint | Status |
|-------------|-------------|----------|--------|
| `login` | POST | `/api/v1/auth/login` | ✅ Done |
| `whoami` | GET | `/health` | ✅ Done |
| `connect` | POST | `/api/v1/sync/sources` | ✅ Done |
| `disconnect` | DELETE | `/api/v1/sync/sources/{id}` | ✅ Done |
| `sync` (push) | POST | `/api/v1/sync/sources/{id}/push-file` | ✅ Done |
| `sync` (pull) | GET | `/api/v1/sync/sources/{id}/pull-files` | ✅ Done |
| `sync` (ack) | POST | `/api/v1/sync/sources/{id}/ack-pull` | ✅ Done |
| `watch` | POST | `/api/v1/sync/sources/{id}/push-file` | ✅ Done (same as sync) |
| `watch` | GET | `/api/v1/sync/sources/{id}/pull-files` | ✅ Done (same as sync) |
| `status` | GET | `/api/v1/sync/sources` | ✅ Done |
| `source list` | GET | `/api/v1/sync/sources` | ✅ Done |
| `source pause` | POST | `/api/v1/sync/sources/{id}/pause` | ✅ Done |
| `source resume` | POST | `/api/v1/sync/sources/{id}/resume` | ✅ Done |
| `project list` | GET | `/api/v1/projects` | ✅ Done |
| `project get` | GET | `/api/v1/projects/{id}` | ✅ Done |
