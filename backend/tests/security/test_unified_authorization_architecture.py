from pathlib import Path

from src.platform.authorization.manifest import PROJECT_ROUTE_AUTHORIZATION
from src.platform.authorization.models import ACTION_CAPABILITY, ProjectAction


BACKEND = Path(__file__).resolve().parents[2]
SRC = BACKEND / "src"


def _runtime_python_text() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in SRC.rglob("*.py")
    )


def test_legacy_human_permission_runtime_is_removed():
    text = _runtime_python_text()
    assert "repo_user_permissions" not in text
    assert "verify_project_access" not in text
    assert not (SRC / "repo" / "permission_router.py").exists()
    assert not (SRC / "repo" / "permission_service.py").exists()
    assert not (SRC / "repo" / "permission_repository.py").exists()


def test_project_routes_use_named_actions():
    project_router = (SRC / "platform" / "project" / "router.py").read_text()
    binding_router = (
        SRC / "platform" / "workspace_binding" / "router.py"
    ).read_text()
    assert "require_project_action(ProjectAction." in project_router
    assert "require_project_action(ProjectAction." in binding_router
    assert "if role" not in project_router


def test_every_named_project_action_has_one_capability_contract():
    assert set(ACTION_CAPABILITY) == set(ProjectAction)


def test_only_authorization_boundary_reads_project_membership_facts():
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.is_relative_to(SRC / "platform" / "authorization"):
            continue
        text = path.read_text(encoding="utf-8")
        if '.table("project_members")' in text or ".table('project_members')" in text:
            offenders.append(path.relative_to(SRC).as_posix())
    assert offenders == []


def test_every_project_path_route_has_an_authorization_contract():
    from src.main import app

    # These identifiers derive a Project through a child record.  Treating
    # only literal project_id parameters as Project-scoped lets a new Agent,
    # Tool, Session, Binding, Publish, or upload route bypass the manifest.
    derived_project_resource_params = {
        "agent_id",
        "binding_id",
        "connection_id",
        "endpoint_id",
        "job_id",
        "publish_id",
        "run_id",
        "session_id",
        "snapshot_id",
        "table_id",
        "task_id",
        "tool_id",
    }

    actual_routes = {
        (method, route.path)
        for route in app.routes
        if hasattr(route, "methods")
        for method in route.methods
        if method not in {"HEAD", "OPTIONS"}
    }
    registered = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        dependant = getattr(route, "dependant", None)
        if not methods or dependant is None:
            continue
        direct_names = {
            field.name
            for field in (
                list(dependant.path_params)
                + list(dependant.query_params)
                + list(dependant.body_params)
            )
        }
        body_models_have_project = any(
            "project_id"
            in getattr(
                getattr(field.field_info, "annotation", None),
                "model_fields",
                {},
            )
            for field in dependant.body_params
        )
        if (
            "{project_id}" not in route.path
            and "project_id" not in direct_names
            and not body_models_have_project
            and derived_project_resource_params.isdisjoint(direct_names)
        ):
            continue
        registered.update(
            (method, route.path)
            for method in methods
            if method not in {"HEAD", "OPTIONS"}
        )
    manifested = set(PROJECT_ROUTE_AUTHORIZATION)
    assert registered - manifested == set()
    assert manifested - actual_routes == set()


def test_removed_ambiguous_project_access_api_has_no_runtime_callers():
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.is_relative_to(SRC / "tool") or path.is_relative_to(
            SRC / "context_publish"
        ):
            continue
        if "get_by_id_with_access_check" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(SRC).as_posix())
    assert offenders == []


def test_migrations_define_nine_table_target_and_blocking_retirement():
    foundation = (
        BACKEND.parent
        / "supabase"
        / "migrations"
        / "20260712010000_unified_project_authorization.sql"
    ).read_text()
    retirement = (
        BACKEND.parent
        / "supabase"
        / "migrations"
        / "20260712020000_retire_repo_user_permissions.sql"
    ).read_text()
    assert "CREATE TABLE IF NOT EXISTS public.project_workspace_bindings" in foundation
    assert "create_project_with_admin" in foundation
    assert "create_project_workspace_binding" in foundation
    assert "workspace_binding_id" in foundation
    assert "resolve_project_role" in foundation
    assert "get_version_project_write_state" in foundation
    assert "reconcile_workspace_binding_credentials" in foundation
    assert "_repo_scope_reconcile_workspace_bindings" in foundation
    assert "invalid_access_tool_bindings" in foundation
    assert "AND kind = 'cli'" in foundation
    assert "legacy_denied" in retirement
    assert "legacy_scoped" in retirement
    assert "RAISE EXCEPTION" in retirement
    assert "DROP TABLE IF EXISTS public.repo_user_permissions" in retirement


def test_migration_functions_pin_a_hardened_search_path():
    migrations = BACKEND.parent / "supabase" / "migrations"
    for name in (
        "20260712010000_unified_project_authorization.sql",
        "20260712020000_retire_repo_user_permissions.sql",
    ):
        text = (migrations / name).read_text()
        assert "SET search_path = public" not in text
        assert "SET search_path = pg_catalog, public, pg_temp" in text


def test_database_contract_suite_and_ci_gate_are_wired():
    contract = (
        BACKEND.parent / "supabase" / "tests" / "unified_project_authorization_test.sql"
    ).read_text()
    workflow = (
        BACKEND.parent / ".github" / "workflows" / "validate-migrations.yml"
    ).read_text()
    assert "SELECT plan(53);" in contract
    assert contract.count("SELECT throws_ok(") >= 6
    assert "root/non-root identity drift" in contract
    assert "Agent child permissions cannot import a sibling Project tool" in contract
    assert "supabase start" in workflow
    assert "supabase db reset --no-seed" in workflow
    assert "supabase test db" in workflow


def test_openspec_change_is_complete_and_strictly_shaped():
    change = BACKEND / "openspec" / "changes" / "refactor-unified-authorization-boundaries"
    assert (change / "proposal.md").is_file()
    assert (change / "design.md").is_file()
    tasks = (change / "tasks.md").read_text()
    assert "- [ ]" not in tasks
    specs = sorted((change / "specs").glob("*/spec.md"))
    assert {path.parent.name for path in specs} == {
        "project-authorization",
        "project-runtime-readiness",
        "workspace-binding",
    }
    for spec in specs:
        text = spec.read_text()
        assert "## ADDED Requirements" in text
        assert text.count("### Requirement:") >= 1
        assert text.count("#### Scenario:") >= text.count("### Requirement:")
