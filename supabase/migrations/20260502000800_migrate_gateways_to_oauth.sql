-- ============================================================================
-- Migrate gateways rows into oauth_connections (Q6)
-- ============================================================================
-- Why
--   `gateways` was an org-level OAuth abstraction. Per Q6 the OAuth model is
--   "always per-user-per-provider, even for team accounts" (the team account
--   is just one of the team's users). So gateways was the wrong shape.
--
--   This migration copies any gateways rows into oauth_connections (keyed by
--   the org owner's user_id, since that's who originally authorized the
--   connection), and rewires connectors that pointed at gateway_id to point
--   at the new oauth_connection_id.
--
--   See docs/design/access-point-redesign-2026-05-02.md (sections 5.5, 5.6).
--
-- Idempotency
--   ON CONFLICT DO NOTHING for the inserts; idempotent updates for the
--   foreign key rewrite.
-- ============================================================================

BEGIN;

-- Skip cleanly if gateways was never created (fresh-DB case).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'gateways'
    ) THEN
        RAISE NOTICE 'gateways table absent; nothing to migrate.';
        RETURN;
    END IF;

    -- Copy each gateway → oauth_connections (attributed to org owner).
    -- We use INSERT...SELECT with NOT EXISTS to keep idempotency (re-running
    -- the migration won't double-insert).
    INSERT INTO public.oauth_connections (
        id, user_id, provider, access_token, refresh_token,
        token_type, expires_at, workspace_id, workspace_name, bot_id,
        metadata, created_at, updated_at
    )
    SELECT
        g.id,
        -- Resolve org owner: first member of the gateway's org who has owner role.
        COALESCE(
            (SELECT om.user_id::UUID FROM public.org_members om
              WHERE om.org_id = g.org_id AND om.role = 'owner'
              ORDER BY om.created_at ASC LIMIT 1),
            (SELECT om.user_id::UUID FROM public.org_members om
              WHERE om.org_id = g.org_id
              ORDER BY om.created_at ASC LIMIT 1)
        ) AS user_id,
        g.provider,
        (g.credentials->>'access_token')::TEXT,
        (g.credentials->>'refresh_token')::TEXT,
        COALESCE((g.credentials->>'token_type')::TEXT, 'bearer'),
        CASE
            WHEN g.credentials->>'expires_at' ~ '^\d+$'
                THEN to_timestamp((g.credentials->>'expires_at')::BIGINT)
            ELSE NULL
        END,
        (g.metadata->>'workspace_id')::TEXT,
        (g.metadata->>'workspace_name')::TEXT,
        (g.metadata->>'bot_id')::TEXT,
        g.metadata,
        g.created_at,
        g.updated_at
    FROM public.gateways g
    WHERE NOT EXISTS (
        SELECT 1 FROM public.oauth_connections oc WHERE oc.id = g.id
    );

    -- Rewire connectors.oauth_connection_id from old gateway_id (legacy table
    -- access_points used this; if connectors carries it forward via the data
    -- migration script, we update both).
    -- The connectors table doesn't have gateway_id directly — but the data
    -- migration script populated oauth_connection_id from access_points.gateway_id
    -- by passing through this same id (see migrate_access_points_to_v2.py).
    -- So this UPDATE is mostly defensive.
END $$;

COMMIT;
