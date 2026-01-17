-- Enforce tool/batch constraints for project-scoped ChatSidebar.
--
-- Background:
-- - We store both Tools and Bash/Batch access points in `public.tool`.
-- - Bash is represented by tool.type in ('shell_access', 'shell_access_readonly').
-- - Requirement: per scope (user_id + table_id + json_path) only ONE bash may exist (rw/ro mutually exclusive).
--
-- Notes:
-- - We normalize json_path with COALESCE(json_path, '') because current schema allows NULL.
-- - If existing duplicate rows violate these UNIQUE indexes, this migration will fail.
--   In that case, clean up duplicates first (keep the newest row per scope) then re-run.

-- Helpful non-unique indexes for query performance
create index if not exists idx_tool_user_table_id
  on public.tool (user_id, table_id);

create index if not exists idx_tool_table_id
  on public.tool (table_id);

-- Optional: prevent duplicates for the same tool type within a scope.
-- This matches the frontend permission model (one boolean per type).
create unique index if not exists uq_tool_scope_type
  on public.tool (user_id, table_id, coalesce(json_path, ''), type)
  where user_id is not null and table_id is not null and type is not null;

-- Core requirement: only one bash per scope (rw/ro are mutually exclusive).
create unique index if not exists uq_tool_scope_single_bash
  on public.tool (user_id, table_id, coalesce(json_path, ''))
  where user_id is not null
    and table_id is not null
    and type in ('shell_access', 'shell_access_readonly');


