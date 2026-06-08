-- ============================================================================
-- Remove the legacy filesystem Access provider
-- ============================================================================
-- Product model after this migration:
--   - git_remote: native Git clone/pull/push
--   - cli: FS CLI commands through /api/v1/ap-fs/*
--
-- The old provider='filesystem' / kind='filesystem' shell did not own the file
-- data plane; Git Remote and AP-FS do. Remove it as a first-class Access
-- surface so new and existing scopes expose only the two real entry points.
-- ============================================================================

BEGIN;

DELETE FROM public.access_surfaces
WHERE kind = 'filesystem';

DELETE FROM public.connectors
WHERE provider = 'filesystem';

DELETE FROM public.connections
WHERE provider = 'filesystem';

DROP INDEX IF EXISTS public.idx_access_surfaces_builtin_one_per_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_surfaces_builtin_one_per_scope
    ON public.access_surfaces(scope_id, kind)
    WHERE kind IN ('git_remote', 'cli');

ALTER TABLE public.access_surfaces
    DROP CONSTRAINT IF EXISTS access_surfaces_kind_check;

ALTER TABLE public.access_surfaces
    ADD CONSTRAINT access_surfaces_kind_check
    CHECK (kind IN ('git_remote', 'cli', 'agent', 'mcp', 'sandbox'));

DROP INDEX IF EXISTS public.idx_connectors_builtin_one_per_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_connectors_builtin_one_per_scope
    ON public.connectors (scope_id, provider)
    WHERE provider IN ('cli', 'agent');

COMMIT;
