-- Migration: Add search_index_task table for async search indexing status
-- Date: 2026-01-12
-- Description: Persist async Search Tool indexing status and stats

\i ../search_index_task.sql

comment on table public.search_index_task is 'Async indexing task status for Search Tools';
comment on column public.search_index_task.tool_id is 'FK to public.tool.id (search tool)';
comment on column public.search_index_task.status is 'pending/indexing/ready/error';
comment on column public.search_index_task.last_error is 'Truncated last error for indexing failures';

