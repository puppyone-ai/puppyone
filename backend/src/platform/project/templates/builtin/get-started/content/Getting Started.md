# Welcome to PuppyOne

Your context space is ready. This is your **Get Started** project — a guided
walkthrough that's also a real, editable project. Edit, delete, or rename
anything as you go.

## What is PuppyOne in one sentence

A cloud file system built for AI agents — connect data from anywhere, expose
it to any agent through one unified interface, and stay in control with
version history and per-agent permissions.

## Try these three things

### 1. Connect a real data source

Bring in your own data from Notion, GitHub, Gmail, Google Drive, or a local
folder.

- **Web:** click `+ New Access` in the sidebar
- **CLI:** `puppyone access add notion <page-url>`

### 2. Create an MCP endpoint

Let Cursor, Claude Desktop, or any MCP-compatible agent read and write your
data.

- **Web:** Access → Add → MCP Endpoint
- **CLI:** `puppyone access add mcp "my-endpoint"`

You'll get an MCP Server URL like
`https://api.puppyone.ai/api/v1/mcp/server/sk_live_xxx`. Drop that into
Cursor or Claude Desktop and your agent has full access to your context.

### 3. Open this project in your IDE

Sync this whole project to a local folder so Claude Code, Cursor, or any
file-first agent can edit it directly.

- **Web:** Access → Add → Filesystem
- **CLI:** `puppyone access add filesystem ~/puppyone-workspace`

---

## Tour the rest of this project

| Folder | What's inside |
|--------|---------------|
| `Concepts/` | The mental model — how PuppyOne organizes data |
| `Connect Data/` | All 14+ data sources you can mount |
| `Distribute to Agents/` | MCP, file sync, REST, and sandbox options |
| `Govern Your Context/` | Version history, audit logs, agent permissions |

When you're done exploring, **delete this project and create your real one**
— or keep it as a sandbox.

---

## 📚 Full documentation

The complete reference lives at
[puppyone.ai/doc](https://puppyone.ai/doc/en).
