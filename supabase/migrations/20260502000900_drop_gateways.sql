-- ============================================================================
-- DROP gateways table (after migration to oauth_connections)
-- ============================================================================
-- Why
--   The previous migration (20260502000800) copied every gateways row into
--   oauth_connections. This migration drops the now-empty gateways table.
--
--   See docs/design/access-point-redesign-2026-05-02.md (sections 5.5, 5.6).
--
-- Safety
--   We verify every gateway id is also present in oauth_connections before
--   dropping. If anything's missing, abort and ask the operator to re-run
--   the migration migration above.
--
-- Idempotency
--   IF EXISTS check; safe to re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    has_table        BOOLEAN;
    gateways_count   INTEGER;
    missing          INTEGER;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'gateways'
    ) INTO has_table;

    IF NOT has_table THEN
        RAISE NOTICE 'gateways already absent; nothing to drop.';
        RETURN;
    END IF;

    EXECUTE 'SELECT COUNT(*) FROM public.gateways' INTO gateways_count;

    IF gateways_count > 0 THEN
        SELECT COUNT(*) INTO missing
          FROM public.gateways g
         WHERE NOT EXISTS (
             SELECT 1 FROM public.oauth_connections oc WHERE oc.id = g.id
         );
        IF missing > 0 THEN
            RAISE EXCEPTION
                'gateways still has % rows missing from oauth_connections. '
                'Re-run migration 20260502000800_migrate_gateways_to_oauth.sql '
                'before applying this migration.', missing;
        END IF;
    END IF;

    DROP TABLE public.gateways CASCADE;
    RAISE NOTICE 'gateways dropped (had % rows pre-drop).', gateways_count;
END $$;

COMMIT;
