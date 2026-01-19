-- Migration: tool.id 从 bigint 改为 text
-- 支持 UUID 格式

-- ============================================================
-- 1. 删除外键约束
-- ============================================================

-- mcp_binding -> tool
ALTER TABLE public.mcp_binding DROP CONSTRAINT IF EXISTS mcp_binding_tool_id_fkey;

-- search_index_task -> tool
ALTER TABLE public.search_index_task DROP CONSTRAINT IF EXISTS search_index_task_tool_id_fkey;

-- ============================================================
-- 2. 修改 tool.id 为 text
-- ============================================================
ALTER TABLE public.tool ALTER COLUMN id DROP IDENTITY IF EXISTS;
ALTER TABLE public.tool ALTER COLUMN id TYPE text USING id::text;

-- ============================================================
-- 3. 修改所有引用列为 text
-- ============================================================

-- mcp_binding.tool_id
ALTER TABLE public.mcp_binding ALTER COLUMN tool_id TYPE text USING tool_id::text;

-- search_index_task.tool_id
ALTER TABLE public.search_index_task ALTER COLUMN tool_id TYPE text USING tool_id::text;

-- ============================================================
-- 4. 重新添加外键约束
-- ============================================================

ALTER TABLE public.mcp_binding
    ADD CONSTRAINT mcp_binding_tool_id_fkey
    FOREIGN KEY (tool_id) REFERENCES public.tool (id) ON DELETE CASCADE;

ALTER TABLE public.search_index_task
    ADD CONSTRAINT search_index_task_tool_id_fkey
    FOREIGN KEY (tool_id) REFERENCES public.tool (id) ON DELETE CASCADE;

