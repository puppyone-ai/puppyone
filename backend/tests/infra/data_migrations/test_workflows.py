from __future__ import annotations

from pathlib import Path

import yaml

REPOSITORY = Path(__file__).resolve().parents[4]
WORKFLOWS = REPOSITORY / ".github" / "workflows"


def test_database_workflow_yaml_is_parseable() -> None:
    names = (
        "_schema-deploy.yml",
        "migrate-staging.yml",
        "migrate-production.yml",
        "_data-migration.yml",
        "data-migration.yml",
        "validate-migrations.yml",
        "main-release-gate.yml",
    )
    for name in names:
        parsed = yaml.safe_load((WORKFLOWS / name).read_text())
        assert isinstance(parsed, dict), name
        assert "jobs" in parsed, name


def test_schema_and_data_jobs_share_serialized_environment_boundary() -> None:
    schema = (WORKFLOWS / "_schema-deploy.yml").read_text()
    data = (WORKFLOWS / "_data-migration.yml").read_text()
    for workflow in (schema, data):
        assert "environment: ${{ inputs.environment }}" in workflow
        assert "group: database-${{ inputs.environment }}" in workflow
        assert "cancel-in-progress: false" in workflow
        assert "permissions:\n  contents: read" in workflow


def test_hosted_workflows_bind_connection_to_protected_project() -> None:
    schema = (WORKFLOWS / "_schema-deploy.yml").read_text()
    data = (WORKFLOWS / "_data-migration.yml").read_text()
    assert "db.${SUPABASE_PROJECT_ID}.supabase.co:5432" in schema
    assert "pooler.supabase.com:5432" in schema
    assert "SUPABASE_PROJECT_ID:?supabase_project_id is required" in data
    assert "SUPABASE_URL=https://${SUPABASE_PROJECT_ID}.supabase.co" in data
    assert "secrets.DATABASE_URL" in schema
    assert "secrets.DATABASE_URL" in data


def test_psql_receives_connection_uri_explicitly() -> None:
    schema = (WORKFLOWS / "_schema-deploy.yml").read_text()
    validation = (WORKFLOWS / "validate-migrations.yml").read_text()

    assert "PGDATABASE:" not in schema
    assert "PGDATABASE:" not in validation
    assert 'psql "$DATABASE_URL"' in schema
    assert validation.count('psql "$DATABASE_URL"') == 4


def test_hosted_schema_smoke_has_no_pgtap_runtime_dependency() -> None:
    smoke_path = REPOSITORY / "supabase" / "tests" / "_support" / "schema_contracts.sql"
    smoke = smoke_path.read_text()
    adapter = (REPOSITORY / "supabase" / "tests" / "smoke_test_triggers.sql").read_text()
    deploy = (WORKFLOWS / "_schema-deploy.yml").read_text()

    # The hosted staging/production projects are not required to install the
    # pgTAP test extension. Deployment smoke checks fail through SQL exceptions
    # and therefore must remain executable by plain psql.
    assert "SELECT plan(" not in smoke
    assert "SELECT pass(" not in smoke
    assert "finish()" not in smoke
    assert r"\ir _support/schema_contracts.sql" in adapter
    assert "-f supabase/tests/_support/schema_contracts.sql" in deploy
    assert smoke_path not in (REPOSITORY / "supabase" / "tests").glob("*.sql")


def test_ordered_data_migration_fixtures_are_not_auto_discovered_by_supabase() -> None:
    supabase_tests = REPOSITORY / "supabase" / "tests"
    migration = (
        REPOSITORY
        / "supabase"
        / "data_migrations"
        / "20260712_repo_user_permissions_to_project_members"
    )
    validation = (WORKFLOWS / "validate-migrations.yml").read_text()

    assert not list(supabase_tests.glob("*fixture*.sql"))
    assert not list(supabase_tests.glob("*assert*.sql"))
    assert (migration / "test_fixture.sql").is_file()
    assert (migration / "test_assert.sql").is_file()
    assert "test_fixture.sql" in validation
    assert "test_assert.sql" in validation


