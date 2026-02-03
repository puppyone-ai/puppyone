-- Migration: Remove query_data tools from public.tool table
-- Description: We simplified the tool system - "Search" (TurboPuffer-based) is the only search tool.
--              query_data (JMESPath) is no longer exposed in the UI and should be removed.
-- Date: 2026-02-02

-- ARCHITECTURE NOTE:
-- Previously we had two "search-like" tools:
--   1. query_data - JMESPath-based structured query (only works on JSON)
--   2. search - TurboPuffer-based semantic search (works on JSON, markdown, folders)
--
-- Decision: Keep only "search" as the universal search tool.
-- query_data was too confusing for users and only worked on JSON data.

DO $$
DECLARE
    deleted_count INT;
BEGIN
    RAISE NOTICE 'Starting migration to remove query_data tools from public.tool...';

    -- Delete rows where type is 'query_data'
    DELETE FROM public.tool
    WHERE type = 'query_data';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Successfully deleted % rows with type ''query_data'' from public.tool.', deleted_count;

    -- Also clean up any preview/select tools if they exist (these are advanced JSON-only tools)
    -- that we're not exposing in the simplified UI
    DELETE FROM public.tool
    WHERE type IN ('preview', 'select', 'get_data_schema');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Also deleted % rows with types preview/select/get_data_schema.', deleted_count;

    RAISE NOTICE 'Migration completed.';
END;
$$;

-- Verification query (run this to check remaining tools)
-- SELECT id, name, type, created_at FROM public.tool ORDER BY created_at DESC;


