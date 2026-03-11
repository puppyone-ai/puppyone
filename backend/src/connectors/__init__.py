"""
Connectors Module — All connection types for PuppyOne.

Five peer-level connection types, all stored in the `connections` table:

  connectors/
  ├── manager/       Unified connection CRUD
  ├── datasource/    SaaS data sources (Gmail, Notion, GitHub, ...)
  ├── filesystem/    Bidirectional local folder sync (OpenClaw)
  ├── mcp/           MCP protocol endpoints
  ├── sandbox/       Code sandbox endpoints
  └── agent/         AI agents (config, chat, MCP tools)
"""
