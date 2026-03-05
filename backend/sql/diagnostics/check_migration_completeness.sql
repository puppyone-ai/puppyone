-- ============================================================
-- Migration Completeness Check
-- ============================================================
-- Checks that ALL expected tables, columns, indexes, and
-- functions exist in the database. Run in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1. 检查必需的表是否存在
-- ============================================================
WITH expected_tables(tbl) AS (VALUES
    ('projects'),
    ('content_nodes'),
    ('organizations'),
    ('org_members'),
    ('org_invitations'),
    ('project_members'),
    ('profiles'),
    ('tools'),
    ('connections'),
    ('connection_accesses'),
    ('connection_tools'),
    ('chunks'),
    ('uploads'),
    ('file_versions'),
    ('folder_snapshots'),
    ('audit_logs'),
    ('chat_sessions'),
    ('chat_messages'),
    ('sync_changelog'),
    ('sync_runs'),
    ('db_connections'),
    ('agent_execution_logs'),
    ('etl_rules'),
    ('oauth_connections'),
    ('mcps'),
    ('mcp_bindings')
)
SELECT '❌ MISSING TABLE: ' || tbl AS issue
FROM expected_tables e
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = e.tbl
);

-- ============================================================
-- 2. 检查必需的列是否存在
-- ============================================================
WITH expected_columns(tbl, col) AS (VALUES
    -- projects
    ('projects', 'id'),
    ('projects', 'name'),
    ('projects', 'description'),
    ('projects', 'org_id'),
    ('projects', 'visibility'),
    ('projects', 'created_by'),
    ('projects', 'created_at'),
    ('projects', 'updated_at'),

    -- content_nodes
    ('content_nodes', 'id'),
    ('content_nodes', 'project_id'),
    ('content_nodes', 'created_by'),
    ('content_nodes', 'name'),
    ('content_nodes', 'type'),
    ('content_nodes', 'id_path'),
    ('content_nodes', 'depth'),
    ('content_nodes', 'preview_json'),
    ('content_nodes', 'preview_md'),
    ('content_nodes', 's3_key'),
    ('content_nodes', 'mime_type'),
    ('content_nodes', 'size_bytes'),
    ('content_nodes', 'permissions'),
    ('content_nodes', 'current_version'),
    ('content_nodes', 'content_hash'),
    ('content_nodes', 'created_at'),
    ('content_nodes', 'updated_at'),

    -- organizations
    ('organizations', 'id'),
    ('organizations', 'name'),
    ('organizations', 'slug'),
    ('organizations', 'type'),
    ('organizations', 'created_at'),
    ('organizations', 'updated_at'),

    -- org_members
    ('org_members', 'id'),
    ('org_members', 'org_id'),
    ('org_members', 'user_id'),
    ('org_members', 'role'),

    -- org_invitations
    ('org_invitations', 'id'),
    ('org_invitations', 'org_id'),
    ('org_invitations', 'email'),
    ('org_invitations', 'role'),
    ('org_invitations', 'token'),
    ('org_invitations', 'status'),
    ('org_invitations', 'invited_by'),
    ('org_invitations', 'expires_at'),

    -- project_members
    ('project_members', 'id'),
    ('project_members', 'project_id'),
    ('project_members', 'user_id'),
    ('project_members', 'role'),

    -- profiles
    ('profiles', 'user_id'),
    ('profiles', 'email'),
    ('profiles', 'display_name'),
    ('profiles', 'avatar_url'),
    ('profiles', 'default_org_id'),
    ('profiles', 'has_onboarded'),
    ('profiles', 'onboarded_at'),
    ('profiles', 'demo_project_id'),

    -- connections
    ('connections', 'id'),
    ('connections', 'project_id'),
    ('connections', 'provider'),
    ('connections', 'node_id'),
    ('connections', 'direction'),
    ('connections', 'status'),
    ('connections', 'access_key'),
    ('connections', 'config'),
    ('connections', 'trigger'),
    ('connections', 'user_id'),
    ('connections', 'created_at'),
    ('connections', 'updated_at'),

    -- connection_accesses
    ('connection_accesses', 'id'),
    ('connection_accesses', 'connection_id'),
    ('connection_accesses', 'node_id'),
    ('connection_accesses', 'json_path'),
    ('connection_accesses', 'permission'),

    -- connection_tools
    ('connection_tools', 'id'),
    ('connection_tools', 'connection_id'),
    ('connection_tools', 'tool_id'),
    ('connection_tools', 'enabled'),
    ('connection_tools', 'mcp_exposed'),

    -- uploads
    ('uploads', 'id'),
    ('uploads', 'project_id'),
    ('uploads', 'node_id'),
    ('uploads', 'type'),
    ('uploads', 'status'),

    -- file_versions
    ('file_versions', 'id'),
    ('file_versions', 'node_id'),
    ('file_versions', 'version'),
    ('file_versions', 'content_hash'),

    -- folder_snapshots
    ('folder_snapshots', 'id'),
    ('folder_snapshots', 'folder_node_id'),

    -- audit_logs
    ('audit_logs', 'id'),
    ('audit_logs', 'node_id'),
    ('audit_logs', 'action'),

    -- sync_changelog
    ('sync_changelog', 'id'),
    ('sync_changelog', 'project_id'),
    ('sync_changelog', 'node_id'),
    ('sync_changelog', 'folder_id'),
    ('sync_changelog', 'filename'),

    -- sync_runs
    ('sync_runs', 'id'),
    ('sync_runs', 'sync_id'),
    ('sync_runs', 'status'),

    -- chat_sessions
    ('chat_sessions', 'id'),
    ('chat_sessions', 'agent_id'),

    -- agent_execution_logs
    ('agent_execution_logs', 'id'),
    ('agent_execution_logs', 'agent_id')
)
SELECT '❌ MISSING COLUMN: ' || tbl || '.' || col AS issue
FROM expected_columns e
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = e.tbl
)
AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
);

