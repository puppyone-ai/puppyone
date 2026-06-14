# PuppyOne MCP Service

Shared MCP protocol host for PuppyOne access endpoints.

## Final Architecture

```text
MCP Client
  -> Main Backend /api/v1/mcp/proxy
     -> authenticates X-MCP-API-Key or legacy path key
     -> proxies to internal mcp_service /mcp
        -> handles MCP protocol, sessions, streaming, tool validation
        -> calls Main Backend /internal/mcp-runtime/*
           -> resolves endpoint scope and permissions
           -> executes scoped_fs tools through Version Engine
```

`mcp_service` is a separate service by design. Do not embed the MCP protocol
server directly into the main FastAPI backend. The main backend owns public
auth, endpoint records, scopes, policy, and Version Engine execution. This
service owns MCP transport/protocol concerns only.

## Responsibilities

- Host the MCP Streamable HTTP endpoint at `/mcp`.
- Extract the runtime key from `X-API-KEY` after the main backend proxy.
- Load dynamic runtime config from the main backend internal API.
- List MCP tools from `/internal/mcp-runtime/tools` for standalone MCP endpoints.
- Execute MCP tools through `/internal/mcp-runtime/call`.
- Maintain MCP session state, event replay, cache invalidation, and health.

## Public Entry Point

External clients should connect to the main backend, not directly to this
service:

```json
{
  "mcpServers": {
    "puppyone": {
      "url": "https://api.example.com/api/v1/mcp/proxy",
      "headers": {
        "X-MCP-API-Key": "mcp_..."
      }
    }
  }
}
```

Legacy keyed-path URLs remain route-compatible during migration, but the
header form above is the canonical product surface.

## Service Configuration

Main backend:

```bash
MCP_SERVER_URL=http://mcp-service:3090
INTERNAL_API_SECRET=...
```

MCP service:

```bash
MAIN_SERVICE_URL=http://main-backend:9090
INTERNAL_API_SECRET=...
PORT=3090
```

`INTERNAL_API_SECRET` must match on both services.

## Start

```bash
uv run uvicorn mcp_service.server:app --host 0.0.0.0 --port 3090 --log-level info
```

For local compatibility:

```bash
python -m mcp_service
```

## Internal Endpoints

- `POST /mcp` - MCP protocol endpoint.
- `GET /healthz` - service health.
- `POST /cache/invalidate` - invalidate cached runtime config for an API key.

## Current Standalone MCP Tools

Standalone MCP endpoints expose scoped filesystem tools from
`src.version_engine.scoped_fs`:

- `fs_semantics`
- `fs_ls`
- `fs_tree`
- `fs_find`
- `fs_grep`
- `fs_cat`
- `fs_head`
- `fs_tail`
- `fs_stat`
- `fs_write`
- `fs_mkdir`
- `fs_touch`
- `fs_cp`
- `fs_mv`
- `fs_rmdir`
- `fs_rm`

Read-only endpoint scopes only list read tools. Writable endpoint scopes list
write/delete tools as well. Tool definitions include `title`, `description`,
`inputSchema`, `outputSchema`, and MCP `annotations`.

## Test Examples

Health:

```bash
curl http://localhost:3090/healthz
```

Tools list through the public proxy:

```bash
curl -X POST http://localhost:9090/api/v1/mcp/proxy \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: mcp_..." \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Tool call through the public proxy:

```bash
curl -X POST http://localhost:9090/api/v1/mcp/proxy \
  -H "Content-Type: application/json" \
  -H "X-MCP-API-Key: mcp_..." \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fs_ls",
      "arguments": { "path": "" }
    },
    "id": 2
  }'
```

## Adding MCP Filesystem Capabilities

Add filesystem tools in this order:

1. Define the tool contract in `src.version_engine.scoped_fs.registry`.
2. Implement behavior in `src.version_engine.scoped_fs.service`.
3. Keep MCP service as a thin protocol adapter.
4. Add registry, internal runtime, and MCP server routing tests.
