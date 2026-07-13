from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from src.repo.scope_repository import _row_to_scope
from src.repo.scope_router import regenerate_scope_key, update_scope

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "supabase/migrations/20260713020000_canonical_git_remote_contract.sql"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_scope_reads_do_not_require_retired_plaintext_access_key_column():
    scope = _row_to_scope(
        {
            "id": "scope-root",
            "project_id": "project-1",
            "name": "Root",
            "path": "",
            "exclude": [],
            "mode": "rw",
            "is_root": True,
        }
    )

    assert scope.access_key == ""
    assert scope.access_key_revoked_at is None


class _ScopeMutationService:
    def __init__(self):
        self.scope = _row_to_scope(
            {
                "id": "scope-root",
                "project_id": "project-1",
                "name": "Root",
                "path": "",
                "exclude": [],
                "mode": "rw",
                "is_root": True,
                "created_at": datetime(2026, 7, 13, tzinfo=UTC),
                "updated_at": datetime(2026, 7, 13, tzinfo=UTC),
            }
        )

    def get(self, scope_id: str):
        return self.scope if scope_id == self.scope.id else None

    def regenerate_access_key(self, scope_id: str):
        return "cli_one-time-secret" if scope_id == self.scope.id else None

    def update(self, scope_id: str, **_changes):
        return self.get(scope_id)


def _authorized_project():
    return SimpleNamespace(project=SimpleNamespace(id="project-1"))


def test_scope_key_regeneration_reveals_the_just_minted_key_once():
    response = regenerate_scope_key(
        "scope-root",
        authorized=_authorized_project(),
        service=_ScopeMutationService(),
    )

    assert response.data.access_key == "cli_one-time-secret"


def test_scope_metadata_update_does_not_reveal_machine_credentials():
    response = update_scope(
        "scope-root",
        payload=SimpleNamespace(name="Root", exclude=None, mode=None),
        authorized=_authorized_project(),
        service=_ScopeMutationService(),
    )

    assert response.data.access_key is None


def test_dashboard_discovery_cannot_rehydrate_or_replay_scope_secrets():
    dashboard = (
        ROOT / "backend/src/platform/project/dashboard_router.py"
    ).read_text(encoding="utf-8")

    assert "access_key=None" in dashboard
    assert 'scope.get("access_key")' not in dashboard
    assert 'cfg.get("access_key")' not in dashboard
    assert "credential_hint=credential_hint" in dashboard


def test_git_grant_mode_is_constrained_and_integrity_is_triggered():
    sql = _sql()

    assert "ADD COLUMN IF NOT EXISTS grant_mode text" in sql
    assert "ALTER COLUMN grant_mode SET NOT NULL" in sql
    assert "CHECK (grant_mode IN ('r', 'rw'))" in sql
    assert "ADD COLUMN IF NOT EXISTS credential_lifecycle text" in sql
    assert "ALTER COLUMN credential_lifecycle SET NOT NULL" in sql
    assert "credential_lifecycle IN ('shared', 'session', 'binding')" in sql
    assert "session credential requires an expiry" in sql
    assert "CREATE TRIGGER trg_validate_access_surface_credential" in sql
    assert "Git credential requires a git_remote surface" in sql
    assert "active credential requires an active surface" in sql
    assert "credential/workspace binding mismatch" in sql


def test_shared_read_and_readwrite_git_rotation_domains_are_independent():
    sql = _sql()
    rotation = sql.split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_git_http_token", 1
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.create_project_workspace_git_binding", 1
    )[0]

    assert "FOR UPDATE OF s" in rotation
    assert "AND grant_mode = p_grant_mode" in rotation
    assert "workspace_binding_id IS NULL" in rotation
    assert "credential_lifecycle = 'shared'" in rotation
    assert "'shared'" in rotation