-- ============================================================
-- 3. 检查必需的函数是否存在
-- ============================================================
WITH expected_functions(fn) AS (VALUES
    ('parent_path'),
    ('move_node_atomic'),
    ('check_no_cycle'),
    ('count_children_batch'),
    ('handle_new_user'),
    ('next_version')
)
SELECT '❌ MISSING FUNCTION: ' || fn AS issue
FROM expected_functions e
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.routines r
    WHERE r.routine_schema = 'public' AND r.routine_name = e.fn
);

-- ============================================================
-- 4. 检查不应该存在的列（已迁移移除的）
-- ============================================================
SELECT '⚠️ STALE COLUMN (should be dropped): content_nodes.parent_id' AS issue
WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_nodes' AND column_name = 'parent_id'
);

-- ============================================================
-- 5. 检查关键索引是否存在
-- ============================================================
WITH expected_indexes(idx) AS (VALUES
    ('idx_content_nodes_unique_name_v2'),
    ('idx_content_nodes_project_depth'),
    ('idx_content_nodes_children_lookup'),
    ('idx_content_nodes_id_path'),
    ('idx_content_nodes_project_id')
)
SELECT '❌ MISSING INDEX: ' || idx AS issue
FROM expected_indexes e
WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.indexname = e.idx
);

-- ============================================================
-- 6. 检查不应该存在的索引（已迁移移除的）
-- ============================================================
WITH stale_indexes(idx) AS (VALUES
    ('idx_content_nodes_unique_name'),
    ('idx_content_nodes_parent_id')
)
SELECT '⚠️ STALE INDEX (should be dropped): ' || idx AS issue
FROM stale_indexes e
WHERE EXISTS (
    SELECT 1 FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.indexname = e.idx
);

-- ============================================================
-- 7. 检查不应该存在的 trigger（已迁移移除的）
-- ============================================================
SELECT '⚠️ STALE TRIGGER: trg_auto_set_parent_id' AS issue
WHERE EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'content_nodes'
      AND trigger_name = 'trg_auto_set_parent_id'
);
