-- ============================================================
-- Phase 3: drop the mut_* compatibility shims left by Phase 2.
--
-- Phase 2 (20260528000000) renamed the version-engine tables to
-- version_* and the RPCs to version_*, then kept the old names alive
-- as:
--   * mut_* read-compat VIEWS over the renamed tables
--   * mut_*-named SQL wrapper functions delegating to version_*
-- so a rolling deploy could overlap old (mut_*) and new (version_*)
-- app images safely.
--
-- This migration removes those shims. RUN IT ONLY AFTER:
--   1. The db_names.py flip (Phase 2's paired backend change) has been
--      deployed and is the only running image — i.e. nothing calls the
--      mut_* RPC names or reads the mut_* views anymore.
--   2. Any external consumers (dashboards / analytics / ad-hoc SQL)
--      have been repointed to version_*.
--
-- It is intentionally a SEPARATE, later migration (not bundled into
-- Phase 2) so the compat window exists. On the internal-test qubits
-- deploy it can follow Phase 2 quickly; on a shared/prod environment
-- leave at least one stable release between them.
--
-- Reversible: re-running Phase 2's view + wrapper section recreates the
-- shims (they're pure forwarders, no data).
-- ============================================================

BEGIN;

-- Drop the delegating RPC wrappers (old mut_* names). No argument list:
-- each mut_* name is unique (only the wrapper bears it after Phase 2),
-- so Postgres resolves the DROP without a signature — avoids any
-- type-list mismatch with the generated wrappers.
DROP FUNCTION IF EXISTS public.publish_mut_scope_update;
DROP FUNCTION IF EXISTS public.publish_mut_project_update;
DROP FUNCTION IF EXISTS public.get_mut_project_write_state;
DROP FUNCTION IF EXISTS public.claim_mut_version_outbox_batch;
DROP FUNCTION IF EXISTS public.complete_mut_version_outbox;
DROP FUNCTION IF EXISTS public.fail_mut_version_outbox;

-- Drop the read-compat views (old mut_* table names).
DROP VIEW IF EXISTS public.mut_commits;
DROP VIEW IF EXISTS public.mut_scope_state;
DROP VIEW IF EXISTS public.mut_version_index;
DROP VIEW IF EXISTS public.mut_version_outbox;
DROP VIEW IF EXISTS public.mut_conflicts;
DROP VIEW IF EXISTS public.mut_object_locations;

NOTIFY pgrst, 'reload schema';

COMMIT;
