-- ============================================================
-- Unified Sync Architecture — Step 2: 数据迁移
-- Date: 2026-02-24
--
-- 前置条件：Step 1 已运行（syncs + uploads 表已创建）
--
-- 操作：
--   1. sync_sources + content_nodes sync 字段 → syncs
--   2. etl_task → uploads
--   3. sync_task → uploads
--   4. search_index_task → uploads
-- ============================================================


-- ============================================================
-- STEP 1: sync_sources → syncs
-- ============================================================
-- sync_sources 是连接级配置，每个 source 可能关联多个 content_nodes。
-- 新模型中 syncs 是节点级的，所以需要为每个关联的 content_node 创建一条 syncs 记录。
--
-- 映射关系：
--   sync_sources.sync_mode:
--     'bidirectional' → direction='bidirectional'
--     'pull_only'     → direction='inbound'
--     'push_only'     → direction='outbound'
--
--   sync_sources.adapter_type → syncs.provider（直接映射）
--
--   authority 根据 direction 推导：
--     inbound      → 'authoritative'
--     outbound     → 'mirror'
--     bidirectional → 'mirror'

INSERT INTO syncs (
    project_id,
    node_id,
    direction,
    provider,
    authority,
    config,
    credentials_ref,
    trigger,
    conflict_strategy,
    status,
    error_message,
    remote_hash,
    last_sync_version,
    created_at,
    updated_at
)
SELECT
    ss.project_id::TEXT,
    cn.id,
    -- direction mapping
    CASE ss.sync_mode
        WHEN 'pull_only' THEN 'inbound'
        WHEN 'push_only' THEN 'outbound'
        WHEN 'bidirectional' THEN 'bidirectional'
        ELSE 'inbound'
    END,
    -- provider
    ss.adapter_type,
    -- authority
    CASE ss.sync_mode
        WHEN 'pull_only' THEN 'authoritative'
        ELSE 'mirror'
    END,
    -- config: merge sync_source config with node-level info
    jsonb_strip_nulls(
        ss.config ||
        jsonb_build_object(
            'external_resource_id', cn.external_resource_id,
            'sync_url', cn.sync_url,
            'sync_id', cn.sync_id
        ) ||
        COALESCE(cn.sync_config, '{}'::JSONB)
    ),
    -- credentials_ref
    ss.credentials_ref,
    -- trigger
    COALESCE(ss.trigger_config, '{"type": "manual"}'::JSONB),
    -- conflict_strategy mapping
    CASE ss.conflict_strategy
        WHEN 'external_wins' THEN 'source_wins'
        WHEN 'puppyone_wins' THEN 'three_way_merge'
        WHEN 'manual' THEN 'three_way_merge'
        ELSE COALESCE(ss.conflict_strategy, 'three_way_merge')
    END,
    -- status
    CASE ss.status
        WHEN 'active' THEN 'active'
        WHEN 'paused' THEN 'paused'
        WHEN 'error' THEN 'error'
        ELSE 'active'
    END,
    ss.last_error,
    cn.remote_hash,
    cn.last_sync_version,
    ss.created_at,
    GREATEST(ss.updated_at, cn.updated_at)
FROM sync_sources ss
JOIN content_nodes cn ON cn.sync_source_id = ss.id
WHERE cn.sync_source_id IS NOT NULL;


-- ============================================================
-- STEP 2: 无 sync_source 但有 sync 信息的 content_nodes → syncs
-- ============================================================
-- 这些是通过 import/connect 创建的节点，有 sync_url/sync_id 但没有 sync_source_id。
-- 它们的 type 是 sync 类型（google_sheets, github_repo 等），需要也迁移到 syncs 表。

INSERT INTO syncs (
    project_id,
    node_id,
    direction,
    provider,
    authority,
    config,
    credentials_ref,
    conflict_strategy,
    status,
    last_synced_at,
    created_at,
    updated_at
)
SELECT
    cn.project_id,
    cn.id,
    'inbound',
    -- provider: 从 content_nodes.type 推断
    CASE cn.type
        WHEN 'google_sheets' THEN 'google_sheets'
        WHEN 'github_repo' THEN 'github'
        WHEN 'notion_page' THEN 'notion'
        WHEN 'gmail_thread' THEN 'gmail'
        WHEN 'google_calendar_event' THEN 'google_calendar'
        WHEN 'airtable_base' THEN 'airtable'
        ELSE cn.type
    END,
    'authoritative',
    -- config
    jsonb_strip_nulls(jsonb_build_object(
        'sync_url', cn.sync_url,
        'sync_id', cn.sync_id
    ) || COALESCE(cn.sync_config, '{}'::JSONB)),
    -- credentials_ref: 用 sync_oauth_user_id
    cn.sync_oauth_user_id,
    'three_way_merge',
    CASE cn.sync_status
        WHEN 'synced' THEN 'active'
        WHEN 'syncing' THEN 'syncing'
        WHEN 'error' THEN 'error'
        ELSE 'active'
    END,
    cn.last_synced_at,
    cn.created_at,
    cn.updated_at
