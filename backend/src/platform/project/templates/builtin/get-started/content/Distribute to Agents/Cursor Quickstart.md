# Cursor Quickstart

Get Cursor talking to your context space in under 5 minutes.

## Step 1: Create an MCP endpoint

In the dashboard or via the CLI:

```bash
puppyone access add mcp "My Cursor MCP"
```

You'll get something like:

```
✓ MCP endpoint created
  ID:         conn_abc123
  API Key:    sk_live_xxxxxxxxxxxx
  Server URL: https://api.puppyone.ai/api/v1/mcp/server/sk_live_xxxxxxxxxxxx
```

Copy the Server URL.

## Step 2: Add it to Cursor

In your Cursor project root, create or edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "puppyone": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://api.puppyone.ai/api/v1/mcp/server/sk_live_xxxxxxxxxxxx"
      ]
    }
  }
}
```

Replace the URL with your real Server URL.

## Step 3: Restart Cursor

Quit and reopen Cursor. The MCP server should appear in your settings as
connected.

## Step 4: Try it

In Cursor's chat, ask something like:

> "Look up our latest product spec from PuppyOne and summarize it."

If everything works, Cursor will call PuppyOne, fetch the data, and respond.

## Troubleshooting

- **Cursor doesn't see the MCP server.** Check that `npx` is on your PATH and
  that the URL in `.cursor/mcp.json` matches exactly.
- **"Unauthorized" error.** The API key in the URL is wrong or has been
  revoked. Recreate the endpoint.
- **No tools shown.** Make sure your MCP endpoint has tools bound to it
  (in the dashboard: Access → your endpoint → Tools).

---

## 📚 Read more

- [Cursor integration guide](https://puppyone.ai/doc/en/distribute/cursor)
- [Claude Desktop integration](https://puppyone.ai/doc/en/distribute/claude-desktop)
- [Claude Code integration](https://puppyone.ai/doc/en/distribute/claude-code)
- [Cloud quickstart](https://puppyone.ai/doc/en/quickstart/cloud)
