"""C-1 — hash JWT path must verify project membership.

The vulnerability: PuppyOneAuthenticator._try_jwt() previously returned a
root-level rw scope for any valid JWT, regardless of whether the JWT user
belonged to the target project. This allowed any logged-in user to read
or write the hash tree of any project by changing project_id in the URL.

These tests verify the fix by directly exercising the authenticator with
a stubbed Supabase + AuthService.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.version_engine.admission.identity import PuppyOneAuthenticator


@pytest.fixture
def authenticator():
    sb = MagicMock()
    sb.client = MagicMock()
    return PuppyOneAuthenticator(supabase=sb)


def _stub_jwt_returns(user_id: str):
    """Patch AuthService.get_current_user to return a fake user."""
    fake_user = MagicMock(user_id=user_id)
    auth_svc = MagicMock()
    auth_svc.get_current_user.return_value = fake_user
    return patch(
        "src.platform.auth.service.AuthService", return_value=auth_svc
    )


def test_jwt_member_gets_root_rw(authenticator):
    """User who IS a member must receive root-level rw scope (regression)."""
    user_id = "user-alice"
    project_id = "project-alpha"

    with _stub_jwt_returns(user_id), patch.object(
        authenticator, "_user_has_project_access", return_value=True,
    ) as has_access:
        ctx = authenticator.authenticate(
            token="fake.jwt.token",
            project_id=project_id,
        )

    has_access.assert_called_once_with(user_id, project_id)
    assert ctx["agent"] == f"user:{user_id}"
    assert ctx["_scope"]["mode"] == "rw"
    assert ctx["_scope"]["id"] == "_root"


def test_jwt_non_member_is_rejected_with_403(authenticator):
    """User whose JWT verifies but is NOT a project member must get 403."""
    user_id = "user-attacker"
    project_id = "project-not-mine"

    with _stub_jwt_returns(user_id), patch.object(
        authenticator, "_user_has_project_access", return_value=False,
    ):
        with pytest.raises(HTTPException) as exc:
            authenticator.authenticate(
                token="fake.jwt.token",
                project_id=project_id,
            )

    assert exc.value.status_code == 403
    assert "Not a member" in str(exc.value.detail)


def test_jwt_access_check_failure_fails_closed(authenticator):
    """If verify_project_access errors, we must deny — never silently allow."""
    user_id = "user-bob"
    project_id = "project-x"

    with _stub_jwt_returns(user_id), patch(
        "src.platform.project.repository.ProjectRepositorySupabase"
    ) as repo_cls:
        repo_cls.return_value.verify_project_access.side_effect = RuntimeError(
            "DB unreachable"
        )
        # _user_has_project_access catches and returns False ⇒ raises 403
        with pytest.raises(HTTPException) as exc:
            authenticator.authenticate(
                token="fake.jwt.token",
                project_id=project_id,
            )

    assert exc.value.status_code == 403


def test_invalid_jwt_falls_through_to_access_key(authenticator):
    """When JWT verification fails, we should NOT short-circuit — the next
    auth method (access key) must still be tried.
    """
    project_id = "project-x"
    auth_svc = MagicMock()
    auth_svc.get_current_user.side_effect = HTTPException(
        status_code=401, detail="Invalid"
    )

    with patch(
        "src.platform.auth.service.AuthService", return_value=auth_svc
    ), patch.object(authenticator, "_try_access_key", return_value=None):
        with pytest.raises(HTTPException) as exc:
            authenticator.authenticate(
                token="not-a-jwt",
                project_id=project_id,
            )

    # We expect 401 (no auth method matched) — NOT 403, because JWT was
    # never accepted in the first place.
    assert exc.value.status_code == 401
