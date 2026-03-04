-- Standardize all table names to plural form (PostgreSQL convention)
-- This is a non-destructive rename: no data, columns, or indexes are changed.

ALTER TABLE IF EXISTS project RENAME TO projects;
ALTER TABLE IF EXISTS tool RENAME TO tools;
ALTER TABLE IF EXISTS connection_access RENAME TO connection_accesses;
ALTER TABLE IF EXISTS connection_tool RENAME TO connection_tools;
ALTER TABLE IF EXISTS agent_execution_log RENAME TO agent_execution_logs;
ALTER TABLE IF EXISTS etl_rule RENAME TO etl_rules;
ALTER TABLE IF EXISTS mcp RENAME TO mcps;
ALTER TABLE IF EXISTS mcp_binding RENAME TO mcp_bindings;
ALTER TABLE IF EXISTS context_publish RENAME TO context_publishes;
ALTER TABLE IF EXISTS oauth_connection RENAME TO oauth_connections;
