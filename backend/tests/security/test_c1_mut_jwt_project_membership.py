"""Version Engine JWT admission is bounded by canonical ProjectGrant."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.platform.authorization.models import (
    GrantSource,
    ProjectGrant,
    ProjectRole,
    ROLE_CAPABILITIES,
)
from src.version_engine.admission.identity import PuppyOneAuthenticator


@pytest.fixture
def authenticator():
    supabase = MagicMock()
    supabase.client = MagicMock()
    return PuppyOneAuthenticator(supabase=supabase)


def _stub_jwt_returns(user_id: str):
    fake_user = MagicMock(user_id=user_id)
    auth_service = MagicMock()
    auth_service.get_current_user.return_value = fake_user
    return patch("src.platform.auth.service.AuthService", return_value=auth_service)


def _grant(user_id: str, project_id: str, role: ProjectRole) -> ProjectGrant:
    return ProjectGrant(
        project_id=project_id,
        org_id="org-1",
        user_id=user_id,
        role=role,
        source=GrantSource.PROJECT_MEMBER,
        capabilities=ROLE_CAPABILITIES[role],
    )


@pytest.mark.parametrize(
    ("role", "expected_mode"),
    [(ProjectRole.VIEWER, "r"), (ProjectRole.EDITOR, "rw"), (ProjectRole.ADMIN, "rw")],
)
def test_jwt_scope_mode_is_bounded_by_project_role(
    authenticator, role: ProjectRole, expected_mode: str
):
    user_id = "user-alice"
    project_id = "project-alpha"
    with _stub_jwt_returns(user_id), patch.object(
        authenticator,
        "_resolve_project_grant",
        return_value=_grant(user_id, project_id, role),
    ) as resolve:
        context = authenticator.authenticate("fake.jwt.token", project_id)

    resolve.assert_called_once_with(user_id, project_id)
    assert context["agent"] == f"user:{user_id}"
    assert context["_scope"] == {
        "id": "_root",
        "path": "",
        "exclude": [],
        "mode": expected_mode,
    }


def test_jwt_without_project_grant_is_rejected(authenticator):
    with _stub_jwt_returns("user-attacker"), patch.object(
        authenticator, "_resolve_project_grant", return_value=None
    ):
        with pytest.raises(HTTPException) as error:
            authenticator.authenticate("fake.jwt.token", "project-not-mine")
    assert error.value.status_code == 403


def test_project_grant_resolution_failure_fails_closed(authenticator):
    with _stub_jwt_returns("user-bob"), patch(
        "src.platform.authorization.factory.build_authorization_service",
        side_effect=RuntimeError("database unavailable"),
    ):
        with pytest.raises(HTTPException) as error:
            authenticator.authenticate("fake.jwt.token", "project-x")
    assert error.value.status_code == 403


def test_invalid_jwt_falls_through_to_access_key(authenticator):
    auth_service = MagicMock()
    auth_service.get_current_user.side_effect = HTTPException(
        status_code=401, detail="Invalid"
    )
    with patch(
        "src.platform.auth.service.AuthService", return_value=auth_service
    ), patch.object(authenticator, "_try_access_key", return_value=None):
        with pytest.raises(HTTPException) as error:
            authenticator.authenticate("not-a-jwt", "project-x")
    assert error.value.status_code == 401