def test_shared_rotation_cannot_revoke_short_lived_session_credentials():
    sql = _sql()
    git_rotation = sql.split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_git_http_token", 1
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.create_project_workspace_git_binding", 1
    )[0]
    bearer_rotation = sql.split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_bearer_token", 1
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.rotate_access_surface_git_http_token", 1
    )[0]

    for rotation in (git_rotation, bearer_rotation):
        assert "credential_lifecycle = 'shared'" in rotation
        assert "credential_lifecycle,\n" in rotation
        assert "'shared'" in rotation
    assert "credential_lifecycle = 'session'" not in git_rotation
    assert "credential_lifecycle = 'session'" not in bearer_rotation


def test_runtime_resolver_is_hash_only_fail_closed_and_narrows_all_modes():
    sql = _sql()
    resolver = sql.split(
        "CREATE OR REPLACE FUNCTION public.resolve_git_runtime_credential", 1
    )[1]

    assert "p_key_hash text" in resolver
    assert "raw_token" not in resolver
    assert "SECURITY DEFINER" in resolver
    assert "c.key_hash = p_key_hash" in resolver
    assert "c.credential_type = 'git_http_token'" in resolver
    assert "s.kind = 'git_remote'" in resolver
    assert "c.grant_mode <> 'rw'" in resolver
    assert "rs.mode <> 'rw'" in resolver
    assert "COALESCE(s.config ->> 'mode', 'rw') <> 'rw'" in resolver
    assert "COALESCE(b.mode, 'rw') <> 'rw'" in resolver
    assert "pr.effective_role = 'viewer'" in resolver
    assert "b.status = 'active'" in resolver
    assert "c.expires_at > now()" in resolver
    assert "REVOKE ALL ON FUNCTION public.resolve_git_runtime_credential(text)" in resolver
    assert "TO service_role" in resolver


def test_expand_migration_preserves_legacy_binding_rpc_signatures():
    sql = _sql()

    assert "CREATE OR REPLACE FUNCTION public.create_project_workspace_git_binding(" in sql
    assert (
        "CREATE OR REPLACE FUNCTION "
        "public.rotate_project_workspace_binding_git_credential(" in sql
    )
    assert (
        "CREATE OR REPLACE FUNCTION "
        "public.revoke_project_workspace_binding_git_credential(" in sql
    )
    assert "CREATE OR REPLACE FUNCTION public.create_project_workspace_binding(" not in sql
    assert (
        "CREATE OR REPLACE FUNCTION "
        "public.rotate_project_workspace_binding_credential(" not in sql
    )
    assert "kind = 'git_remote'" in sql
    assert "credential_type', 'git_http_token'" in sql


def test_binding_rotation_is_independent_and_upgrades_legacy_binding_geometry():
    sql = _sql()
    rotation = sql.split(
        "CREATE OR REPLACE FUNCTION "
        "public.rotate_project_workspace_binding_git_credential", 1
    )[1].split(
        "CREATE OR REPLACE FUNCTION public.resolve_git_runtime_credential", 1
    )[0]

    assert "FROM public.access_surfaces s" in rotation
    assert "s.scope_id = selected_binding.scope_id" in rotation
    assert "s.kind = 'git_remote'" in rotation
    assert "WHERE workspace_binding_id = p_binding_id AND status = 'active'" in rotation
    assert "'git_http_token'" in rotation
    assert "'binding'" in rotation
    assert "c.credential_type = 'bearer_token'" not in rotation


def test_application_uses_git_specific_expand_phase_rpcs():
    repository = (
        ROOT / "backend/src/platform/workspace_binding/repository.py"
    ).read_text(encoding="utf-8")

    assert '"create_project_workspace_git_binding"' in repository
    assert '"rotate_project_workspace_binding_git_credential"' in repository
    assert '"revoke_project_workspace_binding_git_credential"' in repository


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


def test_web_one_time_git_credential_is_bound_to_the_displayed_locator_and_mode():
    panel = (
        ROOT
        / "frontend/app/(main)/projects/[projectId]/data/components/access-points/"
        "connect-methods/GitCredentialIssuePanel.tsx"
    ).read_text(encoding="utf-8")

    assert "GIT_CREDENTIAL_PATTERN" in panel
    assert "result.git_username !== 'x-puppyone-token'" in panel
    assert "result.grant_mode !== grantMode" in panel
    assert "!isSameCanonicalGitUrl(gitUrl, result.git_url)" in panel
