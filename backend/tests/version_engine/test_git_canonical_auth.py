import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.platform.authorization.models import RuntimeMode
from src.version_engine.entrypoints.git import auth as git_auth
from src.version_engine.entrypoints.git import router as git_router
from src.version_engine.entrypoints.git.locator import (
    GitRemoteLocator,
    canonical_git_path,
    canonical_git_url,
    parse_canonical_git_url,
)


def _request(authorization: str = "", *, raw_path: bytes | None = None):
    headers = {"authorization": authorization} if authorization else {}
    scope = {"raw_path": raw_path} if raw_path is not None else {}
    return SimpleNamespace(headers=headers, scope=scope)


def _basic(token: str, username: str = "x-puppyone-token") -> str:
    encoded = base64.b64encode(f"{username}:{token}".encode()).decode("ascii")
    return f"Basic {encoded}"


def _resolved_root(**overrides):
    result = {
        "credential_id": "credential-1",
        "project_id": "project-1",
        "access_surface_id": "surface-1",
        "scope_id": "scope-root",
        "scope_path": "",
        "scope_exclude": [],
        "scope_is_root": True,
        "workspace_binding_id": None,
        "effective_mode": "rw",
    }
    result.update(overrides)
    return result


def _install_resolver(monkeypatch, result):
    class _Credentials:
        def __init__(self, _client):
            pass

        def resolve_git_runtime_credential(self, token):
            assert token == "git_secret"
            return result

    monkeypatch.setattr(
        git_auth, "SupabaseClient", lambda: SimpleNamespace(client=object())
    )
    monkeypatch.setattr(git_auth, "AccessCredentialRepository", _Credentials)
    monkeypatch.setattr(git_auth.settings, "SKIP_AUTH", False)
    monkeypatch.setattr(git_auth, "enforce_channel_pause", lambda *_a, **_k: None)


def _assert_uniform_unauthorized(error: HTTPException) -> None:
    assert error.status_code == 401
    assert error.detail == "Invalid Git credentials"
    assert error.headers == {"WWW-Authenticate": 'Basic realm="PuppyOne Git"'}


def test_canonical_git_locator_is_stable_and_non_secret():
    assert canonical_git_path("project_1") == "/git/project_1.git"
    assert canonical_git_path("project_1", "scope-2") == (
        "/git/project_1/scopes/scope-2.git"
    )
    assert canonical_git_url("HTTPS://Cloud.Example/", "project_1", "scope-2") == (
        "https://cloud.example/git/project_1/scopes/scope-2.git"
    )
    assert parse_canonical_git_url("https://cloud.example/git/project_1.git") == (
        GitRemoteLocator(project_id="project_1")
    )
    assert parse_canonical_git_url(
        "https://cloud.example/git/project_1/scopes/scope-2.git"
    ) == GitRemoteLocator(project_id="project_1", scope_id="scope-2")


@pytest.mark.parametrize(
    "remote",
    [
        "https://user:secret@cloud.example/git/project-1.git",
        "https://cloud.example/git/project-1.git?token=secret",
        "https://cloud.example/git/project-1.git#secret",
        "https://cloud.example/git/project%2D1.git",
        "https://cloud.example/git/project-1/scopes/scope%2Fchild.git",
        "https://cloud.example/git/project-1/scopes/scope.git/extra",
        "https://cloud.example/git/ap/legacy-secret.git",
    ],
)
def test_canonical_git_locator_parser_rejects_ambiguous_or_secret_forms(remote):
    assert parse_canonical_git_url(remote) is None


@pytest.mark.asyncio
async def test_percent_encoded_route_identity_fails_before_resolution(monkeypatch):
    _install_resolver(monkeypatch, _resolved_root())

    with pytest.raises(HTTPException) as caught:
        await git_auth.resolve_git_project_auth(
            "project-1",
            _request(
                _basic("git_secret"),
                raw_path=b"/git/project%2D1.git/info/refs",
            ),
        )

    _assert_uniform_unauthorized(caught.value)