FROM content_nodes cn
WHERE cn.sync_source_id IS NULL
  AND cn.type NOT IN ('folder', 'json', 'markdown', 'file')
  AND (cn.sync_url IS NOT NULL OR cn.sync_id IS NOT NULL OR cn.sync_config IS NOT NULL);


-- ============================================================
-- STEP 3: etl_task → uploads
-- ============================================================

INSERT INTO uploads (
    user_id,
    project_id,
    type,
    config,
    status,
    progress,
    error,
    result,
    created_at,
    updated_at
)
SELECT
    et.user_id,
    et.project_id,
    'file_ocr',
    jsonb_build_object(
        'filename', et.filename,
        'rule_id', et.rule_id,
        'legacy_etl_task_id', et.id
    ) || et.metadata,
    CASE et.status
        WHEN 'pending' THEN 'pending'
        WHEN 'running' THEN 'running'
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE et.status
    END,
    et.progress,
    et.error,
    et.result,
    et.created_at,
    et.updated_at
FROM etl_task et;


-- ============================================================
-- STEP 4: sync_task → uploads
-- ============================================================

INSERT INTO uploads (
    user_id,
    project_id,
    node_id,
    type,
    config,
    status,
    progress,
    message,
    error,
    result,
    created_at,
    updated_at,
    completed_at
)
SELECT
    st.user_id,
    st.project_id,
    st.root_node_id,
    'import',
    jsonb_build_object(
        'task_type', st.task_type,
        'source_url', st.source_url,
        'files_total', st.files_total,
        'files_processed', st.files_processed,
        'legacy_sync_task_id', st.id
    ) || st.metadata,
    CASE st.status
        WHEN 'pending' THEN 'pending'
        WHEN 'running' THEN 'running'
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE st.status
    END,
    st.progress,
    st.progress_message,
    st.error,
    CASE WHEN st.root_node_id IS NOT NULL
        THEN jsonb_build_object('root_node_id', st.root_node_id)
        ELSE NULL
    END,
    st.created_at,
    st.updated_at,
    st.completed_at
FROM sync_task st;


-- ============================================================
-- STEP 5: search_index_task → uploads
-- ============================================================

INSERT INTO uploads (
    user_id,
    project_id,
    node_id,
    type,
    config,
    status,
    error,
    result,
    created_at,
    updated_at,
    started_at,
    completed_at
)
SELECT
    sit.user_id,
    sit.project_id,
    sit.node_id,
    'search_index',
    jsonb_build_object(
        'tool_id', sit.tool_id,
        'json_path', sit.json_path,
        'folder_node_id', sit.folder_node_id,
        'legacy_search_index_task_id', sit.id
    ),
    CASE sit.status
        WHEN 'pending' THEN 'pending'
        WHEN 'running' THEN 'running'
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE sit.status
    END,
    sit.last_error,
    jsonb_build_object(
        'nodes_count', sit.nodes_count,
        'chunks_count', sit.chunks_count,
        'indexed_chunks_count', sit.indexed_chunks_count,
        'total_files', sit.total_files,
        'indexed_files', sit.indexed_files
    ),
    sit.created_at,
    sit.updated_at,
    sit.started_at,
    sit.finished_at
FROM search_index_task sit;


-- ============================================================
-- 完成 Step 2
--
-- 迁移结果验证（运行后可用以下查询检查）：
--
--   SELECT direction, provider, authority, count(*)
--   FROM syncs GROUP BY 1, 2, 3 ORDER BY 4 DESC;
--
--   SELECT type, status, count(*)
--   FROM uploads GROUP BY 1, 2 ORDER BY 3 DESC;
--
-- 如需回滚：
--   TRUNCATE syncs, uploads;
-- ============================================================
