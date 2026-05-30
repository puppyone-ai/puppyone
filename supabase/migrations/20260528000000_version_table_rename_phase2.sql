-- ============================================================
-- Phase 2: rename mut_* version-engine tables to version_*, point the
-- RPCs at the renamed tables, and keep mut_* names alive as
-- compatibility shims for a zero-downtime rollout.
--
-- Pairs with the backend change flipping db_names.py table + RPC
-- constants to version_*. Deploy order is safe in either direction:
--   * migration first  -> old app image still calls publish_mut_* etc.,
--     which now exist as SQL wrappers delegating to publish_version_*.
--   * app image first   -> impossible (the version_* names don't exist
--     until this migration runs), so always run the migration first.
--
-- Generated deterministically by scripts_gen_phase2.py (extract latest
-- RPC bodies from history, substitute version-engine table identifiers,
-- rename functions, emit mut_* delegating wrappers). Reviewed, then the
-- generator is deleted.
--
-- OUT OF SCOPE (deferred, see docs/architecture/07-mut-to-version-rename-plan.md):
--   * projects.mut_root_hash / github_sync_log.mut_commit_id column
--     renames — they live on product tables, not the version-engine
--     tables, and several RPC bodies reference mut_root_hash by name.
--     db_names.PROJECT_ROOT_HASH_COLUMN / GITHUB_SYNC_VERSION_COLUMN
--     stay mut_* for now.
--
-- Phase 3 (drop the mut_* compat views + wrappers) is a separate
-- later migration, run once nothing reads the old names.
-- ============================================================

BEGIN;