def test_production_data_work_cannot_run_from_untrusted_ref() -> None:
    dispatcher = (WORKFLOWS / "data-migration.yml").read_text()
    assert '"refs/heads/qubits"' in dispatcher
    assert '"refs/heads/main"' in dispatcher
    assert "production_staging_evidence" in dispatcher
    assert "environment: staging" in dispatcher
    assert "operation: verify" in dispatcher
    assert "needs.production_staging_evidence.result == 'success'" in dispatcher


def test_reusable_database_workflows_receive_protected_secrets() -> None:
    staging = (WORKFLOWS / "migrate-staging.yml").read_text()
    production = (WORKFLOWS / "migrate-production.yml").read_text()
    dispatcher = (WORKFLOWS / "data-migration.yml").read_text()

    # GitHub does not pass secrets to reusable workflows automatically. Every
    # direct caller must cross that boundary explicitly; the called job then
    # selects the protected staging/production Environment.
    assert staging.count("secrets: inherit") == 1
    assert production.count("secrets: inherit") == 1
    assert dispatcher.count("secrets: inherit") == 3


def test_needs_expressions_use_identifier_safe_job_ids() -> None:
    dispatcher = (WORKFLOWS / "data-migration.yml").read_text()
    for line in dispatcher.splitlines():
        if "needs." in line:
            reference = line.split("needs.", 1)[1].split(".", 1)[0]
            assert "-" not in reference


def test_pull_request_validation_never_receives_remote_database_secrets() -> None:
    validation = (WORKFLOWS / "validate-migrations.yml").read_text()
    assert "SUPABASE_ACCESS_TOKEN" not in validation
    assert "STAGING_DB_PASSWORD" not in validation
    assert "PRODUCTION_DB_PASSWORD" not in validation
    assert "db push --dry-run" not in validation


def test_pull_request_database_gate_always_publishes_a_stable_result() -> None:
    workflow = (WORKFLOWS / "validate-migrations.yml").read_text()

    assert "pull_request:\n    paths:" not in workflow
    assert "database_change_scope:" in workflow
    assert "database_validation_result:" in workflow
    assert "if: always()" in workflow
    assert "No database release paths changed." in workflow
    assert "tests/security/test_unified_authorization_architecture.py" in workflow


def test_workflow_dispatch_values_are_not_interpolated_into_shell() -> None:
    reusable = (WORKFLOWS / "_data-migration.yml").read_text()
    dispatcher = (WORKFLOWS / "data-migration.yml").read_text()
    assert 'plan "${{ inputs.migration_id }}"' not in reusable
    assert 'run "${{ inputs.migration_id }}"' not in reusable
    assert 'verify "${{ inputs.migration_id }}"' not in reusable
    assert 'plan "$MIGRATION_ID"' in reusable
    assert '"${{ inputs.environment }}" = ' not in dispatcher


def test_main_gate_requires_exact_schema_and_contract_verification() -> None:
    gate = (WORKFLOWS / "main-release-gate.yml").read_text()
    assert "pr.head.sha" in gate
    assert "latestOwnerReview?.commit_id === pr.head.sha" in gate
    assert "labeled, unlabeled" in gate
    assert "migrate-staging.yml" in gate
    assert "requires-data-migration" in gate
    assert "stagingVerified" in gate
    assert "productionVerified" in gate
    assert "pr.base.sha" in gate
    assert "['added', 'renamed'].includes(file.status)" in gate


def test_every_qubits_head_receives_an_exact_schema_attestation() -> None:
    staging = (WORKFLOWS / "migrate-staging.yml").read_text()
    assert "branches:\n      - qubits" in staging
    assert "    paths:" not in staging


def test_database_workflow_third_party_actions_are_sha_pinned() -> None:
    for name in (
        "_schema-deploy.yml",
        "_data-migration.yml",
        "validate-migrations.yml",
        "main-release-gate.yml",
    ):
        text = (WORKFLOWS / name).read_text()
        for line in text.splitlines():
            if "uses:" not in line or "./.github/workflows/" in line:
                continue
            reference = line.split("uses:", 1)[1].split("#", 1)[0].strip()
            assert "@" in reference, (name, line)
            revision = reference.rsplit("@", 1)[1]
            assert len(revision) == 40, (name, line)
            assert all(character in "0123456789abcdef" for character in revision)
