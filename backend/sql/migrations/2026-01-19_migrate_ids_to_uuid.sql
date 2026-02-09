-- Migration: project.id 和 context_table.id 从 bigint 改为 text
-- 支持旧的数字ID和新的UUID共存

-- ============================================================
-- 0. 删除 RLS Policies
-- ============================================================

-- project policies
DROP POLICY IF EXISTS "project_service_role" ON public.project;
DROP POLICY IF EXISTS "project_delete" ON public.project;
DROP POLICY IF EXISTS "project_update" ON public.project;
DROP POLICY IF EXISTS "project_insert" ON public.project;
DROP POLICY IF EXISTS "project_select" ON public.project;

-- context_table policies
DROP POLICY IF EXISTS "context_table_service_role" ON public.context_table;
DROP POLICY IF EXISTS "context_table_delete" ON public.context_table;
DROP POLICY IF EXISTS "context_table_update" ON public.context_table;
DROP POLICY IF EXISTS "context_table_insert" ON public.context_table;
DROP POLICY IF EXISTS "context_table_select" ON public.context_table;

-- old_mcp_instance policies
DROP POLICY IF EXISTS "mcp_instance_service_role" ON public.old_mcp_instance;
DROP POLICY IF EXISTS "mcp_instance_delete" ON public.old_mcp_instance;
DROP POLICY IF EXISTS "mcp_instance_update" ON public.old_mcp_instance;
DROP POLICY IF EXISTS "mcp_instance_insert" ON public.old_mcp_instance;
DROP POLICY IF EXISTS "mcp_instance_select" ON public.old_mcp_instance;

-- ============================================================
-- 1. 删除外键约束
-- ============================================================

-- context_table -> project
ALTER TABLE public.context_table DROP CONSTRAINT IF EXISTS context_table_project_id_fkey;

-- chunks -> context_table
ALTER TABLE public.chunks DROP CONSTRAINT IF EXISTS chunks_table_id_fkey;

-- old_mcp_instance -> project, context_table
ALTER TABLE public.old_mcp_instance DROP CONSTRAINT IF EXISTS mcp_instance_project_id_fkey;
ALTER TABLE public.old_mcp_instance DROP CONSTRAINT IF EXISTS mcp_instance_table_id_fkey;

-- ============================================================
-- 2. 修改 project.id 为 text
-- ============================================================
ALTER TABLE public.project ALTER COLUMN id DROP IDENTITY IF EXISTS; 
ALTER TABLE public.project ALTER COLUMN id TYPE text USING id::text;

-- ============================================================
-- 3. 修改 context_table.id 为 text
-- ============================================================
ALTER TABLE public.context_table ALTER COLUMN id DROP IDENTITY IF EXISTS;
ALTER TABLE public.context_table ALTER COLUMN id TYPE text USING id::text;

-- ============================================================
-- 4. 修改所有引用列为 text
-- ============================================================

-- context_table.project_id
ALTER TABLE public.context_table ALTER COLUMN project_id TYPE text USING project_id::text;

-- chunks.table_id
ALTER TABLE public.chunks ALTER COLUMN table_id TYPE text USING table_id::text;

-- old_mcp_instance
ALTER TABLE public.old_mcp_instance ALTER COLUMN project_id TYPE text USING project_id::text;
ALTER TABLE public.old_mcp_instance ALTER COLUMN table_id TYPE text USING table_id::text;

-- etl_task.project_id (无FK)
ALTER TABLE public.etl_task ALTER COLUMN project_id TYPE text USING project_id::text;

-- context_publish.table_id (无FK)
ALTER TABLE public.context_publish ALTER COLUMN table_id TYPE text USING table_id::text;

-- tool.table_id (无FK)
ALTER TABLE public.tool ALTER COLUMN table_id TYPE text USING table_id::text;

-- search_index_task (无FK)
ALTER TABLE public.search_index_task ALTER COLUMN project_id TYPE text USING project_id::text;
ALTER TABLE public.search_index_task ALTER COLUMN table_id TYPE text USING table_id::text;

-- ============================================================
-- 5. 重新添加外键约束
-- ============================================================

ALTER TABLE public.context_table
    ADD CONSTRAINT context_table_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.project (id);

ALTER TABLE public.chunks
    ADD CONSTRAINT chunks_table_id_fkey
    FOREIGN KEY (table_id) REFERENCES public.context_table (id) ON DELETE CASCADE;

ALTER TABLE public.old_mcp_instance
    ADD CONSTRAINT mcp_instance_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.project (id);

ALTER TABLE public.old_mcp_instance
    ADD CONSTRAINT mcp_instance_table_id_fkey
    FOREIGN KEY (table_id) REFERENCES public.context_table (id);

-- ============================================================
-- 6. 重新创建 RLS Policies
-- ============================================================

-- project policies
CREATE POLICY "project_service_role" ON public.project
    FOR ALL TO public
    USING (auth.role() = 'service_role'::text);

CREATE POLICY "project_delete" ON public.project
    FOR DELETE TO public
    USING (user_id = auth.uid());

CREATE POLICY "project_update" ON public.project
    FOR UPDATE TO public
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "project_insert" ON public.project
    FOR INSERT TO public
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "project_select" ON public.project
    FOR SELECT TO public
    USING (user_id = auth.uid());

-- context_table policies
CREATE POLICY "context_table_service_role" ON public.context_table
    FOR ALL TO public
    USING (auth.role() = 'service_role'::text);

CREATE POLICY "context_table_delete" ON public.context_table
    FOR DELETE TO public
    USING (EXISTS (
        SELECT 1 FROM project
        WHERE project.id = context_table.project_id
        AND project.user_id = auth.uid()
    ));

CREATE POLICY "context_table_update" ON public.context_table
    FOR UPDATE TO public
    USING (EXISTS (
        SELECT 1 FROM project
        WHERE project.id = context_table.project_id
        AND project.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM project
        WHERE project.id = context_table.project_id
        AND project.user_id = auth.uid()
    ));

CREATE POLICY "context_table_insert" ON public.context_table
    FOR INSERT TO public
    WITH CHECK (EXISTS (
        SELECT 1 FROM project
        WHERE project.id = context_table.project_id
        AND project.user_id = auth.uid()
    ));

CREATE POLICY "context_table_select" ON public.context_table
    FOR SELECT TO public
    USING (EXISTS (
        SELECT 1 FROM project
        WHERE project.id = context_table.project_id
        AND project.user_id = auth.uid()
    ));

-- old_mcp_instance policies
CREATE POLICY "mcp_instance_service_role" ON public.old_mcp_instance
    FOR ALL TO public
    USING (auth.role() = 'service_role'::text);

CREATE POLICY "mcp_instance_delete" ON public.old_mcp_instance
    FOR DELETE TO public
    USING (user_id = auth.uid());

CREATE POLICY "mcp_instance_update" ON public.old_mcp_instance
    FOR UPDATE TO public
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "mcp_instance_insert" ON public.old_mcp_instance
    FOR INSERT TO public
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "mcp_instance_select" ON public.old_mcp_instance
    FOR SELECT TO public
    USING (user_id = auth.uid());
