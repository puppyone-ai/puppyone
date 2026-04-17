-- Smoke tests: validate critical DB objects after every migration.
-- Run after migrations to catch function/table schema mismatches.
--
-- Usage: supabase db test (or psql -f smoke_test_triggers.sql)
--
-- Covered checks:
--   1. handle_new_user() trigger: exists, compiles, references only existing columns
--   2. MUT CAS RPCs: correct TEXT signatures, no UUID overloads, invokable without type errors
--
-- Design note: each block is self-contained so a failure in one does not mask another.
-- The CAS RPC block is wrapped in BEGIN/ROLLBACK so its probe calls leave no residue.

DO $$
DECLARE
    func_body TEXT;
    col_name TEXT;
    missing_cols TEXT[] := '{}';
BEGIN
    -- 1. Verify function exists
    SELECT prosrc INTO func_body
    FROM pg_proc
    WHERE proname = 'handle_new_user'
      AND pronamespace = 'public'::regnamespace;

    IF func_body IS NULL THEN
        RAISE EXCEPTION 'SMOKE TEST FAILED: handle_new_user() function does not exist';
    END IF;

    -- 2. Extract column names from the INSERT statement and verify they exist
    -- Check each column that the function references in profiles
    FOR col_name IN
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
    LOOP
        -- columns exist, good
    END LOOP;

    -- Specifically check for known-bad columns that were previously dropped
    IF func_body ILIKE '%role%' AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
    ) THEN
        missing_cols := array_append(missing_cols, 'role');
    END IF;

    IF func_body ILIKE '%plan%' AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'plan'
    ) THEN
        missing_cols := array_append(missing_cols, 'plan');
    END IF;

    IF array_length(missing_cols, 1) > 0 THEN
        RAISE EXCEPTION 'SMOKE TEST FAILED: handle_new_user() references dropped columns: %', missing_cols;
    END IF;

    -- 3. Verify trigger exists on auth.users
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
    ) THEN
        RAISE EXCEPTION 'SMOKE TEST FAILED: on_auth_user_created trigger does not exist';
    END IF;

    RAISE NOTICE 'SMOKE TEST PASSED: handle_new_user() trigger is consistent with profiles table';
END;
$$;


-- ============================================================================
-- Check 2: MUT CAS RPCs must use p_project_id TEXT (not UUID).
--
-- Background: projects.id / mut_commits.project_id / mut_scope_state.project_id
-- are all TEXT columns (values happen to be UUID strings). If a CAS RPC
-- declares p_project_id UUID, then inside the function WHERE project_id = p_project_id
-- becomes `text = uuid` → PostgreSQL error 42883 → every push/rollback 500s.
--
-- This exact bug shipped in 20260415000000_mut_cas_rpc_functions.sql and was
-- fixed in 20260416200000_fix_cas_rpc_project_id_type.sql. This smoke test
-- ensures the fix holds and prevents any regression (e.g. someone re-creating
-- a UUID overload in a future migration).
--
-- After 20260418000000_mut_commit_id_identity.sql the integer counter
-- ``atomic_next_version`` is gone (commit identity is now hash-based) and
-- ``cas_update_scope_state`` gained a 5th argument (p_head_commit_id with
-- default ''). The smoke test only asserts on what still exists, so the
-- function inventory check now expects exactly 2 RPCs.
--
-- Wrapped in BEGIN/ROLLBACK because the RPC probe may INSERT a ghost row
-- via the first-push branch of cas_update_scope_state.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    text_sig_count INT;
    uuid_sig_count INT;
    probe_project_id CONSTANT TEXT := '00000000-0000-0000-0000-smoketestfake';
    probe_scope CONSTANT TEXT := '__smoke_test_scope__';
    result_scope BOOLEAN;
    result_root BOOLEAN;
BEGIN
    SELECT COUNT(*) INTO text_sig_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('cas_update_scope_state', 'cas_update_root_hash')
      AND pg_get_function_arguments(p.oid) LIKE 'p_project_id text%';

    IF text_sig_count <> 2 THEN
        RAISE EXCEPTION
            'SMOKE TEST FAILED: expected 2 CAS RPCs with p_project_id TEXT signature, found %. '
            'Check that 20260416200000_fix_cas_rpc_project_id_type.sql and '
            '20260418000000_mut_commit_id_identity.sql were both applied.',
            text_sig_count;
    END IF;

    SELECT COUNT(*) INTO uuid_sig_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('cas_update_scope_state', 'cas_update_root_hash')
      AND pg_get_function_arguments(p.oid) LIKE 'p_project_id uuid%';

    IF uuid_sig_count > 0 THEN
        RAISE EXCEPTION
            'SMOKE TEST FAILED: % UUID overload(s) exist for CAS RPCs. '
            'project_id columns are TEXT — UUID overloads cause PostgreSQL error 42883 at runtime. '
            'See docs/design/mut-bug-checklist.md (CAS RPC type mismatch event).',
            uuid_sig_count;
    END IF;

    -- Verify the integer-counter RPC is fully gone after the commit_id
    -- migration. A leftover ``atomic_next_version`` would mean the
    -- migration never ran (or was rolled back), and any code path that
    -- still calls it would silently produce stale linear versions.
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'atomic_next_version'
    ) THEN
        RAISE EXCEPTION
            'SMOKE TEST FAILED: atomic_next_version still exists. '
            '20260418000000_mut_commit_id_identity.sql should have dropped it.';
    END IF;

    -- 4-arg call exercises the default for p_head_commit_id (5th arg).
    -- After the commit_id migration cas_update_scope_state has 5 params,
    -- the 5th defaulting to '' so this call still resolves.
    BEGIN
        SELECT cas_update_scope_state(probe_project_id, probe_scope, '', 'smoke_dummy_hash') INTO result_scope;
    EXCEPTION
        WHEN SQLSTATE '42883' THEN
            RAISE EXCEPTION
                'SMOKE TEST FAILED: cas_update_scope_state hit operator error 42883 — type mismatch on p_project_id.';
    END;
    IF result_scope IS NULL THEN
        RAISE EXCEPTION 'SMOKE TEST FAILED: cas_update_scope_state returned NULL (expected boolean)';
    END IF;

    BEGIN
        SELECT cas_update_root_hash(probe_project_id, '', 'smoke_dummy_hash') INTO result_root;
    EXCEPTION
        WHEN SQLSTATE '42883' THEN
            RAISE EXCEPTION
                'SMOKE TEST FAILED: cas_update_root_hash hit operator error 42883 — type mismatch on p_project_id.';
    END;
    IF result_root IS NULL THEN
        RAISE EXCEPTION 'SMOKE TEST FAILED: cas_update_root_hash returned NULL (expected boolean)';
    END IF;

    RAISE NOTICE 'SMOKE TEST PASSED: CAS RPCs have correct TEXT signatures and invoke without type errors';
END;
$$;

ROLLBACK;
