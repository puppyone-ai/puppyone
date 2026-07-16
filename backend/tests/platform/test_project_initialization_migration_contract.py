from __future__ import annotations

from pathlib import Path

MIGRATION = (
    Path(__file__).parents[3]
    / "supabase/migrations/20260716010000_project_initialization_control_plane.sql"
)


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _function(sql: str, name: str, next_name: str) -> str:
    return sql.split(f"CREATE FUNCTION public.{name}", 1)[1].split(
        f"CREATE FUNCTION public.{next_name}", 1
    )[0]


def test_project_replay_is_resolved_before_org_quota_admission():
    function = _function(
        _sql(),
        "create_project_idempotent",
        "complete_project_initialization",
    )

    replay_lookup = function.index("FROM public.project_create_operations")
    replay_return = function.index("'initializing_replayed'")
    org_lock = function.index("FROM public.organizations")
    quota_count = function.index("SELECT count(*) INTO current_count")
    project_insert = function.index("INSERT INTO public.projects")
    admin_insert = function.index("INSERT INTO public.project_members")
    operation_insert = function.index("INSERT INTO public.project_create_operations")

    assert replay_lookup < replay_return < org_lock < quota_count
    assert quota_count < project_insert < admin_insert < operation_insert
    assert "version_root_hash" not in function
    assert "mut_root_hash" not in function
    assert "L5" in function
    assert "p_org_id text" in function


def test_l5_owns_initial_root_write_and_control_plane_only_verifies_completion():
    sql = _sql()
    create_function = _function(
        sql,
        "create_project_idempotent",
        "complete_project_initialization",
    )
    completion = _function(
        sql,
        "complete_project_initialization",
        "claim_project_initialization_operations",
    )

    assert "'outcome', 'initializing_created'" in create_function
    assert "status IN ('initializing', 'ready', 'deleted')" in sql
    assert "project_row.version_root_hash IS DISTINCT FROM project_row.mut_root_hash" in completion
    assert "operation.publication_mode = 'empty'" in completion
    assert "project_row.version_root_hash <> empty_tree" in completion
    assert "SET status = 'ready'" in completion
    assert "SET version_root_hash" not in completion
    assert "SET mut_root_hash" not in completion
    assert "claim_project_initialization_operations" in sql
    assert "fail_project_initialization_operation" in sql


def test_project_publication_is_gated_until_l5_completion():
    sql = _sql()
    create_function = _function(
        sql,
        "create_project_idempotent",
        "complete_project_initialization",
    )
    completion = _function(
        sql,
        "complete_project_initialization",
        "claim_project_initialization_operations",
    )
    credential = _function(
        sql,
        "issue_user_git_http_credential_idempotent",
        "abort_deferred_project_publication",
    )

    assert "ADD COLUMN lifecycle_status text;" in sql
    assert "UPDATE public.projects SET lifecycle_status = 'ready';" in sql
    assert "ALTER COLUMN lifecycle_status DROP DEFAULT" in sql
    assert "ALTER COLUMN lifecycle_status SET NOT NULL" in sql
    assert "p.lifecycle_status = 'ready'" in sql
    assert "p.lifecycle_status = 'ready'" in credential
    assert "p_share_token, 'initializing'" in create_function
    project_ready = completion.index("UPDATE public.projects")
    operation_ready = completion.index("UPDATE public.project_create_operations", project_ready)
    assert project_ready < operation_ready
    assert "SET lifecycle_status = 'ready'" in completion
    assert "JOIN public.projects p" in sql
    assert "AND p.lifecycle_status = 'ready'" in sql


def test_legacy_project_creation_rpc_is_removed_without_a_default_escape_hatch():
    sql = _sql()

    assert (
        "DROP FUNCTION IF EXISTS public.create_project_with_admin(\n"
        "    text, text, text, text, uuid, text\n"
        ");"
    ) in sql
    lifecycle_alter = sql.split("UPDATE public.projects SET lifecycle_status = 'ready';", 1)[1]
    lifecycle_alter = lifecycle_alter.split("CREATE INDEX projects_ready_org_idx", 1)[0]
    assert "DROP DEFAULT" in lifecycle_alter
    assert "SET DEFAULT" not in lifecycle_alter
    assert "SET NOT NULL" in lifecycle_alter


def test_credential_operation_persists_only_hashes_and_has_actor_key_uniqueness():
    sql = _sql()
    table = sql.split("CREATE TABLE public.git_credential_issue_operations", 1)[1].split(
        "CREATE TABLE public.project_deletion_jobs", 1
    )[0]
    function = _function(
        sql,
        "issue_user_git_http_credential_idempotent",
        "abort_deferred_project_publication",
    )

    assert "PRIMARY KEY (actor_user_id, operation_key)" in table
    assert "credential_hash text NOT NULL" in table
    assert "credential text" not in table
    assert "p_key_hash" in function
    assert "p_raw" not in function
    assert "p_credential text" not in function


