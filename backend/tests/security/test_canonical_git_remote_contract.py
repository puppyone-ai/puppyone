import json
from pathlib import Path

import pytest

from src.exceptions import AppException, ErrorCode
from src.platform.repository_target.protocol import require_repository_target_contract
from src.repo.scope_repository import _row_to_scope
from src.platform.repository_target.schemas import (
    ProjectRootTargetSchema,
    ScopeTargetSchema,
)

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    ROOT
    / "supabase/migrations/20260715000000_project_owned_repository_targets_contract_cutover.sql"
)


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_repository_scope_rows_are_non_root_path_boundaries_only():
    scope = _row_to_scope(
        {
            "id": "scope-docs",
            "project_id": "project-1",
            "name": "Docs",
            "path": "docs",
            "exclude": ["docs/private"],
            "max_mode": "r",
        }
    )

    assert scope.path == "docs"
    assert scope.max_mode == "r"
    assert not hasattr(scope, "is_root")
    assert not hasattr(scope, "access_key")


def test_cross_client_repository_target_v2_fixture_matches_wire_models():
    fixture = json.loads(
        (ROOT / "contracts/repository-target-v2.json").read_text(encoding="utf-8")
    )

    assert fixture["version"] == 2
    assert fixture["request_header"] == {
        "name": "X-PuppyOne-Repository-Contract",
        "value": "2",
    }
    assert fixture["errors"] == {
        "client_upgrade_required": ErrorCode.CLIENT_UPGRADE_REQUIRED.value,
        "target_kind_mismatch": ErrorCode.TARGET_KIND_MISMATCH.value,
        "scope_not_found": ErrorCode.SCOPE_NOT_FOUND.value,
        "repository_storage_unavailable": ErrorCode.REPOSITORY_STORAGE_UNAVAILABLE.value,
    }
    assert fixture["association_rows"] == {
        "project_root": {"project_id": "project-1", "scope_id": None},
        "scope": {"project_id": "project-1", "scope_id": "scope-docs"},
    }
    assert ProjectRootTargetSchema.model_validate(
        fixture["targets"]["project_root"]
    ).model_dump() == fixture["targets"]["project_root"]
    assert ScopeTargetSchema.model_validate(
        fixture["targets"]["scope"]
    ).model_dump() == fixture["targets"]["scope"]


@pytest.mark.parametrize("version", [None, 1, 3])
def test_repository_target_contract_rejects_missing_or_wrong_version(version):
    with pytest.raises(AppException) as caught:
        require_repository_target_contract(version)

    assert caught.value.status_code == 426
    assert caught.value.code is ErrorCode.CLIENT_UPGRADE_REQUIRED
    assert caught.value.details == {"required_repository_contract": 2}


def test_repository_target_contract_accepts_exact_v2():
    assert require_repository_target_contract(2) == 2


def test_cutover_makes_project_the_root_target_and_removes_dual_identity():
    sql = _sql()

    assert "DELETE FROM public.repo_scopes WHERE is_root = true" in sql
    assert "ALTER TABLE public.repo_scopes RENAME TO repository_scopes" in sql
    assert "RENAME COLUMN mode TO max_mode" in sql
    assert "DROP COLUMN is_root" in sql
    assert "DROP COLUMN binding_kind" in sql
    assert "path <> ''" in sql
    assert "NULLS NOT DISTINCT" in sql


def test_cutover_preflight_blocks_ambiguous_or_dangling_legacy_geometry():
    sql = _sql()

    assert "DATA_MIGRATION_REQUIRED:20260715_project_owned_repository_targets_preflight" in sql
    assert "summary ->> 'artifact_checksum'" in sql
    assert "Projects lack exactly one legacy root" in sql
    assert "malformed legacy Scope rows" in sql
    assert "invalid Access Surface targets" in sql
    assert "invalid Workspace Binding targets" in sql
    assert "invalid credential target chains" in sql


def test_runtime_resolver_is_hash_only_and_returns_explicit_target_facts():
    resolver = _sql().split(
        "CREATE FUNCTION public.resolve_git_runtime_credential", 1
    )[1]

    assert "p_key_hash text" in resolver
    assert "raw_token" not in resolver
    assert "SECURITY DEFINER" in resolver
    assert "c.key_hash = p_key_hash" in resolver
    assert "c.credential_type = 'git_http_token'" in resolver
    assert "target_kind text" in resolver
    assert "path_prefix text" in resolver
    assert "target_max_mode text" in resolver
    assert "CASE WHEN s.scope_id IS NULL THEN 'project_root' ELSE 'scope' END" in resolver
    assert "s.scope_id IS NULL OR rs.id IS NOT NULL" in resolver
    assert "REVOKE ALL ON FUNCTION public.resolve_git_runtime_credential(text)" in resolver


