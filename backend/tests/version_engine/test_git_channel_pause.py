import base64
from types import SimpleNamespace

import pytest

from src.version_engine.entrypoints.git import auth as git_auth
from src.version_engine.entrypoints.git import router as git_router


def _request(headers: dict[str, str] | None = None):
    return SimpleNamespace(headers=headers or {})


@pytest.mark.asyncio
async def test_git_ap_infers_git_remote_channel_without_custom_header(monkeypatch):
    calls = []

    monkeypatch.setattr(
        git_router,
        "resolve_access_point",
        lambda _key: ("project-1", {"agent": "git", "_scope": {"id": "scope-1", "path": ""}}),
    )
    monkeypatch.setattr(
        git_auth,
        "enforce_channel_pause",
        lambda _auth, channel, **_kwargs: calls.append(channel),
    )

    project_id, _auth = await git_router.resolve_git_access_point("access-key", _request())

    assert project_id == "project-1"
    assert calls == ["git_remote"]


@pytest.mark.asyncio
async def test_git_project_auth_infers_git_remote_channel_without_custom_header(monkeypatch):
    calls = []

    class _Credentials:
        def __init__(self, _client):
            pass

        def resolve_git_runtime_credential(self, _token):
            return {
                "credential_id": "credential-1",
                "project_id": "project-1",
                "access_surface_id": "surface-1",
                "scope_id": "scope-root",
                "scope_path": "",
                "scope_exclude": [],
                "scope_is_root": True,
                "workspace_binding_id": "binding-1",
                "effective_mode": "rw",
            }

    monkeypatch.setattr(
        git_auth, "SupabaseClient", lambda: SimpleNamespace(client=SimpleNamespace())
    )
    monkeypatch.setattr(git_auth, "AccessCredentialRepository", _Credentials)
    monkeypatch.setattr(git_auth.settings, "SKIP_AUTH", False)
    monkeypatch.setattr(
        git_auth,
        "enforce_channel_pause",
        lambda _auth, channel, **_kwargs: calls.append(channel),
    )
    token = base64.b64encode(b"alice:secret").decode("ascii")

    auth = await git_auth.resolve_git_project_auth(
        "project-1",
        _request({"authorization": f"Basic {token}"}),
    )

    assert auth["_scope"]["path"] == ""
    assert auth["_runtime_grant"].principal.credential_kind == "git_http_token"
    assert calls == ["git_remote"]


@pytest.mark.asyncio
async def test_canonical_git_route_requires_exact_root_or_scope_target(monkeypatch):
    class _Credentials:
        def __init__(self, _client):
            pass

        def resolve_git_runtime_credential(self, _token):
            return {
                "credential_id": "credential-docs",
                "project_id": "project-1",
                "access_surface_id": "surface-docs",
                "scope_id": "scope-docs",
                "scope_path": "docs",
                "scope_exclude": ["drafts"],
                "scope_is_root": False,
                "workspace_binding_id": None,
                "effective_mode": "r",
            }

    monkeypatch.setattr(
        git_auth, "SupabaseClient", lambda: SimpleNamespace(client=SimpleNamespace())
    )
    monkeypatch.setattr(git_auth, "AccessCredentialRepository", _Credentials)
    monkeypatch.setattr(git_auth.settings, "SKIP_AUTH", False)
    monkeypatch.setattr(git_auth, "enforce_channel_pause", lambda *_a, **_k: None)
    token = base64.b64encode(b"x-puppyone-token:git_secret").decode("ascii")
    request = _request({"authorization": f"Basic {token}"})

    with pytest.raises(Exception) as root_error:
        await git_auth.resolve_git_project_auth("project-1", request)
    assert root_error.value.status_code == 401
    assert "Basic realm" in root_error.value.headers["WWW-Authenticate"]

    auth = await git_auth.resolve_git_scope_auth(
        "project-1", "scope-docs", request
    )
    assert auth["_scope"] == {
        "id": "scope-docs",
        "path": "docs",
        "exclude": ["drafts"],
        "mode": "r",
    }

    with pytest.raises(Exception) as wrong_scope_error:
        await git_auth.resolve_git_scope_auth(
            "project-1", "scope-other", request
        )
    assert wrong_scope_error.value.status_code == 401
