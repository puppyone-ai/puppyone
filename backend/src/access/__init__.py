"""
Backward-compatibility shim — code has been migrated to:

- agent/config/    Agent config CRUD
- agent/chat/      Agent chat (SSE streaming) + orchestration
- agent/mcp/       MCP protocol runtime (tool binding & proxy)
- sync/connectors/filesystem/  Filesystem CLI sync (Desktop Folder)

This directory only keeps re-exports for backward-compatible import paths.
"""
