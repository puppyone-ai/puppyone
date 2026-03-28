"""
MCP Server Management — health checks, cache invalidation, and legacy `mcps` table CRUD.

Manages the external MCP Server process (deployed as a separate Railway service).
The standalone MCP Server itself lives in `mcp_service/`.

Migrated from src/mcp/.
"""