@pytest.mark.asyncio
async def test_canonical_git_auth_accepts_bearer_and_builds_readonly_grant(monkeypatch):
    _install_resolver(
        monkeypatch,
        _resolved_root(effective_mode="r"),
    )

    auth = await git_auth.resolve_git_project_auth(
        "project-1",
        _request("Bearer git_secret"),
    )

    assert auth["_runtime_grant"].mode is RuntimeMode.READ
    assert auth["_runtime_grant"].project_id == "project-1"
    assert auth["_scope"]["path"] == ""

    detail = git_router._git_audit_detail(
        auth=auth,
        entry_point="project_git_remote",
        actor="client-claimed@example.com",
        project_id="project-1",
    )
    assert detail["actor"] == "client-claimed@example.com"
    assert detail["runtime_principal_id"] == "credential-1"
    assert detail["runtime_credential_kind"] == "git_http_token"
    assert detail["access_surface_id"] == "surface-1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "authorization",
    ["", "Basic not-base64", _basic("")],
)
async def test_canonical_git_auth_missing_or_malformed_secret_is_uniform(
    monkeypatch, authorization
):
    monkeypatch.setattr(git_auth.settings, "SKIP_AUTH", False)

    with pytest.raises(HTTPException) as caught:
        await git_auth.resolve_git_project_auth(
            "project-1", _request(authorization)
        )

    _assert_uniform_unauthorized(caught.value)


@pytest.mark.asyncio
async def test_canonical_git_auth_cross_project_mismatch_is_uniform(monkeypatch):
    _install_resolver(monkeypatch, _resolved_root())

    with pytest.raises(HTTPException) as caught:
        await git_auth.resolve_git_project_auth(
            "project-2", _request(_basic("git_secret"))
        )

    _assert_uniform_unauthorized(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"credential_id": ""},
        {"access_surface_id": None},
        {"scope_id": "scope/invalid"},
        {"scope_is_root": "true"},
        {"scope_path": "/unexpected/"},
        {"scope_exclude": "drafts"},
        {"scope_exclude": [1]},
        {"effective_mode": "admin"},
    ],
)
async def test_canonical_git_auth_malformed_runtime_facts_fail_closed(
    monkeypatch, overrides
):
    _install_resolver(monkeypatch, _resolved_root(**overrides))

    with pytest.raises(HTTPException) as caught:
        await git_auth.resolve_git_project_auth(
            "project-1", _request(_basic("git_secret"))
        )

    _assert_uniform_unauthorized(caught.value)


@pytest.mark.asyncio
async def test_skip_auth_bypasses_secret_check_but_not_scope_geometry(monkeypatch):
    class _Scopes:
        def __init__(self, _client):
            pass

        def get(self, scope_id):
            assert scope_id == "scope-docs"
            return SimpleNamespace(
                id="scope-docs",
                project_id="project-1",
                path="docs",
                exclude=["drafts"],
                mode="r",
                is_root=False,
            )

        def get_root_scope(self, _project_id):
            raise AssertionError("scoped locator must not resolve the root")

    monkeypatch.setattr(git_auth.settings, "SKIP_AUTH", True)
    monkeypatch.setattr(
        git_auth, "SupabaseClient", lambda: SimpleNamespace(client=object())
    )
    monkeypatch.setattr(git_auth, "RepoScopeRepository", _Scopes)
    monkeypatch.setattr(git_auth, "enforce_channel_pause", lambda *_a, **_k: None)

    auth = await git_auth.resolve_git_scope_auth(
        "project-1",
        "scope-docs",
        _request(_basic("dev-only-token")),
    )

    assert auth["_scope"] == {
        "id": "scope-docs",
        "path": "docs",
        "exclude": ["drafts"],
        "mode": "r",
    }


@pytest.mark.asyncio
async def test_legacy_route_telemetry_never_contains_secret_or_raw_target_ids(
    monkeypatch,
):
    secret = "legacy_super_secret"
    messages: list[str] = []

    async def _resolve(access_key, _request_value):
        assert access_key == secret
        return "project-sensitive-id", {"_scope": {"id": "scope-sensitive-id"}}

    monkeypatch.setattr(git_router, "resolve_git_access_point", _resolve)
    monkeypatch.setattr(git_router, "log_info", messages.append)

    target = await git_router._resolve_access_point_target(secret, _request())

    assert target.entry_point == "access_key_git_remote"
    assert len(messages) == 1
    assert secret not in messages[0]
    assert "project-sensitive-id" not in messages[0]
    assert "scope-sensitive-id" not in messages[0]
    assert "project_ref=" in messages[0]
    assert "scope_ref=" in messages[0]
