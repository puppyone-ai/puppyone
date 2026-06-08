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
        git_router,
        "enforce_channel_pause",
        lambda _auth, channel, **_kwargs: calls.append(channel),
    )

    project_id, _auth = await git_router.resolve_git_access_point("access-key", _request())

    assert project_id == "project-1"
    assert calls == ["git_remote"]


@pytest.mark.asyncio
async def test_git_project_auth_infers_git_remote_channel_without_custom_header(monkeypatch):
    calls = []

    class _Authenticator:
        def __init__(self, _supabase):
            pass

        def authenticate(self, _token, _project_id, _user_identity):
            return {"agent": "user:test", "_scope": {"id": "scope-1", "path": "docs"}}

    monkeypatch.setattr(git_auth, "SupabaseClient", lambda: SimpleNamespace())
    monkeypatch.setattr(git_auth, "PuppyOneAuthenticator", _Authenticator)
    monkeypatch.setattr(
        git_auth,
        "enforce_channel_pause",
        lambda _auth, channel, **_kwargs: calls.append(channel),
    )
    token = base64.b64encode(b"alice:secret").decode("ascii")

    auth = await git_auth.resolve_git_project_auth(
        "project-1",
        _request({"authorization": f"Basic {token}"}),
        "docs",
    )

    assert auth["_scope"]["path"] == "docs"
    assert calls == ["git_remote"]