-- 1. Drop the Phase-1 forward alias views (they'd block the rename).
DROP VIEW IF EXISTS public.version_commits;
DROP VIEW IF EXISTS public.version_scope_state;
DROP VIEW IF EXISTS public.version_view_commits;
DROP VIEW IF EXISTS public.version_outbox;
DROP VIEW IF EXISTS public.version_conflicts;
DROP VIEW IF EXISTS public.version_object_locations;
-- 2. Rename the physical tables.
ALTER TABLE IF EXISTS public.mut_commits RENAME TO version_commits;
ALTER TABLE IF EXISTS public.mut_scope_state RENAME TO version_scope_state;
ALTER TABLE IF EXISTS public.mut_version_index RENAME TO version_view_commits;
ALTER TABLE IF EXISTS public.mut_version_outbox RENAME TO version_outbox;
ALTER TABLE IF EXISTS public.mut_conflicts RENAME TO version_conflicts;
ALTER TABLE IF EXISTS public.mut_object_locations RENAME TO version_object_locations;

-- 3. Recreate mut_* as read-compat views over the renamed tables, for
--    any external reader (dashboards / analytics) still using old names.
--    The rewritten RPCs below target version_* directly, so these views
--    are never on the write path (avoids the auto-updatable-view
--    ON CONFLICT limitation).
CREATE OR REPLACE VIEW public.mut_commits AS SELECT * FROM public.version_commits;
CREATE OR REPLACE VIEW public.mut_scope_state AS SELECT * FROM public.version_scope_state;
CREATE OR REPLACE VIEW public.mut_version_index AS SELECT * FROM public.version_view_commits;
CREATE OR REPLACE VIEW public.mut_version_outbox AS SELECT * FROM public.version_outbox;
CREATE OR REPLACE VIEW public.mut_conflicts AS SELECT * FROM public.version_conflicts;
CREATE OR REPLACE VIEW public.mut_object_locations AS SELECT * FROM public.version_object_locations;

GRANT SELECT ON public.mut_commits, public.mut_scope_state, public.mut_version_index, public.mut_version_outbox, public.mut_conflicts, public.mut_object_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mut_commits, public.mut_scope_state, public.mut_version_index, public.mut_version_outbox, public.mut_conflicts, public.mut_object_locations TO service_role;

-- 4. Re-create the six RPCs under version_* names, bodies rewritten to
--    target the renamed tables directly.

CREATE OR REPLACE FUNCTION public.publish_version_scope_update(
    p_project_id      TEXT,
    p_scope_path      TEXT,
    p_old_hash        TEXT,
    p_new_hash        TEXT,
    p_head_commit_id  TEXT,
    p_who             TEXT,
    p_message         TEXT,
    p_event_type      TEXT,
    p_changes         JSONB,
    p_conflicts       JSONB,
    p_created_at      TEXT,
    p_audit_agent_id  TEXT,
    p_audit_detail    JSONB,
    p_source_channel  TEXT DEFAULT '',
    p_policy          TEXT DEFAULT '',
    p_base_commit_id  TEXT DEFAULT '',
    p_client_commit_id TEXT DEFAULT '',
    p_proposed_tree_id TEXT DEFAULT '',
    p_intent_type      TEXT DEFAULT 'operation'
) RETURNS TABLE (
    published    BOOLEAN,
    txn_id       BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    rows_affected INT;
    v_created_at  TIMESTAMPTZ;
    v_txn_id      BIGINT;
BEGIN
    v_created_at := COALESCE(NULLIF(p_created_at, '')::TIMESTAMPTZ, NOW());

    IF p_old_hash = '' OR p_old_hash IS NULL THEN
        INSERT INTO public.version_scope_state
            (project_id, scope_path, scope_hash, head_commit_id)
        VALUES
            (p_project_id, p_scope_path, p_new_hash, p_head_commit_id)
        ON CONFLICT (project_id, scope_path) DO NOTHING;

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        IF rows_affected = 0 THEN
            UPDATE public.version_scope_state
               SET scope_hash = p_new_hash,
                   head_commit_id = p_head_commit_id,
                   updated_at = NOW()
             WHERE project_id = p_project_id
               AND scope_path = p_scope_path
               AND (scope_hash = p_old_hash OR (scope_hash IS NULL AND p_old_hash = ''));
            GET DIAGNOSTICS rows_affected = ROW_COUNT;
        END IF;
    ELSE
        UPDATE public.version_scope_state
           SET scope_hash = p_new_hash,
               head_commit_id = p_head_commit_id,
               updated_at = NOW()
         WHERE project_id = p_project_id
           AND scope_path = p_scope_path
           AND scope_hash = p_old_hash;
        GET DIAGNOSTICS rows_affected = ROW_COUNT;
    END IF;

    IF rows_affected = 0 THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, NULL::BIGINT;
        RETURN;
    END IF;

    INSERT INTO public.version_commits
        (project_id, commit_id, root_hash, scope_path, scope_hash, who, message, changes, conflicts, created_at)
    VALUES
        (
            p_project_id,
            p_head_commit_id,
            '',
            p_scope_path,
            p_new_hash,
            p_who,
            COALESCE(p_message, ''),
            COALESCE(p_changes, '[]'::JSONB),
            p_conflicts,
            v_created_at
        );

    INSERT INTO public.version_transactions
        (project_id, scope_path, source_channel, actor, intent_type, status,
         policy, base_commit_id, client_commit_id, proposed_tree_id,
         current_head_at_start, committed_commit_id, message, audit_detail,
         created_at, updated_at)
    VALUES
        (
            p_project_id,
            p_scope_path,
            COALESCE(NULLIF(p_source_channel, ''), 'papi'),
            COALESCE(p_who, ''),
            COALESCE(NULLIF(p_intent_type, ''), 'operation'),
            'committed',
            COALESCE(p_policy, ''),
            COALESCE(p_base_commit_id, ''),
            COALESCE(p_client_commit_id, ''),
            COALESCE(p_proposed_tree_id, ''),
            COALESCE(p_old_hash, ''),
            p_head_commit_id,
            COALESCE(p_message, ''),
            COALESCE(p_audit_detail, '{}'::JSONB),
            v_created_at,
            v_created_at
        )
    RETURNING id INTO v_txn_id;

    INSERT INTO public.audit_logs
        (action, operator_type, operator_id, project_id, metadata,
         transaction_id, canonical_commit_id, scope_path, source_channel,
         policy, status)
    VALUES
        (
            p_event_type,
            CASE
                WHEN p_audit_agent_id LIKE 'agent:%' THEN 'agent'
                WHEN p_audit_agent_id LIKE 'sync:%' THEN 'sync'
                WHEN p_audit_agent_id LIKE 'user:%' THEN 'user'
                ELSE 'system'
            END,
            p_audit_agent_id,
            p_project_id,
            p_audit_detail,
            v_txn_id,
            p_head_commit_id,
            p_scope_path,
            COALESCE(NULLIF(p_source_channel, ''), 'papi'),
            COALESCE(p_policy, ''),
            'committed'
        );

    INSERT INTO public.version_outbox
        (project_id, commit_id, event_type, payload)
    VALUES
        (
            p_project_id,
            p_head_commit_id,
            'version_committed',
            jsonb_build_object(
                'scope_path', p_scope_path,
                'scope_hash', p_new_hash,
                'event_type', p_event_type,
                'transaction_id', v_txn_id
            )
        );

    RETURN QUERY SELECT TRUE::BOOLEAN, v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_version_project_update(
    p_project_id       TEXT,
    p_old_root_hash    TEXT,
    p_new_root_hash    TEXT,
    p_head_commit_id   TEXT,
    p_who              TEXT,
    p_message          TEXT,
    p_event_type       TEXT,
    p_changes          JSONB,
    p_conflicts        JSONB,
    p_created_at       TEXT,
    p_audit_agent_id   TEXT,
    p_audit_detail     JSONB,
    p_source_channel   TEXT DEFAULT '',
    p_policy           TEXT DEFAULT '',
    p_base_commit_id   TEXT DEFAULT '',
    p_client_commit_id TEXT DEFAULT '',
    p_proposed_tree_id TEXT DEFAULT '',
    p_intent_type      TEXT DEFAULT 'operation'
) RETURNS TABLE (
    published BOOLEAN,
    txn_id    BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    rows_affected INT;
    v_created_at  TIMESTAMPTZ;
    v_txn_id      BIGINT;
BEGIN
    v_created_at := COALESCE(NULLIF(p_created_at, '')::TIMESTAMPTZ, NOW());

    UPDATE public.projects
       SET mut_root_hash = p_new_root_hash,
           updated_at = NOW()
     WHERE id = p_project_id
       AND COALESCE(mut_root_hash, '') = COALESCE(p_old_root_hash, '');

    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    IF rows_affected = 0 THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, NULL::BIGINT;
        RETURN;
    END IF;

    INSERT INTO public.version_scope_state
        (project_id, scope_path, scope_hash, head_commit_id)
    VALUES
        (p_project_id, '', p_new_root_hash, p_head_commit_id)
    ON CONFLICT (project_id, scope_path) DO UPDATE
       SET scope_hash = EXCLUDED.scope_hash,
           head_commit_id = EXCLUDED.head_commit_id,
           updated_at = NOW();

    INSERT INTO public.version_commits
        (project_id, commit_id, root_hash, scope_path, scope_hash, who, message, changes, conflicts, created_at)
    VALUES
        (
            p_project_id,
            p_head_commit_id,
            p_new_root_hash,
            '',
            p_new_root_hash,
            p_who,
            COALESCE(p_message, ''),
            COALESCE(p_changes, '[]'::JSONB),
            p_conflicts,
            v_created_at
        );

    INSERT INTO public.version_transactions
        (project_id, scope_path, source_channel, actor, intent_type, status,
         policy, base_commit_id, client_commit_id, proposed_tree_id,
         current_head_at_start, committed_commit_id, message, audit_detail,
         created_at, updated_at)
    VALUES
        (
            p_project_id,
            '',
            COALESCE(NULLIF(p_source_channel, ''), 'papi'),
            COALESCE(p_who, ''),
            COALESCE(NULLIF(p_intent_type, ''), 'operation'),
            'committed',
            COALESCE(p_policy, ''),
            COALESCE(p_base_commit_id, ''),
            COALESCE(p_client_commit_id, ''),
            COALESCE(NULLIF(p_proposed_tree_id, ''), p_new_root_hash),
            COALESCE(p_old_root_hash, ''),
            p_head_commit_id,
            COALESCE(p_message, ''),
            COALESCE(p_audit_detail, '{}'::JSONB),
            v_created_at,
            v_created_at
        )
    RETURNING id INTO v_txn_id;

    INSERT INTO public.audit_logs
        (action, operator_type, operator_id, project_id, metadata,
         transaction_id, canonical_commit_id, scope_path, source_channel,
         policy, status)
    VALUES
        (
            p_event_type,
            CASE
                WHEN p_audit_agent_id LIKE 'agent:%' THEN 'agent'
                WHEN p_audit_agent_id LIKE 'sync:%' THEN 'sync'
                WHEN p_audit_agent_id LIKE 'user:%' THEN 'user'
                ELSE 'system'
            END,
            p_audit_agent_id,
            p_project_id,
            p_audit_detail,
            v_txn_id,
            p_head_commit_id,
            '',
            COALESCE(NULLIF(p_source_channel, ''), 'papi'),
            COALESCE(p_policy, ''),
            'committed'
        );

    INSERT INTO public.version_outbox
        (project_id, commit_id, event_type, payload)
    VALUES
        (
            p_project_id,
            p_head_commit_id,
            'project_version_committed',
            jsonb_build_object(
                'scope_path', '',
                'scope_hash', p_new_root_hash,
                'root_hash', p_new_root_hash,
                'event_type', p_event_type,
                'transaction_id', v_txn_id,
                'source_channel', COALESCE(NULLIF(p_source_channel, ''), 'papi'),
                'policy', COALESCE(p_policy, '')
            )
        );

    RETURN QUERY SELECT TRUE::BOOLEAN, v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_version_project_write_state(
    p_project_id TEXT,
    p_user_id    TEXT
) RETURNS TABLE (
    project_id      TEXT,
    project_name    TEXT,
    org_id          TEXT,
    visibility      TEXT,
    role            TEXT,
    can_write       BOOLEAN,
    root_hash       TEXT,
    head_commit_id  TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH project_row AS (
        SELECT
            p.id::TEXT AS id,
            p.name::TEXT AS name,
            p.org_id::TEXT AS org_id,
            COALESCE(p.visibility, 'org')::TEXT AS visibility,
            COALESCE(p.mut_root_hash, '')::TEXT AS root_hash
        FROM public.projects p
        WHERE p.id::TEXT = p_project_id
        LIMIT 1
    ),
    membership AS (
        SELECT
            pr.*,
            om.role::TEXT AS org_role,
            pm.role::TEXT AS project_role
        FROM project_row pr
        LEFT JOIN public.org_members om
          ON om.org_id::TEXT = pr.org_id
         AND om.user_id::TEXT = p_user_id
        LEFT JOIN public.project_members pm
          ON pm.project_id::TEXT = pr.id
         AND pm.user_id::TEXT = p_user_id
    ),
    effective AS (
        SELECT
            m.*,
            CASE
                WHEN m.visibility = 'org' THEN COALESCE(m.org_role, '')
                WHEN m.org_role = 'owner' THEN 'owner'
                ELSE COALESCE(m.project_role, '')
            END::TEXT AS effective_role
        FROM membership m
    )
    SELECT
        e.id,
        e.name,
        e.org_id,
        e.visibility,
        e.effective_role,
        (e.effective_role = ANY (ARRAY['owner', 'admin', 'editor'])) AS can_write,
        e.root_hash,
        COALESCE(s.head_commit_id, '')::TEXT AS head_commit_id
    FROM effective e
    LEFT JOIN public.version_scope_state s
      ON s.project_id = e.id
     AND s.scope_path = '';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_version_outbox_batch(
    p_limit INT DEFAULT 50
) RETURNS TABLE (
    id BIGINT,
    project_id TEXT,
    commit_id TEXT,
    event_type TEXT,
    payload JSONB,
    attempts INT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH picked AS (
        SELECT o.id
          FROM public.version_outbox o
         WHERE o.processed_at IS NULL
           AND (o.locked_at IS NULL OR o.locked_at < NOW() - INTERVAL '5 minutes')
           AND o.created_at < NOW() - INTERVAL '15 seconds'
           AND o.attempts < 25
         ORDER BY o.created_at ASC, o.id ASC
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.version_outbox o
       SET locked_at = NOW(),
           attempts = o.attempts + 1,
           last_error = NULL
      FROM picked
     WHERE o.id = picked.id
    RETURNING o.id, o.project_id, o.commit_id, o.event_type, o.payload, o.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_version_outbox(
    p_id BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_affected INT;
BEGIN
    UPDATE public.version_outbox
       SET processed_at = NOW(),
           locked_at = NULL,
           last_error = NULL
     WHERE id = p_id
       AND processed_at IS NULL;
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RETURN rows_affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_version_outbox(
    p_id BIGINT,
    p_error TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_affected INT;
BEGIN
    UPDATE public.version_outbox
       SET locked_at = NULL,
           last_error = LEFT(COALESCE(p_error, ''), 2000)
     WHERE id = p_id
       AND processed_at IS NULL;
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    RETURN rows_affected > 0;
END;
$$;

-- 5. mut_*-named SQL wrappers delegating to the version_* functions, so
--    callers using the old RPC names keep working during the rolling deploy.

CREATE OR REPLACE FUNCTION public.publish_mut_scope_update(
    p_project_id      TEXT,
    p_scope_path      TEXT,
    p_old_hash        TEXT,
    p_new_hash        TEXT,
    p_head_commit_id  TEXT,
    p_who             TEXT,
    p_message         TEXT,
    p_event_type      TEXT,
    p_changes         JSONB,
    p_conflicts       JSONB,
    p_created_at      TEXT,
    p_audit_agent_id  TEXT,
    p_audit_detail    JSONB,
    p_source_channel  TEXT DEFAULT '',
    p_policy          TEXT DEFAULT '',
    p_base_commit_id  TEXT DEFAULT '',
    p_client_commit_id TEXT DEFAULT '',
    p_proposed_tree_id TEXT DEFAULT '',
    p_intent_type      TEXT DEFAULT 'operation'
)
RETURNS TABLE (
    published    BOOLEAN,
    txn_id       BIGINT
)
LANGUAGE sql
AS $$
    SELECT * FROM public.publish_version_scope_update(p_project_id, p_scope_path, p_old_hash, p_new_hash, p_head_commit_id, p_who, p_message, p_event_type, p_changes, p_conflicts, p_created_at, p_audit_agent_id, p_audit_detail, p_source_channel, p_policy, p_base_commit_id, p_client_commit_id, p_proposed_tree_id, p_intent_type);
$$;

CREATE OR REPLACE FUNCTION public.publish_mut_project_update(
    p_project_id       TEXT,
    p_old_root_hash    TEXT,
    p_new_root_hash    TEXT,
    p_head_commit_id   TEXT,
    p_who              TEXT,
    p_message          TEXT,
    p_event_type       TEXT,
    p_changes          JSONB,
    p_conflicts        JSONB,
    p_created_at       TEXT,
    p_audit_agent_id   TEXT,
    p_audit_detail     JSONB,
    p_source_channel   TEXT DEFAULT '',
    p_policy           TEXT DEFAULT '',
    p_base_commit_id   TEXT DEFAULT '',
    p_client_commit_id TEXT DEFAULT '',
    p_proposed_tree_id TEXT DEFAULT '',
    p_intent_type      TEXT DEFAULT 'operation'
)
RETURNS TABLE (
    published BOOLEAN,
    txn_id    BIGINT
)
LANGUAGE sql
AS $$
    SELECT * FROM public.publish_version_project_update(p_project_id, p_old_root_hash, p_new_root_hash, p_head_commit_id, p_who, p_message, p_event_type, p_changes, p_conflicts, p_created_at, p_audit_agent_id, p_audit_detail, p_source_channel, p_policy, p_base_commit_id, p_client_commit_id, p_proposed_tree_id, p_intent_type);
$$;

CREATE OR REPLACE FUNCTION public.get_mut_project_write_state(
    p_project_id TEXT,
    p_user_id    TEXT
)
RETURNS TABLE (
    project_id      TEXT,
    project_name    TEXT,
    org_id          TEXT,
    visibility      TEXT,
    role            TEXT,
    can_write       BOOLEAN,
    root_hash       TEXT,
    head_commit_id  TEXT
)
LANGUAGE sql
AS $$
    SELECT * FROM public.get_version_project_write_state(p_project_id, p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.claim_mut_version_outbox_batch(
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    id BIGINT,
    project_id TEXT,
    commit_id TEXT,
    event_type TEXT,
    payload JSONB,
    attempts INT
)
LANGUAGE sql
AS $$
    SELECT * FROM public.claim_version_outbox_batch(p_limit);
$$;

CREATE OR REPLACE FUNCTION public.complete_mut_version_outbox(
    p_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT public.complete_version_outbox(p_id);
$$;

CREATE OR REPLACE FUNCTION public.fail_mut_version_outbox(
    p_id BIGINT,
    p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT public.fail_version_outbox(p_id, p_error);
$$;


NOTIFY pgrst, 'reload schema';

COMMIT;
