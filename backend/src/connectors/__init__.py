"""
Connectors Module — All connection types for PuppyOne.

Seven peer-level areas, all backed by the unified `access_points` table:

  connectors/
  ├── manager/            Unified connection CRUD (single entry-point)
  ├── datasource/         SaaS data sources (Gmail, Notion, GitHub, ...)
  │   └── oauth/          OAuth authorization flows & token storage
  ├── filesystem/         Bidirectional local folder sync via Git Remote / AP-FS
  ├── database/           External database connectors
  ├── agent/              AI agents (config, chat, MCP tool binding)
  ├── mcp_endpoint/       MCP protocol endpoint CRUD & API key
  └── sandbox_endpoint/   Sandbox endpoint CRUD & command execution

Sandbox runtime engine (E2B / Docker) lives in src/infra/sandbox/.
MCP Server management (health checks, cache) lives in src/infra/mcp_server/.
Workspace materialization (lower cache) lives in src/platform/workspace/.
"""
