-- Product-root publish path.
--
-- Frontend/Data-page operations are project-level user actions. They should
-- CAS the materialized project root and create one visible history/audit row;
-- scoped access-point refs are derived after publish by the application hook.

CREATE OR REPLACE FUNCTION public.publish_mut_project_update(
    p_project_id      TEXT,
    p_old_root_hash   TEXT,
    p_new_root_hash   TEXT,
    p_head_commit_id  TEXT,
    p_who             TEXT,
    p_message         TEXT,
    p_event_type      TEXT,
    p_changes         JSONB,
    p_conflicts       JSONB,
    p_created_at      TEXT,
    p_audit_agent_id  TEXT,
    p_audit_detail    JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    rows_affected INT;
    v_created_at TIMESTAMPTZ;
BEGIN
    v_created_at := COALESCE(NULLIF(p_created_at, '')::TIMESTAMPTZ, NOW());

    UPDATE public.projects
       SET mut_root_hash = p_new_root_hash,
           updated_at = NOW()
     WHERE id = p_project_id
       AND COALESCE(mut_root_hash, '') = COALESCE(p_old_root_hash, '');

    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    IF rows_affected = 0 THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.mut_scope_state
        (project_id, scope_path, scope_hash, head_commit_id)
    VALUES
        (p_project_id, '', p_new_root_hash, p_head_commit_id)
    ON CONFLICT (project_id, scope_path) DO UPDATE
       SET scope_hash = EXCLUDED.scope_hash,
           head_commit_id = EXCLUDED.head_commit_id,
           updated_at = NOW();

    INSERT INTO public.mut_commits
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

    INSERT INTO public.audit_logs
        (action, operator_type, operator_id, project_id, metadata)
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
            p_audit_detail
        );

    INSERT INTO public.mut_version_outbox
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
                'event_type', p_event_type
            )
        );

    RETURN TRUE;
END;
$$;
