# Distribution Methods

You've connected data — now make it available to your agents. PuppyOne
supports four distribution methods.

## Methods at a glance

| Method | Protocol | Best for | Strength |
|--------|----------|----------|----------|
| **MCP endpoint** | MCP | Cursor, Claude Desktop, custom MCP clients | Standard protocol, works with any MCP client |
| **File sync** | OpenClaw | Claude Code, file-first agents | Two-way real-time sync with a local folder |
| **REST API** | HTTP | Custom agents, scripts, automations | Fully programmable, no SDK needed |
| **Code sandbox** | Mounted execution | Compute-heavy agents | Isolated Docker / E2B execution against your data |

## Which one should you pick

```
What kind of agent are you using?
|
+-- Cursor / Claude Desktop / Windsurf / other MCP clients
|     -> MCP endpoint  (the easiest path - 2 minutes)
|
+-- Claude Code (file-first)
|     -> File sync  (mount a local folder)
|
+-- Custom agent or automation script
|     -> Need to run code in a sandbox?
|        - Yes -> Code sandbox
|        - No  -> REST API
|
+-- Not sure
      -> Start with MCP - works for 80% of cases
```

## Quick reference

```bash
# Install the CLI
npm install -g puppyone
puppyone auth login

# Create an MCP endpoint (for Cursor / Claude Desktop / etc.)
puppyone access add mcp "My Data"

# Create a local folder sync (for Claude Code)
puppyone access add filesystem ~/project/context --name "Workspace"

# Create a sandbox (for code execution)
puppyone access add sandbox "Python Runner" --type e2b
```

## Two key concepts

### MCP (Model Context Protocol)

A standard protocol for AI models to access external tools and data. Each
MCP endpoint you create gets its own URL like:

```
https://api.puppyone.ai/api/v1/mcp/server/sk_live_xxx
```

Drop that into your client's MCP config and you're done.

### File sync (OpenClaw)

For Claude Code and other file-first agents. PuppyOne keeps a local folder
in real-time two-way sync with the cloud, so reading or writing local files
is effectively reading or writing your context space.

---

## 📚 Read more

- [Distribution overview](https://puppyone.ai/doc/en/distribute)
- [Connect Cursor](https://puppyone.ai/doc/en/distribute/cursor)
- [Connect Claude Desktop](https://puppyone.ai/doc/en/distribute/claude-desktop)
- [Connect Claude Code](https://puppyone.ai/doc/en/distribute/claude-code)
- [Custom MCP clients](https://puppyone.ai/doc/en/distribute/custom-mcp)
- [REST API reference](https://puppyone.ai/doc/en/distribute/rest-api)
- [Code sandbox](https://puppyone.ai/doc/en/distribute/sandbox)
