-- Migration: Remove shell_access entries from tool table
-- Date: 2026-02-02
-- Description: 
--   Shell/bash access permissions are managed in agent_bash table, not tool table.
--   This migration removes incorrectly stored shell_access entries from public.tool.
--
-- Architecture:
--   - agent_bash: Stores per-agent, per-node bash/terminal access permissions
--   - public.tool: Stores reusable tools (search, query_data, custom_script, etc.)
--   - agent_tool: Links agents to tools (many-to-many)

-- 1. Log count before deletion (for audit)
DO $$
DECLARE
    shell_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO shell_count 
    FROM public.tool 
    WHERE type IN ('shell_access', 'shell_access_readonly');
    
    RAISE NOTICE 'Found % shell_access entries to remove from tool table', shell_count;
END $$;

-- 2. Delete shell_access entries from tool table
-- These should have been in agent_bash table, not tool table
DELETE FROM public.tool 
WHERE type IN ('shell_access', 'shell_access_readonly');

-- 3. Add comment for documentation
COMMENT ON TABLE public.tool IS 
'Tool library for reusable tools (search, query_data, custom_script, etc.). 
NOTE: Shell/bash access is stored in agent_bash table, NOT here.
See: agents → agent_bash (access permissions) + agent_tool (tool bindings)';

-- 4. Verify deletion
DO $$
DECLARE
    remaining_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO remaining_count 
    FROM public.tool 
    WHERE type IN ('shell_access', 'shell_access_readonly');
    
    IF remaining_count > 0 THEN
        RAISE WARNING 'Still have % shell_access entries after migration!', remaining_count;
    ELSE
        RAISE NOTICE 'Successfully removed all shell_access entries from tool table';
    END IF;
END $$;