def test_publication_modes_are_explicit_and_deferred_work_has_a_durable_deadline():
    sql = _sql()
    table = sql.split("CREATE TABLE public.project_create_operations", 1)[1].split(
        "CREATE INDEX project_create_operations_project_idx", 1
    )[0]
    create_function = _function(
        sql,
        "create_project_idempotent",
        "complete_project_initialization",
    )

    assert "publication_mode text NOT NULL" in table
    assert "publication_mode IN ('empty', 'deferred')" in table
    assert "p_publication_mode text" in create_function
    assert "p_publication_mode NOT IN ('empty', 'deferred')" in create_function
    assert "existing_operation.publication_mode IS DISTINCT FROM p_publication_mode" in (
        create_function
    )
    assert "WHEN 'deferred' THEN now() + interval '6 hours'" in create_function


def test_deferred_abort_is_service_only_and_always_persists_exact_prefix_cleanup():
    sql = _sql()
    function = _function(
        sql,
        "abort_deferred_project_publication",
        "_project_initialization_has_cascade_dependents",
    )

    mode_guard = function.index("operation.publication_mode <> 'deferred'")
    project_lookup = function.index("FROM public.projects")
    job_insert = function.index("INSERT INTO public.project_deletion_jobs")
    project_delete = function.index("DELETE FROM public.projects")
    assert mode_guard < project_lookup < job_insert < project_delete
    assert "operation.initialization_claimed_by IS DISTINCT FROM p_worker_id" in function
    assert "project_row.lifecycle_status <> 'initializing'" in function
    assert "project_row.org_id IS DISTINCT FROM operation.org_id" in function
    assert "'publication_abort'" in function
    for prefix in ("'version/'", "'mut/'", "'projects/'"):
        assert prefix in function
    assert (
        "REVOKE ALL ON FUNCTION public.abort_deferred_project_publication(\n"
        "    text, text, uuid, integer, text\n"
        ") FROM PUBLIC, anon, authenticated;"
    ) in sql
    assert (
        "GRANT EXECUTE ON FUNCTION public.abort_deferred_project_publication(\n"
        "    text, text, uuid, integer, text\n"
        ") TO service_role;"
    ) in sql


def test_deletion_tombstone_survives_project_and_has_quiescent_two_phase_cleanup():
    sql = _sql()
    table = sql.split("CREATE TABLE public.project_deletion_jobs", 1)[1].split(
        "ALTER TABLE public.project_create_operations", 1
    )[0]

    assert "REFERENCES public.projects" not in table
    assert "quiescence_seconds integer NOT NULL" in table
    assert "CHECK (quiescence_seconds >= 1800)" in table
    assert "phase IN ('purge', 'verify')" in table
    assert "available_at = now() + make_interval" in sql
    assert "schedule_project_deletion_verification" in sql
    assert "AND phase = 'verify'" in sql
    assert "FOR UPDATE SKIP LOCKED" in sql
    for prefix in ("'version/'", "'mut/'", "'projects/'"):
        assert prefix in sql


def test_project_delete_locks_authorization_facts_before_final_role_resolution():
    function = _function(
        _sql(),
        "delete_project_control_plane",
        "claim_project_deletion_jobs",
    )

    project_lock = function.index("FROM public.projects project")
    org_membership_lock = function.index("FROM public.org_members member")
    project_membership_lock = function.index("FROM public.project_members member")
    final_role_resolution = function.index("FROM public.resolve_project_role")
    destructive_job = function.index("INSERT INTO public.project_deletion_jobs")

    assert project_lock < org_membership_lock < project_membership_lock
    assert project_membership_lock < final_role_resolution < destructive_job
    assert function.count("FOR UPDATE") >= 3


def test_abandon_proves_exact_empty_bootstrap_state_before_mutating_any_resource():
    sql = _sql()
    helper = sql.split("CREATE FUNCTION public._project_initialization_has_cascade_dependents", 1)[
        1
    ].split("CREATE FUNCTION public.abandon_project_initialization", 1)[0]
    function = _function(
        sql,
        "abandon_project_initialization",
        "delete_project_control_plane",
    )

    assert "constraint_row.confrelid = 'public.projects'::regclass" in helper
    assert "constraint_row.confdeltype = 'c'" in helper
    assert "pg_catalog.generate_subscripts" in helper
    assert "version_root_hash" in function
    assert "mut_root_hash" in function
    assert "state.scope_path <> ''" in function
    assert "COALESCE(state.scope_hash, '') <> ''" in function
    assert "tx.status = 'committed'" in function
    assert "member.role = 'admin'" in function
    assert "member.granted_by = p_actor_user_id" in function
    assert "surface.scope_id IS NOT NULL" in function
    assert "public._project_initialization_has_cascade_dependents" in function
    assert "create_operation.publication_mode <> 'empty'" in function

    first_mutation = function.index("UPDATE public.access_surface_credentials")
    assert function.index("create_operation.publication_mode <> 'empty'") < first_mutation
    assert (
        function.index("RETURN jsonb_build_object('outcome', 'not_abandonable')") < first_mutation
    )
    assert function.index("public._project_initialization_has_cascade_dependents") < first_mutation
