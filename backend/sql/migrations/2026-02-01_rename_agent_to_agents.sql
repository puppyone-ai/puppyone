-- Migration: Rename agent table to agents (plural form)
-- Description: Standardize table naming to use plural form for consistency
-- Date: 2026-02-01

-- 1. Rename main table
ALTER TABLE agent RENAME TO agents;

-- 2. Update indexes (they will be renamed automatically with table, but let's be explicit)
-- PostgreSQL automatically renames indexes when table is renamed

-- 3. Update any foreign key constraints that reference the old table name
-- (The constraints themselves don't need updating, just the table name changes)

-- 4. Update RLS policies if they reference table name in policy definitions
-- Check existing policies
-- SELECT * FROM pg_policies WHERE tablename = 'agent';

-- 5. Add comment for documentation
COMMENT ON TABLE agents IS 'Agent configurations for users. Renamed from agent to agents for consistency.';

-- Note: After running this migration, update all backend code to use "agents" instead of "agent"



