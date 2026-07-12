"""Regression contracts for the credential-retirement deployment sequence."""

from __future__ import annotations

from pathlib import Path

from scripts.backfill_scope_access_key_hash import _legacy_columns_have_been_retired

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_credential_sql_migrations_do_not_name_an_application_language_or_script() -> None:
    for migration_name in (
        "20260711010000_harden_agent_sandbox_credentials.sql",
        "20260711070000_move_scope_credentials_to_access_credentials.sql",
    ):
        migration = (REPO_ROOT / "supabase/migrations" / migration_name).read_text(
            encoding="utf-8"
        ).lower()
        assert "python" not in migration
        assert ".py" not in migration
        assert "scripts/" not in migration


def test_credential_backfills_precede_the_destructive_migration_in_ci() -> None:
    """CI must not let db push reach 20260711070000 before the HMAC backfill."""
    for workflow_name, environment in (
        ("migrate-staging.yml", "STAGING"),
        ("migrate-production.yml", "PRODUCTION"),
    ):
        workflow = (REPO_ROOT / ".github/workflows" / workflow_name).read_text(
            encoding="utf-8"
        )
        scope_backfill = "uv run python -m scripts.backfill_scope_access_key_hash --apply"
        surface_backfill = "uv run python -m scripts.backfill_surface_credentials --apply"
        dry_run = "supabase db push --dry-run"

        assert scope_backfill in workflow
        assert surface_backfill in workflow
        assert workflow.index(scope_backfill) < workflow.index(dry_run)
        assert workflow.index(surface_backfill) < workflow.index(dry_run)
        assert f"{environment}_SUPABASE_SERVICE_ROLE_KEY" in workflow
        assert f"{environment}_ACCESS_CREDENTIAL_HASH_SECRET" in workflow
        assert "ContextBase-access-credential-development-secret" in workflow
        assert "${#ACCESS_CREDENTIAL_HASH_SECRET}" not in workflow


def test_scope_backfill_only_skips_the_expected_postgrest_retired_column_error() -> None:
    class PostgrestMissingColumn(Exception):
        code = "PGRST204"

    class PostgresMissingColumn(Exception):
        code = "42703"

    assert _legacy_columns_have_been_retired(
        PostgrestMissingColumn(
            "Could not find the 'access_key' column of 'repo_scopes' in the schema cache"
        )
    )
    assert _legacy_columns_have_been_retired(
        PostgresMissingColumn("column repo_scopes.access_key does not exist")
    )
    assert not _legacy_columns_have_been_retired(
        PostgrestMissingColumn("Could not find the 'other_column' column of 'repo_scopes'")
    )
    assert not _legacy_columns_have_been_retired(Exception("network unavailable"))
