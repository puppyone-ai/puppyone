# Access Points

An **Access Point** is PuppyOne's unified abstraction for every external
integration. Whether you're syncing data from Notion, exposing an MCP
endpoint to Cursor, or mounting a local folder, they all live in the same
table — managed through the same UI and CLI.

## The five types

| Type | Purpose | Direction |
|------|---------|-----------|
| **Sync source** | Pull data from external SaaS into your file tree | Pull |
| **Agent** | An AI agent with model, prompt, and tool bindings | — |
| **MCP endpoint** | Expose your file tree to MCP-compatible clients | Bidirectional |
| **Sandbox** | Isolated Docker / E2B environment for code execution | — |
| **Filesystem** | Real-time bidirectional sync with a local folder | Bidirectional |

## Why one abstraction

Every access point shares the same lifecycle (`active` / `paused` / `error`),
the same audit trail, and the same permission model. So you don't learn five
different mental models — you learn one.

## In the CLI

```bash
puppyone access add notion <url>           # Sync source
puppyone access add agent "Support Bot"    # Agent
puppyone access add mcp "Cursor MCP"       # MCP endpoint
puppyone access add sandbox "Python"       # Sandbox
puppyone access add filesystem ~/notes     # Filesystem

puppyone access ls                         # List everything
puppyone access info <id>                  # Inspect one
puppyone access pause <id>                 # Suspend without deleting
```

## Anatomy of an access point

Every access point has:

- **`id`** — stable identifier
- **`name`** — human label
- **`provider`** — `notion` / `github` / `mcp` / `agent` / etc.
- **`access_key`** — credential used by clients (for MCP and agents)
- **`config`** — provider-specific JSON
- **`status`** — `active` / `paused` / `error`

---

## 📚 Read more

- [Connections (Access Points) reference](https://puppyone.ai/doc/en/concepts/connections)
- [CLI access commands](https://puppyone.ai/doc/en/cli/access)