def test_project_root_and_scope_binding_use_one_nullable_fk_without_kind_flag():
    sql = _sql()
    creation = sql.split(
        "CREATE FUNCTION public.create_project_workspace_git_binding", 1
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.rotate_project_workspace_binding_git_credential",
        1,
    )[0]

    assert "p_scope_id text" in creation
    assert "scope_id IS NOT DISTINCT FROM p_scope_id" in creation
    assert "p_scope_id IS NULL" in creation
    assert "'kind', 'project_root'" in creation
    assert "'kind', 'scope'" in creation
    assert "p_binding_kind" not in creation
    assert "ensure_repository_target_access_surfaces" in creation


def test_explicit_target_enable_is_atomic_and_concurrency_safe():
    sql = _sql()
    enable = sql.split(
        "CREATE OR REPLACE FUNCTION public.ensure_repository_target_access_surfaces",
        1,
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_git_http_token",
        1,
    )[0]

    assert "pg_advisory_xact_lock" in enable
    assert "p_scope_id IS NOT NULL" in enable
    assert "ON CONFLICT DO NOTHING" in enable
    assert "'git_remote'" in enable
    assert "'cli'" in enable
    assert "RETURNS SETOF public.access_surfaces" in enable


def test_shared_rotation_accepts_project_root_without_a_scope_join():
    sql = _sql()
    rotation = sql.split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_git_http_token", 1
    )[1].split(
        "CREATE FUNCTION public.create_project_workspace_git_binding", 1
    )[0]

    assert "s.scope_id IS NULL OR rs.id IS NOT NULL" in rotation
    assert "p_grant_mode = 'r' OR s.scope_id IS NULL OR rs.max_mode = 'rw'" in rotation
    assert "workspace_binding_id IS NULL" in rotation
    assert "credential_lifecycle = 'shared'" in rotation


def test_application_uses_git_specific_binding_rpcs():
    repository = (
        ROOT / "backend/src/platform/workspace_binding/repository.py"
    ).read_text(encoding="utf-8")

    assert '"create_project_workspace_git_binding"' in repository
    assert '"rotate_project_workspace_binding_git_credential"' in repository
    assert '"revoke_project_workspace_binding_git_credential"' in repository


def test_canonical_context_is_not_a_legacy_confirmation_candidate():
    schemas = (
        ROOT / "backend/src/platform/workspace_binding/schemas.py"
    ).read_text(encoding="utf-8")
    router = (
        ROOT / "backend/src/platform/workspace_binding/router.py"
    ).read_text(encoding="utf-8")

    canonical = schemas.split("class CanonicalRemoteContextOut", 1)[1].split(
        "class WorkspaceBindingCredentialOut", 1
    )[0]
    assert "target: RepositoryTargetSchema" in canonical
    assert "requires_confirmation" not in canonical
    assert "response_model=ApiResponse[CanonicalRemoteContextOut]" in router


def test_canonical_and_legacy_routes_converge_after_target_resolution():
    router = (
        ROOT / "backend/src/version_engine/entrypoints/git/router.py"
    ).read_text(encoding="utf-8")

    assert "class _ResolvedGitTarget" in router
    assert "_git_info_refs_for_target(" in router
    assert "_git_rebuild_for_target(" in router
    assert "_git_receive_pack_for_target(" in router
    assert "_git_upload_pack_for_target(" in router
    assert '@router.get("/ap/{access_key}.git/info/refs")' in router
    assert '@router.get("/{project_id}/scopes/{scope_id}.git/info/refs")' in router


def test_web_git_health_uses_human_control_plane_not_git_runtime_routes():
    api = (ROOT / "frontend/lib/gitHealthApi.ts").read_text(encoding="utf-8")

    assert "/api/v1/projects/${encodeURIComponent(projectId)}/git-view/health" in api
    assert (
        "/api/v1/projects/${encodeURIComponent(projectId)}/git-view/rebuild-cache"
        in api
    )
    assert "`/git/${encodeURIComponent(projectId)}" not in api
    assert "getGitScopeHealth" not in api
    assert "rebuildGitScopeCache" not in api


def test_web_one_time_git_credential_is_bound_to_displayed_target_and_mode():
    panel = (
        ROOT
        / "frontend/app/(main)/projects/[projectId]/data/components/access-points/"
        "connect-methods/GitCredentialIssuePanel.tsx"
    ).read_text(encoding="utf-8")

    assert "GIT_CREDENTIAL_PATTERN" in panel
    assert "result.git_username !== 'x-puppyone-token'" in panel
    assert "result.grant_mode !== grantMode" in panel
    assert "!isSameCanonicalGitUrl(gitUrl, result.git_url)" in panel


@pytest.mark.parametrize(
    "forbidden",
    [
        "BindingKind",
        "RepoScopeRepository",
        "binding_kind",
        "root_scope_id",
        "is_root",
        '"_scope"',
    ],
)
def test_new_runtime_source_does_not_reintroduce_legacy_identity_types(forbidden):
    backend_source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "backend/src").rglob("*.py")
    )
    frontend_source = "\n".join(
        path.read_text(encoding="utf-8")
        for root in (ROOT / "frontend", ROOT / "packages/cloud-core/src")
        for path in root.rglob("*.ts*")
        if "node_modules" not in path.parts
    )
    assert forbidden not in backend_source
    assert forbidden not in frontend_source
