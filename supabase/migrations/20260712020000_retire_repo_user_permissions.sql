-- ==========================================================================
-- Retire the duplicate human permission source
-- ==========================================================================
-- This is intentionally fail-closed. Denied rows, folder-scoped human ACLs,
-- tenant mismatches, or conflicting roles require an explicit data decision;
-- silently widening or narrowing access is not an acceptable migration.

BEGIN;

DO $$
DECLARE
    report jsonb;
    conflict_count bigint;
BEGIN
    IF to_regclass('public.repo_user_permissions') IS NULL THEN
        RETURN;
    END IF;

    report := public.unified_authorization_preflight();
    IF (report->>'legacy_denied')::bigint > 0
       OR (report->>'legacy_scoped')::bigint > 0
       OR (report->>'legacy_tenant_mismatch')::bigint > 0
       OR (report->>'legacy_unknown_roles')::bigint > 0
       OR (report->>'invalid_project_members')::bigint > 0
       OR (report->>'creator_admin_unresolved')::bigint > 0
       OR (report->>'duplicate_or_missing_root_scopes')::bigint > 0
       OR (report->>'orphan_access_surfaces')::bigint > 0
       OR (report->>'orphan_access_credentials')::bigint > 0
       OR (report->>'invalid_access_tool_bindings')::bigint > 0 THEN
        RAISE EXCEPTION
          'repo_user_permissions retirement blocked; preflight=%', report;
    END IF;

    SELECT count(*) INTO conflict_count
    FROM public.repo_user_permissions rp
    JOIN public.project_members pm
      ON pm.project_id = rp.project_id AND pm.user_id = rp.user_id
    WHERE pm.role <> CASE rp.role
        WHEN 'admin' THEN 'admin'
        WHEN 'editor' THEN 'editor'
        WHEN 'reader' THEN 'viewer'
        ELSE pm.role
    END;

    IF conflict_count > 0 THEN
        RAISE EXCEPTION
          'repo_user_permissions retirement blocked: % conflicting explicit roles',
          conflict_count;
    END IF;

    INSERT INTO public.project_members (
        id, org_id, project_id, user_id, role, granted_by, created_at, updated_at
    )
    SELECT
        gen_random_uuid()::text,
        p.org_id,
        rp.project_id,
        rp.user_id,
        CASE rp.role
            WHEN 'admin' THEN 'admin'
            WHEN 'editor' THEN 'editor'
            WHEN 'reader' THEN 'viewer'
        END,
        rp.granted_by,
        rp.granted_at,
        rp.granted_at
    FROM public.repo_user_permissions rp
    JOIN public.projects p ON p.id = rp.project_id
    WHERE rp.role IN ('admin', 'editor', 'reader')
    ON CONFLICT (project_id, user_id) DO NOTHING;
END $$;

-- Remove the preflight function's dependency on the legacy table before the
-- table itself is dropped. The final table-free report is recreated below.
DROP FUNCTION IF EXISTS public.unified_authorization_preflight();
DROP TABLE IF EXISTS public.repo_user_permissions;

CREATE OR REPLACE FUNCTION public.unified_authorization_preflight()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
SELECT jsonb_build_object(
    'invalid_project_members', (
        SELECT count(*) FROM public.project_members pm
        LEFT JOIN public.projects p
          ON p.id = pm.project_id AND p.org_id = pm.org_id
        LEFT JOIN public.org_members om
          ON om.org_id = pm.org_id AND om.user_id = pm.user_id
        WHERE p.id IS NULL OR om.id IS NULL
    ),
    'creator_admin_unresolved', (
        SELECT count(*) FROM public.projects p
        LEFT JOIN public.org_members om
          ON om.org_id = p.org_id AND om.user_id = p.created_by
        LEFT JOIN public.project_members pm
          ON pm.project_id = p.id AND pm.user_id = p.created_by
        WHERE p.created_by IS NOT NULL
          AND (om.id IS NULL OR pm.role IS DISTINCT FROM 'admin')
    ),
    'duplicate_or_missing_root_scopes', (
        SELECT count(*) FROM (
            SELECT p.id
            FROM public.projects p
            LEFT JOIN public.repo_scopes s
              ON s.project_id = p.id AND s.is_root = true
            GROUP BY p.id
            HAVING count(s.id) <> 1
        ) invalid_roots
    ),
    'orphan_access_surfaces', (
        SELECT count(*) FROM public.access_surfaces s
        LEFT JOIN public.projects p
          ON p.id = s.project_id AND p.org_id = s.org_id
        LEFT JOIN public.repo_scopes rs
          ON rs.id = s.scope_id AND rs.project_id = s.project_id
        WHERE p.id IS NULL OR rs.id IS NULL
    ),
    'orphan_access_credentials', (
        SELECT count(*) FROM public.access_surface_credentials c
        LEFT JOIN public.access_surfaces s
          ON s.id = c.access_surface_id
         AND s.project_id = c.project_id
         AND s.org_id = c.org_id
        WHERE s.id IS NULL
    ),
    'invalid_access_tool_bindings', (
        SELECT count(*) FROM public.access_tools at
        LEFT JOIN public.access_surfaces s ON s.id = at.access_point_id
        LEFT JOIN public.tools t ON t.id = at.tool_id
        WHERE s.id IS NULL
           OR t.id IS NULL
           OR t.org_id IS DISTINCT FROM s.org_id
           OR (t.project_id IS NOT NULL
               AND t.project_id IS DISTINCT FROM s.project_id)
    ),
    'legacy_denied', 0,
    'legacy_scoped', 0,
    'legacy_tenant_mismatch', 0,
    'legacy_unknown_roles', 0,
    'legacy_table_present', false
);
$$;

COMMIT;
